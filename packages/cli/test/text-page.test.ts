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

import { literal, openUrl } from "./browser.ts";
import { fullMap } from "./fixtures.ts";
import { makeHome, runCli, startServe } from "./harness.ts";

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

  it.live(
    "can be made on both parts of a step with a single Edit, which names the step",
    () =>
      Effect.gen(function* () {
        const { home, page } = yield* served;

        yield* click(page, '[data-chapter-rail] button[data-chapter="c-page"]');
        yield* click(page, '[data-structure="page"]');
        yield* waitFor(page, '[data-structure-panel="page"][data-pinned]');

        // One Edit for each step, not two.
        assert.strictEqual(
          yield* count(
            page,
            `${panel} [data-suggestable-step="1"] [data-suggest]`
          ),
          1
        );
        assert.strictEqual(
          yield* count(page, `${panel} [data-suggest^="steps."]`),
          2
        );

        const edit = page.getByRole("button", { name: "Edit: step 2" });

        assert.strictEqual(yield* Effect.promise(() => edit.count()), 1);
        yield* Effect.promise(() => edit.click());
        yield* fill(
          page,
          `${panel} [data-step-text="steps.1.name"]`,
          "Save it"
        );
        yield* fill(
          page,
          `${panel} [data-step-text="steps.1.detail"]`,
          "The page posts the note to the save server."
        );
        yield* click(page, `${panel} [data-step-send]`);
        yield* waitFor(
          page,
          `${panel} [data-suggestable="steps.1.detail"] [data-suggested]`
        );
        yield* waitFor(
          page,
          `${panel} [data-suggestable="steps.1.name"] [data-suggested]`
        );

        const proposals = yield* readProposals(home);

        assert.deepStrictEqual(
          Arr.map(proposals.suggestions ?? [], ({ field, before, after }) => [
            field,
            before,
            after,
          ]),
          [
            ["steps.1.name", "Save", "Save it"],
            [
              "steps.1.detail",
              "The page posts the note to the server.",
              "The page posts the note to the save server.",
            ],
          ]
        );

        // Each open suggestion has a Discard that names its field.
        assert.isAtLeast(
          yield* Effect.promise(() =>
            page
              .getByRole("button", {
                name: "Discard suggestion: step 2 detail",
              })
              .count()
          ),
          1
        );
      })
  );

  it.live("changing only one part of a step suggests only that part", () =>
    Effect.gen(function* () {
      const { home, page } = yield* served;

      yield* click(page, '[data-chapter-rail] button[data-chapter="c-page"]');
      yield* click(page, '[data-structure="page"]');
      yield* waitFor(page, '[data-structure-panel="page"][data-pinned]');
      yield* Effect.promise(() =>
        page.getByRole("button", { name: "Edit: step 1" }).click()
      );
      yield* fill(
        page,
        `${panel} [data-step-text="steps.0.detail"]`,
        "The engineer pins a note to a structure, hop or spot."
      );
      yield* click(page, `${panel} [data-step-send]`);
      yield* waitFor(
        page,
        `${panel} [data-suggestable="steps.0.detail"] [data-suggested]`
      );

      assert.deepStrictEqual(
        Arr.map(
          (yield* readProposals(home)).suggestions ?? [],
          ({ field }) => field
        ),
        ["steps.0.detail"]
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

describe("the Pending tab with proposals", () => {
  it.live(
    "has no empty-state text while only notes are pending, and its intro covers both kinds",
    () =>
      Effect.gen(function* () {
        const { page } = yield* served;

        yield* pin(page, "server");
        yield* click(page, '[role="tab"][data-tab="pending"]');

        // Nothing at all pending: the empty state shows.
        yield* waitFor(page, "[data-pending-empty]");

        yield* click(page, '[role="tab"][data-tab="details"]');
        yield* fill(
          page,
          `${panel} [data-notes-section] [data-note-text]`,
          "A note and nothing else"
        );
        yield* click(page, `${panel} [data-notes-section] [data-note-send]`);
        yield* waitFor(page, "[data-panel-note]");
        yield* click(page, '[role="tab"][data-tab="pending"]');
        yield* waitFor(page, '[data-review-item][data-review-kind="note"]');

        assert.strictEqual(yield* count(page, "[data-pending-empty]"), 0);
        assert.include(
          yield* textOf(page, '[role="tab"][data-tab="pending"]'),
          "Pending · 1"
        );

        const intro = yield* textOf(page, "[data-pending-intro]");

        assert.include(intro, "Layout changes");
        assert.include(intro, "Proposals");
        assert.include(intro, "agent");
        assert.include(
          yield* textOf(page, "[data-review-list] h3"),
          "Diagram changes"
        );
      }),
    60_000
  );

  it.live(
    "lists a suggestion, an answer and a question under the same heading",
    () =>
      Effect.gen(function* () {
        const { page } = yield* served;

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
        yield* click(page, '[role="tab"][data-tab="pending"]');
        yield* waitFor(page, '[data-review-kind="answer"]');

        assert.strictEqual(yield* count(page, "[data-pending-empty]"), 0);
        assert.deepStrictEqual(
          yield* Effect.promise(() =>
            page.evaluate<string[]>(
              "[...document.querySelectorAll('[data-review-item]')].map((item) => item.dataset.reviewKind)"
            )
          ),
          ["suggestion", "answer"]
        );
      })
  );
});

describe("a frozen suggestion", () => {
  /** Suggests a new one-liner, freezes it, and leaves the panel open. */
  const frozenOneLiner = Effect.fnUntraced(function* () {
    const world = yield* served;
    const { page } = world;

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
    yield* click(page, "[data-ready-for-review]");
    yield* waitFor(page, "[data-review-dialog][open]");
    yield* click(page, "[data-review-close]");

    return world;
  });

  it.live(
    "shows as waiting on the agent, with no way to edit it",
    () =>
      Effect.gen(function* () {
        const { home, page } = yield* frozenOneLiner();
        const field = `${panel} [data-suggestable="oneLiner"]`;

        yield* waitFor(page, `${field}[data-suggestion-state="frozen"]`);

        assert.include(
          yield* textOf(page, `${field} [data-suggested]`),
          "In batch 1, waiting for the agent"
        );
        assert.strictEqual(yield* count(page, `${field} button`), 0);
        assert.strictEqual(yield* count(page, `${field} [data-suggest]`), 0);

        // The server still refuses a write the page can't make.
        const proposals = yield* readProposals(home);

        assert.strictEqual(
          proposals.batches?.[0]?.items[0]?.kind,
          "suggestion"
        );
      }),
    60_000
  );

  it.live(
    "is a suggestion again once the agent rejects it",
    () =>
      Effect.gen(function* () {
        const { home, page } = yield* frozenOneLiner();
        const field = `${panel} [data-suggestable="oneLiner"]`;

        yield* waitFor(page, `${field}[data-suggestion-state="frozen"]`);

        const item =
          (yield* readProposals(home)).batches?.[0]?.items[0]?.id ?? "";

        yield* runCli(home, [
          "verdict",
          home,
          item,
          "rejected",
          "--reason",
          "No.",
        ]);
        yield* runCli(home, ["commit", home]);
        yield* waitFor(page, `${field}[data-suggestion-state="reviewed"]`);
        yield* waitFor(page, `${field} [data-suggest]`);

        assert.include(
          yield* textOf(page, `${field} [data-suggest]`),
          "Suggest again"
        );
      }),
    90_000
  );
});

describe("buttons", () => {
  it.live("name the field or question they act on", () =>
    Effect.gen(function* () {
      const { page } = yield* served;

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

      const names = yield* Effect.promise(() =>
        page.evaluate<string[]>(
          "[...document.querySelectorAll('[data-structure-panel] button[aria-label]')].map((button) => button.ariaLabel)"
        )
      );

      for (const name of [
        "Edit suggestion: one-liner",
        "Discard suggestion: one-liner",
        "Discard answer: Q-S1",
        "Edit: what it does",
        "Edit: how it's built",
      ]) {
        assert.include(names, name);
      }
    })
  );
});

/** Each button's height and font size in pixels, by its accessible name. */
const sizesOf = (page: Page) =>
  Effect.promise(() =>
    page.evaluate<Record<string, { height: number; font: number }>>(`(() => {
      const sizes = {};

      for (const button of document.querySelectorAll("[data-structure-panel] button[aria-label], [data-structure-panel] [data-note-send]")) {
        const style = getComputedStyle(button);

        sizes[button.getAttribute("aria-label") ?? button.textContent] = {
          height: button.getBoundingClientRect().height,
          font: parseFloat(style.fontSize),
        };
      }

      return sizes;
    })()`)
  );

describe("the panel's buttons and headings", () => {
  it.live(
    "use one size, and the step's Edit sits by its heading",
    () =>
      Effect.gen(function* () {
        const { page } = yield* served;

        yield* click(page, '[data-chapter-rail] button[data-chapter="c-page"]');
        yield* click(page, '[data-structure="page"]');
        yield* waitFor(page, '[data-structure-panel="page"][data-pinned]');
        yield* Effect.promise(() =>
          page.getByRole("button", { name: "Edit: step 2" }).click()
        );
        yield* fill(
          page,
          `${panel} [data-step-text="steps.1.detail"]`,
          "The page posts the note to the save server."
        );
        yield* click(page, `${panel} [data-step-send]`);
        yield* waitFor(
          page,
          `${panel} [data-suggestable="steps.1.detail"] [data-suggested]`
        );
        yield* click(
          page,
          `${panel} [data-panel-question="Q-P1"] [data-answer-open]`
        );

        const sizes = yield* sizesOf(page);

        const wanted = [
          "Edit: step 2",
          "Edit suggestion: step 2 detail",
          "Discard suggestion: step 2 detail",
          "Pin note",
        ];

        for (const name of wanted) {
          assert.isDefined(sizes[name], `${name} is not in the panel`);
        }

        // Every button is the size of the panel's other buttons.
        const reference = sizes["Pin note"];

        for (const name of wanted) {
          assert.strictEqual(sizes[name]?.font, reference?.font, name);
          assert.isAtLeast(
            sizes[name]?.height ?? 0,
            (reference?.height ?? 0) - 1,
            name
          );
        }

        assert.isAtLeast(reference?.font ?? 0, 11);

        // The step's Edit is in the step's heading row, above its blocks.
        const where = yield* Effect.promise(() =>
          page.evaluate<{
            editTop: number;
            headTop: number;
            blockTop: number;
          }>(`(() => {
          const step = document.querySelector('[data-suggestable-step="1"]');
          const top = (element) => element.getBoundingClientRect().top;

          return {
            editTop: top(step.querySelector('[data-suggest]')),
            headTop: top(step.firstElementChild),
            blockTop: top(step.querySelector('[data-suggested]')),
          };
        })()`)
        );

        assert.isBelow(Math.abs(where.editTop - where.headTop), 12);
        assert.isBelow(where.editTop, where.blockTop);

        // The suggestion's own Edit and Discard sit together in its block.
        assert.strictEqual(
          yield* count(
            page,
            `${panel} [data-suggestable="steps.1.detail"] [data-suggested] button`
          ),
          2
        );
        assert.strictEqual(
          yield* count(
            page,
            `${panel} [data-suggestable="steps.1.detail"] [data-suggested] [data-suggest]`
          ),
          0
        );
      }),
    60_000
  );

  it.live(
    "use one heading for each section, with the field named for a screen reader",
    () =>
      Effect.gen(function* () {
        const { page } = yield* served;

        yield* pin(page, "server");

        const headed = (heading: string, label: string) =>
          Effect.promise(() =>
            page.evaluate<{ shown: number; named: boolean }>(`(() => {
            const section = [...document.querySelectorAll("[data-structure-panel] section")]
              .find((candidate) => candidate.querySelector("h3")?.textContent === ${literal(heading)});
            const area = section.querySelector("textarea");

            return {
              shown: [...section.querySelectorAll("label")].filter((label) => getComputedStyle(label).position !== "absolute").length,
              named: document.querySelector('label[for="' + area.id + '"]').textContent === ${literal(label)},
            };
          })()`)
          );

        for (const [heading, label] of [
          ["Raise a question", "A new question about this"],
          ["Notes", "Pin a note"],
        ] as const) {
          const found = yield* headed(heading, label);

          // The heading is shown once; the box's label is not shown again.
          assert.strictEqual(found.shown, 0, heading);
          assert.isTrue(found.named, heading);
          assert.strictEqual(
            yield* Effect.promise(() =>
              page.getByRole("textbox", { name: label }).count()
            ),
            1,
            heading
          );
        }
      })
  );
});
