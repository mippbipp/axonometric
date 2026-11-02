import { ProposalsFile } from "@axonometric/contracts";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect, FileSystem, Option, Path, Schema } from "effect";
import type { Page } from "playwright";

import { openUrl } from "./browser.ts";
import { fullMap } from "./fixtures.ts";
import { makeHome, runCli, startServe } from "./harness.ts";

// The review loop in a page that a real serve serves: pin a note, send it to
// the agent, and read the verdicts that the CLI commits.

const waitTimeout = { timeout: 15_000 };

const decodeProposals = Schema.decodeUnknownEffect(ProposalsFile);

/** How the page's clipboard answers: allowed, or blocked as a browser may. */
type Clipboard = "allowed" | "blocked";

const servedReview = (clipboard: Clipboard = "allowed") =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const root = yield* makeHome(yield* fullMap);
    const home = path.join(root, "review", "map");
    const serve = yield* startServe(home, ["--port", "0"]);
    const opened = yield* openUrl(serve.url);

    yield* Effect.promise(() =>
      opened.page.setViewportSize({ width: 1280, height: 800 })
    );

    // Playwright's browser has no clipboard permission, so the page's
    // writeText either works or fails by what the test installs.
    yield* Effect.promise(() =>
      opened.page.evaluate(`
        (() => {
          const written = [];
          window.__copied = written;
          Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: {
              writeText: (text) =>
                ${clipboard === "allowed" ? "(written.push(text), Promise.resolve())" : 'Promise.reject(new DOMException("blocked", "NotAllowedError"))'},
            },
          });
        })()
      `)
    );

    return { root, home, serve, ...opened };
  }).pipe(Effect.provide(NodeServices.layer));

const waitFor = (page: Page, selector: string) =>
  Effect.promise(() => page.locator(selector).first().waitFor(waitTimeout));

const waitGone = (page: Page, selector: string) =>
  Effect.promise(() =>
    page
      .locator(selector)
      .first()
      .waitFor({ state: "detached", ...waitTimeout })
  );

const count = (page: Page, selector: string) =>
  Effect.promise(() => page.locator(selector).count());

const textOf = (page: Page, selector: string) =>
  Effect.promise(() =>
    page
      .locator(selector)
      .first()
      .textContent()
      .then((text) => text ?? "")
  );

const click = (page: Page, selector: string) =>
  Effect.promise(() => page.locator(selector).first().click());

/** Goes to the saving chapter and pins the server structure. */
const pinServer = Effect.fnUntraced(function* (page: Page) {
  yield* click(page, '[data-chapter-rail] button[data-chapter="c-save"]');
  yield* waitFor(page, '[data-walkthrough][data-chapter="c-save"]');
  yield* click(page, '[data-structure="server"]');
  yield* waitFor(page, '[data-structure-panel="server"][data-pinned]');
});

/** Types `text` in the pinned structure's note form and pins it. */
const pinNote = Effect.fnUntraced(function* (page: Page, text: string) {
  yield* Effect.promise(() =>
    page
      .locator("[data-structure-panel] [data-notes-section] [data-note-text]")
      .fill(text)
  );
  yield* click(
    page,
    "[data-structure-panel] [data-notes-section] [data-note-send]"
  );
});

const readProposals = Effect.fnUntraced(function* (home: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  return yield* decodeProposals(
    yield* fs.readFileString(path.join(home, "proposals.json"))
  );
}, Effect.provide(NodeServices.layer));

const copiedText = (page: Page) =>
  Effect.promise(() =>
    page.evaluate<readonly string[]>("window.__copied ?? []")
  );

describe("a note on a structure", () => {
  it.live(
    "is saved as a proposal, shown by a marker on the map and in the Pending list",
    () =>
      Effect.gen(function* () {
        const { home, page, errors } = yield* servedReview();

        yield* pinServer(page);
        yield* pinNote(page, "Why a server, not a file watcher?");

        yield* waitFor(page, '[data-note-marker="server"]');
        yield* waitFor(page, '[data-panel-note][data-note-state="open"]');

        const proposals = yield* readProposals(home);

        assert.deepStrictEqual(
          Arr.map(proposals.notes ?? [], ({ target, text }) => [
            target.kind === "spot" ? "spot" : target.id,
            text,
          ]),
          [["server", "Why a server, not a file watcher?"]]
        );

        yield* click(page, '[role="tab"][data-tab="pending"]');
        yield* waitFor(page, '[data-review-item][data-review-state="open"]');
        assert.include(
          yield* textOf(page, "[data-review-list]"),
          "Why a server, not a file watcher?"
        );
        assert.include(
          yield* textOf(page, '[role="tab"][data-tab="pending"]'),
          "Pending · 1"
        );
        assert.deepStrictEqual(errors, []);
      }),
    60_000
  );

  it.live("can be discarded while it is open", () =>
    Effect.gen(function* () {
      const { home, page } = yield* servedReview();

      yield* pinServer(page);
      yield* pinNote(page, "A thought I will take back");
      yield* waitFor(page, '[data-note-marker="server"]');

      yield* click(page, '[role="tab"][data-tab="pending"]');
      yield* Effect.promise(() =>
        page
          .locator('[data-review-item] button:has-text("Discard")')
          .first()
          .click()
      );
      yield* waitGone(page, '[data-note-marker="server"]');

      const proposals = yield* readProposals(home);

      assert.deepStrictEqual(proposals.notes ?? [], []);
    }).pipe(Effect.provide(NodeServices.layer))
  );
});

describe("the Ready for review button", () => {
  it.live(
    "freezes batch 1 and copies a prompt that names the skill, the home folder and the batch",
    () =>
      Effect.gen(function* () {
        const { home, page } = yield* servedReview();

        yield* pinServer(page);
        yield* pinNote(page, "Why a server?");
        yield* waitFor(page, '[data-note-marker="server"]');
        yield* click(page, "[data-ready-for-review]");
        yield* waitFor(page, "[data-review-dialog][open]");

        const copied = yield* copiedText(page);
        const prompt = copied[0] ?? "";

        assert.include(prompt, "axonometric skill");
        assert.include(prompt, home);
        assert.include(prompt, "batch 1");
        assert.include(prompt, "summary");
        assert.include(prompt, `${home}/proposals.json`);
        assert.match(
          prompt,
          /^- note \S+ on "Save server": "Why a server\?"$/mu
        );

        const dialog = yield* textOf(page, "[data-review-dialog]");

        assert.include(dialog, "The prompt is copied");
        assert.include(dialog, "summary");
        assert.include(dialog, `${home}/proposals.json`);

        const shown = yield* Effect.promise(() =>
          page.locator("[data-review-prompt]").inputValue()
        );

        assert.strictEqual(shown, prompt);

        const proposals = yield* readProposals(home);

        assert.strictEqual(proposals.batches?.length, 1);
        assert.strictEqual(proposals.notes?.length, 0);
      }),
    60_000
  );

  it.live(
    "shows the prompt in a box with its text selected when the clipboard is blocked",
    () =>
      Effect.gen(function* () {
        const { page } = yield* servedReview("blocked");

        yield* pinServer(page);
        yield* pinNote(page, "Why a server?");
        yield* waitFor(page, '[data-note-marker="server"]');
        yield* click(page, "[data-ready-for-review]");
        yield* waitFor(page, "[data-review-dialog][open]");

        assert.include(
          yield* textOf(page, "[data-review-dialog]"),
          "Your browser blocked the clipboard"
        );

        const box = page.locator("[data-review-prompt]");

        // The selection sits in the box, so the page's own selection
        // reports the box's text, and the box has focus.
        const selected = yield* Effect.promise(() =>
          page.evaluate<string>(
            `(() => {
              const field = document.querySelector("[data-review-prompt]");
              return field.value.slice(field.selectionStart, field.selectionEnd);
            })()`
          )
        );

        const focused = yield* Effect.promise(() =>
          page.evaluate<boolean>(
            `document.activeElement === document.querySelector("[data-review-prompt]")`
          )
        );

        const value = yield* Effect.promise(() => box.inputValue());

        assert.isTrue(focused);
        assert.isAbove(value.length, 0);
        assert.strictEqual(selected, value);
        assert.include(value, "batch 1");
      }),
    60_000
  );

  it.live("sends edits made after freezing to batch 2", () =>
    Effect.gen(function* () {
      const { home, page } = yield* servedReview();

      yield* pinServer(page);
      yield* pinNote(page, "First question");
      yield* waitFor(page, '[data-note-marker="server"]');
      yield* click(page, "[data-ready-for-review]");
      yield* waitFor(page, "[data-review-dialog][open]");
      yield* click(page, "[data-review-close]");
      yield* waitGone(page, "[data-review-dialog][open]");

      yield* pinNote(page, "Second question");
      yield* waitFor(page, '[data-panel-note][data-note-state="open"]');
      yield* click(page, "[data-ready-for-review]");
      yield* waitFor(page, "[data-review-dialog][open]");

      assert.include(yield* textOf(page, "[data-review-title]"), "Batch 2");
      assert.include((yield* copiedText(page)).at(-1) ?? "", "batch 2");

      const proposals = yield* readProposals(home);

      assert.deepStrictEqual(
        Arr.map(proposals.batches ?? [], ({ number, items }) => [
          number,
          items.length,
        ]),
        [
          [1, 1],
          [2, 1],
        ]
      );
    }).pipe(Effect.provide(NodeServices.layer))
  );

  it.live("tells the page a frozen note is waiting for the agent", () =>
    Effect.gen(function* () {
      const { page } = yield* servedReview();

      yield* pinServer(page);
      yield* pinNote(page, "Still thinking");
      yield* waitFor(page, '[data-note-marker="server"]');
      yield* click(page, "[data-ready-for-review]");
      yield* waitFor(page, "[data-review-dialog][open]");
      yield* click(page, "[data-review-close]");

      yield* click(page, '[role="tab"][data-tab="pending"]');
      yield* waitFor(page, "[data-waiting-for-agent]");

      assert.strictEqual(
        yield* count(page, '[data-review-item] button:has-text("Discard")'),
        0
      );
      assert.include(
        yield* textOf(page, "[data-waiting-for-agent]"),
        "waiting for the agent"
      );
    }).pipe(Effect.provide(NodeServices.layer))
  );
});

/** Pins a note, freezes it, and closes the dialog: batch 1 holds the note. */
const sendOne = Effect.fnUntraced(function* (page: Page, text: string) {
  yield* pinServer(page);
  yield* pinNote(page, text);
  yield* waitFor(page, '[data-note-marker="server"]');
  yield* click(page, "[data-ready-for-review]");
  yield* waitFor(page, "[data-review-dialog][open]");
  yield* click(page, "[data-review-close]");
  yield* waitGone(page, "[data-review-dialog][open]");
});

/** The id of the only item in batch 1. */
const onlyItem = Effect.fnUntraced(function* (home: string) {
  const proposals = yield* readProposals(home);
  const batch = Option.getOrThrow(Arr.head(proposals.batches ?? []));
  const item = Option.getOrThrow(Arr.head(batch.items));

  return item.id;
});

describe("the agent's verdicts", () => {
  it.live(
    "shows each verdict and reason after verdict and commit run in the CLI",
    () =>
      Effect.gen(function* () {
        const { home, page, errors } = yield* servedReview();

        yield* sendOne(page, "Why a server?");

        const id = yield* onlyItem(home);

        const verdict = yield* runCli(home, [
          "verdict",
          home,
          id,
          "rejected",
          "--reason",
          "The page already polls nothing.",
        ]);

        assert.strictEqual(verdict.exitCode, 0, verdict.stderr);

        const commit = yield* runCli(home, ["commit", home]);

        assert.strictEqual(commit.exitCode, 0, commit.stderr);

        yield* waitFor(page, '[data-panel-note][data-note-state="reviewed"]');

        const panel = yield* textOf(page, "[data-structure-panel]");

        assert.include(panel, "Rejected");
        assert.include(panel, "The page already polls nothing.");

        yield* click(page, '[role="tab"][data-tab="pending"]');
        yield* waitFor(page, '[data-verdict="rejected"]');
        assert.include(
          yield* textOf(page, "[data-review-list]"),
          "The page already polls nothing."
        );
        assert.strictEqual(
          yield* count(
            page,
            '[data-note-marker="server"][data-note-rejected="true"]'
          ),
          1
        );
        assert.deepStrictEqual(errors, []);
      }).pipe(Effect.provide(NodeServices.layer)),
    90_000
  );

  it.live("keeps a rejected note until it is dismissed", () =>
    Effect.gen(function* () {
      const { home, page } = yield* servedReview();

      yield* sendOne(page, "Why a server?");

      const id = yield* onlyItem(home);

      yield* runCli(home, ["verdict", home, id, "rejected", "--reason", "No."]);
      yield* runCli(home, ["commit", home]);

      yield* click(page, '[role="tab"][data-tab="pending"]');
      yield* waitFor(page, '[data-verdict="rejected"]');

      // It survives a reload: the verdict is on disk, not in the page.
      yield* Effect.promise(() => page.reload());
      yield* pinServer(page);
      yield* waitFor(page, '[data-note-marker="server"]');

      yield* click(page, '[role="tab"][data-tab="pending"]');
      yield* Effect.promise(() =>
        page.locator(`[data-dismiss="${id}"]`).click()
      );
      yield* waitGone(page, '[data-note-marker="server"]');
      yield* waitGone(page, "[data-review-item]");
    }).pipe(Effect.provide(NodeServices.layer))
  );

  it.live(
    "puts an edited rejected note in the next batch",
    () =>
      Effect.gen(function* () {
        const { home, page } = yield* servedReview();

        yield* sendOne(page, "Why a server?");

        const id = yield* onlyItem(home);

        yield* runCli(home, [
          "verdict",
          home,
          id,
          "rejected",
          "--reason",
          "No.",
        ]);
        yield* runCli(home, ["commit", home]);

        yield* click(page, '[role="tab"][data-tab="pending"]');
        yield* click(page, `[data-reopen="${id}"]`);
        yield* Effect.promise(() =>
          page
            .locator("[data-review-list] [data-note-text]")
            .fill("Why a server, given the page polls nothing?")
        );
        yield* click(page, "[data-review-list] [data-note-send]");
        yield* waitFor(page, "[data-reopened-from]");

        const open = yield* readProposals(home);
        const note = Option.getOrThrow(Arr.head(open.notes ?? []));

        assert.strictEqual(
          note.text,
          "Why a server, given the page polls nothing?"
        );
        assert.deepStrictEqual(open.replaces, { [note.id]: id });

        yield* click(page, "[data-ready-for-review]");
        yield* waitFor(page, "[data-review-dialog][open]");

        const proposals = yield* readProposals(home);
        const second = Option.getOrThrow(Arr.get(proposals.batches ?? [], 1));

        assert.strictEqual(second.number, 2);
        assert.deepStrictEqual(
          Arr.map(second.items, (item) => item.id),
          [note.id]
        );

        const review = yield* runCli(home, ["review", home]);

        assert.include(review.stdout, "Batch 2");
        assert.include(review.stdout, `replaces: ${id}`);
      }).pipe(Effect.provide(NodeServices.layer)),
    90_000
  );
});

describe("exports", () => {
  it.live(
    "carry no note marker, and equal the CLI's SVG while a note sits on the map",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const { home, root, page } = yield* servedReview();

        yield* pinServer(page);
        yield* pinNote(page, "Why a server?");
        yield* waitFor(page, '[data-note-marker="server"]');

        // Unpin the structure, so the spotlight is the chapter's own play,
        // as the CLI draws it.
        yield* Effect.promise(() =>
          page.evaluate("document.activeElement?.blur()")
        );
        yield* Effect.promise(() => page.keyboard.press("Escape"));
        yield* Effect.promise(() =>
          page
            .locator("[data-structure-panel][data-pinned]")
            .waitFor({ state: "detached" })
        );

        yield* click(page, '[data-control="export"]');

        const [download] = yield* Effect.promise(() =>
          Promise.all([
            page.waitForEvent("download"),
            page.locator('[data-export-item="svg"]').click(),
          ])
        );

        const saved = yield* Effect.promise(() => download.path());
        const fromPage = yield* fs.readFileString(saved);
        const target = path.join(root, "out.svg");

        const exported = yield* runCli(home, [
          "export",
          home,
          "--format",
          "svg",
          "--view",
          "iso",
          "--chapter",
          "2",
          "--output",
          target,
        ]);

        assert.strictEqual(exported.exitCode, 0, exported.stderr);
        assert.notInclude(fromPage, "data-note-marker");
        assert.notInclude(fromPage, "data-verdict");
        assert.isTrue(fromPage === (yield* fs.readFileString(target)));
      }).pipe(Effect.provide(NodeServices.layer)),
    90_000
  );
});

describe("the CLI and the page writing at once", () => {
  it.live(
    "a commit running while the page writes a note loses neither",
    () =>
      Effect.gen(function* () {
        const { home, page } = yield* servedReview();

        yield* sendOne(page, "Batch one note");

        const id = yield* onlyItem(home);

        yield* runCli(home, ["verdict", home, id, "accepted"]);

        // Both start together: the page pins a second note while the CLI
        // commits batch 1. The lock orders the writes, and the page's write
        // is based on a revision the commit moves, so it is sent again.
        yield* Effect.all(
          [
            pinNote(page, "Note typed during the commit"),
            runCli(home, ["commit", home]),
          ],
          { concurrency: "unbounded" }
        );

        yield* waitFor(page, '[data-panel-note][data-note-state="open"]');
        yield* waitFor(page, '[data-panel-note][data-note-state="reviewed"]');

        const proposals = yield* readProposals(home);

        assert.strictEqual(
          proposals.batches?.[0]?.committed?.revision,
          1,
          "the commit landed"
        );
        assert.deepStrictEqual(
          Arr.map(proposals.notes ?? [], ({ text }) => text),
          ["Note typed during the commit"]
        );
      }).pipe(Effect.provide(NodeServices.layer)),
    90_000
  );
});
