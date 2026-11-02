import { ProposalsFile } from "@axonometric/contracts";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import {
  Array as Arr,
  Effect,
  FileSystem,
  Path,
  Schema,
  String as Str,
} from "effect";
import type { Page } from "playwright";

import { openUrl } from "./browser.ts";
import { fullMap } from "./fixtures.ts";
import { makeHome, startServe } from "./harness.ts";

// Words on the page, against a real serve: a text suggestion shown beside the
// original, an answer, a raised question, and notes on a hop and an empty spot.

const wait = { timeout: 15_000 };

const decodeProposals = Schema.decodeUnknownEffect(ProposalsFile);

const served = Effect.gen(function* () {
  const path = yield* Path.Path;
  const root = yield* makeHome(yield* fullMap);
  const home = path.join(root, "review", "map");
  const serve = yield* startServe(home, ["--port", "0"]);
  const opened = yield* openUrl(serve.url);

  yield* Effect.promise(() =>
    opened.page.setViewportSize({ width: 1280, height: 800 })
  );

  return { root, home, serve, ...opened };
}).pipe(Effect.provide(NodeServices.layer));

const waitFor = (page: Page, selector: string) =>
  Effect.promise(() => page.locator(selector).first().waitFor(wait));

const click = (page: Page, selector: string) =>
  Effect.promise(() => page.locator(selector).first().click());

const fill = (page: Page, selector: string, text: string) =>
  Effect.promise(() => page.locator(selector).first().fill(text));

const textOf = (page: Page, selector: string) =>
  Effect.promise(() =>
    page
      .locator(selector)
      .first()
      .textContent()
      .then((text) => text ?? "")
  );

const count = (page: Page, selector: string) =>
  Effect.promise(() => page.locator(selector).count());

const readProposals = Effect.fnUntraced(function* (home: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  return yield* decodeProposals(
    yield* fs.readFileString(path.join(home, "proposals.json"))
  );
}, Effect.provide(NodeServices.layer));

/** Opens the saving chapter and pins the structure `id`. */
const pin = Effect.fnUntraced(function* (page: Page, id: string) {
  yield* click(page, '[data-chapter-rail] button[data-chapter="c-save"]');
  yield* waitFor(page, '[data-walkthrough][data-chapter="c-save"]');
  yield* click(page, `[data-structure="${id}"]`);
  yield* waitFor(page, `[data-structure-panel="${id}"][data-pinned]`);
});

const panel = "[data-structure-panel]";

describe("a text suggestion", () => {
  it.live(
    "shows next to the original, which is marked current, and saves with the field, original and new text",
    () =>
      Effect.gen(function* () {
        const { home, page, errors } = yield* served;

        yield* pin(page, "server");
        yield* click(page, `${panel} [data-suggest="oneLiner"]`);
        yield* fill(
          page,
          `${panel} [data-suggestable="oneLiner"] [data-note-text]`,
          "Saves edits and tells every open page."
        );
        yield* click(
          page,
          `${panel} [data-suggestable="oneLiner"] [data-note-send]`
        );
        yield* waitFor(page, `${panel} [data-suggested]`);

        const field = `${panel} [data-suggestable="oneLiner"]`;

        assert.include(
          yield* textOf(page, `${field} [data-current]`),
          "Saves edits and pushes changes to pages."
        );
        assert.include(
          yield* textOf(page, `${field} [data-current]`),
          "Current"
        );
        assert.include(
          yield* textOf(page, `${field} [data-suggested]`),
          "Saves edits and tells every open page."
        );
        assert.include(
          yield* textOf(page, `${field} [data-suggested]`),
          "goes in the next batch"
        );

        const proposals = yield* readProposals(home);

        assert.deepStrictEqual(
          Arr.map(proposals.suggestions ?? [], (item) => [
            item.target.id,
            item.field,
            item.before,
            item.after,
          ]),
          [
            [
              "server",
              "oneLiner",
              "Saves edits and pushes changes to pages.",
              "Saves edits and tells every open page.",
            ],
          ]
        );
        assert.deepStrictEqual(errors, []);
      }),
    60_000
  );

  it.live("can be made on a step's name and detail", () =>
    Effect.gen(function* () {
      const { home, page } = yield* served;

      yield* pin(page, "server");
      yield* click(page, '[data-chapter-rail] button[data-chapter="c-page"]');
      yield* click(page, '[data-structure="page"]');
      yield* waitFor(page, '[data-structure-panel="page"][data-pinned]');
      yield* click(page, `${panel} [data-suggest="steps.1.detail"]`);
      yield* fill(
        page,
        `${panel} [data-suggestable="steps.1.detail"] [data-note-text]`,
        "The page posts the note to the save server."
      );
      yield* click(
        page,
        `${panel} [data-suggestable="steps.1.detail"] [data-note-send]`
      );
      yield* waitFor(
        page,
        `${panel} [data-suggestable="steps.1.detail"] [data-suggested]`
      );

      const proposals = yield* readProposals(home);

      assert.deepStrictEqual(
        Arr.map(proposals.suggestions ?? [], ({ field, before }) => [
          field,
          before,
        ]),
        [["steps.1.detail", "The page posts the note to the server."]]
      );
    })
  );

  it.live("can be edited again and discarded while open", () =>
    Effect.gen(function* () {
      const { home, page } = yield* served;

      yield* pin(page, "server");
      yield* click(page, `${panel} [data-suggest="whatItDoes"]`);
      yield* fill(
        page,
        `${panel} [data-suggestable="whatItDoes"] [data-note-text]`,
        "First wording."
      );
      yield* click(
        page,
        `${panel} [data-suggestable="whatItDoes"] [data-note-send]`
      );
      yield* waitFor(
        page,
        `${panel} [data-suggestable="whatItDoes"] [data-suggested]`
      );

      yield* click(page, `${panel} [data-suggestion-edit="whatItDoes"]`);
      yield* fill(
        page,
        `${panel} [data-suggestable="whatItDoes"] [data-note-text]`,
        "Second wording."
      );
      yield* click(
        page,
        `${panel} [data-suggestable="whatItDoes"] [data-note-send]`
      );
      yield* waitFor(
        page,
        `${panel} [data-suggestable="whatItDoes"] [data-suggested]:has-text("Second wording.")`
      );

      assert.deepStrictEqual(
        Arr.map(
          (yield* readProposals(home)).suggestions ?? [],
          ({ after }) => after
        ),
        ["Second wording."]
      );

      yield* click(page, `${panel} [data-suggestion-discard="whatItDoes"]`);
      yield* Effect.promise(() =>
        page
          .locator(`${panel} [data-suggestable="whatItDoes"] [data-suggested]`)
          .waitFor({ state: "detached", ...wait })
      );

      assert.deepStrictEqual((yield* readProposals(home)).suggestions, []);
    })
  );
});

describe("a question", () => {
  it.live(
    "is answered from the Questions tab, and the answer saves with today's date",
    () =>
      Effect.gen(function* () {
        const { home, page, errors } = yield* served;

        yield* pin(page, "server");
        yield* click(page, '[role="tab"][data-tab="questions"]');
        yield* click(page, '[data-question="Q-S1"] [data-answer-open="Q-S1"]');
        yield* fill(
          page,
          '[data-question="Q-S1"] [data-note-text]',
          "5178 first, then the next free one."
        );
        yield* click(page, '[data-question="Q-S1"] [data-note-send]');
        yield* waitFor(page, '[data-question="Q-S1"] [data-answer]');

        const proposals = yield* readProposals(home);
        const [saved] = proposals.answers ?? [];

        // The page's own clock decides the day, in the browser's time zone.
        const today = yield* Effect.promise(() =>
          page.evaluate<string>(
            `new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())`
          )
        );

        assert.strictEqual(saved?.question, "Q-S1");
        assert.strictEqual(saved?.target.id, "server");
        assert.strictEqual(saved?.text, "5178 first, then the next free one.");
        assert.strictEqual(saved?.answeredOn, today);
        assert.include(
          yield* textOf(page, '[data-question="Q-S1"] [data-answer]'),
          `Answered ${today}`
        );
        assert.strictEqual(
          yield* count(page, '[data-question="Q-S1"] [data-answer-open]'),
          0
        );
        assert.deepStrictEqual(errors, []);
      }),
    60_000
  );

  it.live("is answered from the structure's panel too", () =>
    Effect.gen(function* () {
      const { home, page } = yield* served;

      yield* pin(page, "server");
      yield* click(
        page,
        `${panel} [data-panel-question="Q-S1"] [data-answer-open]`
      );
      yield* fill(
        page,
        `${panel} [data-panel-question="Q-S1"] [data-note-text]`,
        "Port 5178."
      );
      yield* click(
        page,
        `${panel} [data-panel-question="Q-S1"] [data-note-send]`
      );
      yield* waitFor(
        page,
        `${panel} [data-panel-question="Q-S1"] [data-answer]`
      );

      assert.strictEqual(
        (yield* readProposals(home)).answers?.[0]?.text,
        "Port 5178."
      );
    })
  );

  it.live("is raised on a structure, with no id of its own", () =>
    Effect.gen(function* () {
      const { home, page } = yield* served;

      yield* pin(page, "server");
      yield* fill(
        page,
        `${panel} [data-raised-section] [data-note-text]`,
        "Should writes retry?"
      );
      yield* click(page, `${panel} [data-raised-section] [data-note-send]`);
      yield* waitFor(page, `${panel} [data-raised-question]`);

      const proposals = yield* readProposals(home);

      assert.deepStrictEqual(
        Arr.map(proposals.raised ?? [], ({ target, text }) => [
          target.id,
          text,
        ]),
        [["server", "Should writes retry?"]]
      );
      // The agent assigns a question's id, so the proposal holds only the
      // item's own id: no field carries a Q- id.
      assert.isFalse(
        Arr.some(proposals.raised ?? [], (item) => Str.includes("Q-")(item.id))
      );
    })
  );
});

describe("the Pending tab", () => {
  it.live(
    "lists words with a Discard, counts them, and the button freezes them",
    () =>
      Effect.gen(function* () {
        const { home, page } = yield* served;

        yield* pin(page, "server");
        yield* fill(
          page,
          `${panel} [data-raised-section] [data-note-text]`,
          "Should writes retry?"
        );
        yield* click(page, `${panel} [data-raised-section] [data-note-send]`);
        yield* waitFor(page, `${panel} [data-raised-question]`);
        yield* click(page, '[role="tab"][data-tab="pending"]');
        yield* waitFor(page, '[data-review-item][data-review-kind="question"]');

        assert.include(
          yield* textOf(page, '[data-review-kind="question"]'),
          "New question on Save server: Should writes retry?"
        );
        assert.include(
          yield* textOf(page, '[role="tab"][data-tab="pending"]'),
          "Pending · 1"
        );
        assert.include(yield* textOf(page, "[data-ready-for-review]"), "· 1");

        yield* click(page, "[data-ready-for-review]");
        yield* waitFor(page, "[data-review-dialog][open]");

        const proposals = yield* readProposals(home);

        assert.strictEqual(proposals.batches?.[0]?.items[0]?.kind, "question");
        assert.deepStrictEqual(proposals.raised, []);
      })
  );
});
