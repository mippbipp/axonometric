import { ReviewReport } from "@axonometric/contracts";
import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect, Schema } from "effect";
import type { Locator, Page } from "playwright";

import { click, count, textOf, waitFor, waitTimeout } from "./browser.ts";
import { openReviewMap, readProposals, runCli } from "./harness.ts";

// Words on the page, against a real serve: a text suggestion shown beside the
// original, an answer, a raised question, and notes on a hop and an empty spot.

const decodeReview = Schema.decodeUnknownEffect(
  Schema.fromJsonString(ReviewReport)
);

const served = openReviewMap({});

const fill = (page: Page, selector: string, text: string) =>
  Effect.promise(() => page.locator(selector).first().fill(text));

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
    "can be made on one part of a step, or both with a single Edit, which names the step",
    () =>
      Effect.gen(function* () {
        const { home, page } = yield* served;

        yield* click(page, '[data-chapter-rail] button[data-chapter="c-page"]');
        yield* click(page, '[data-structure="page"]');
        yield* waitFor(page, '[data-structure-panel="page"][data-pinned]');

        // Changing only one part of a step suggests only that part.
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
            [
              "steps.0.detail",
              "The engineer pins a note to a structure.",
              "The engineer pins a note to a structure, hop or spot.",
            ],
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
          .waitFor({ state: "detached", ...waitTimeout })
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

  it.live(
    "is raised on a structure, listed in Pending with a Discard and counted, and the button freezes it as a new question with no id",
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

        assert.deepStrictEqual(
          Arr.map(
            (yield* readProposals(home)).raised ?? [],
            ({ target, text }) => [target.id, text]
          ),
          [["server", "Should writes retry?"]]
        );

        const row = '[data-review-item][data-review-kind="question"]';

        yield* click(page, '[role="tab"][data-tab="pending"]');
        yield* waitFor(page, row);

        assert.include(
          yield* textOf(page, row),
          "New question on Save server: Should writes retry?"
        );
        assert.strictEqual(
          yield* count(page, `${row} button:has-text("Discard")`),
          1
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

        // The agent sees a new question with only its words: the page gave
        // it no question id.
        const reviewed = yield* runCli(home, ["review", home, "--json"]);
        const report = yield* decodeReview(reviewed.stdout);

        assert.notInclude(reviewed.stdout, '"Q-');

        assert.deepStrictEqual(
          Arr.map(report.batch?.items ?? [], ({ kind, before, after }) => ({
            kind,
            before,
            after,
          })),
          [
            {
              kind: "question",
              before: null,
              after: { text: "Should writes retry?" },
            },
          ]
        );
      }),
    60_000
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
    "lists a suggestion, an answer from the panel and a raised question under one heading, and each button names what it acts on",
    () =>
      Effect.gen(function* () {
        const { home, page } = yield* served;

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
        yield* fill(
          page,
          `${panel} [data-raised-section] [data-note-text]`,
          "Should writes retry?"
        );
        yield* click(page, `${panel} [data-raised-section] [data-note-send]`);
        yield* waitFor(page, `${panel} [data-raised-question]`);

        assert.strictEqual(
          (yield* readProposals(home)).answers?.[0]?.text,
          "Port 5178."
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

        yield* click(page, '[role="tab"][data-tab="pending"]');
        yield* waitFor(page, '[data-review-kind="question"]');

        assert.strictEqual(yield* count(page, "[data-pending-empty]"), 0);
        assert.strictEqual(yield* count(page, "[data-review-list]"), 1);
        assert.include(
          yield* textOf(page, "[data-review-list] h3"),
          "Diagram changes"
        );
        assert.sameMembers(
          yield* Effect.promise(() =>
            page.evaluate<string[]>(
              "[...document.querySelectorAll('[data-review-list] [data-review-item]')].map((item) => item.dataset.reviewKind)"
            )
          ),
          ["suggestion", "answer", "question"]
        );
      }),
    60_000
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

/** The on-screen box of the first element `locator` matches. */
const boxOf = (locator: Locator) =>
  Effect.promise(() => locator.first().boundingBox()).pipe(
    Effect.map((box) => box ?? { x: 0, y: 0, width: 0, height: 0 })
  );

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
        ];

        // Every button is the size of the panel's Pin note.
        const reference = sizes["Pin note"];

        assert.isDefined(reference, "Pin note is not in the panel");

        for (const name of wanted) {
          assert.deepStrictEqual(sizes[name], reference, name);
        }

        const step = page.locator(`${panel} [data-suggestable-step="1"]`);

        const edit = yield* boxOf(
          page.getByRole("button", { name: "Edit: step 2" })
        );

        const heading = yield* boxOf(step.getByText("Save", { exact: true }));

        const block = yield* boxOf(
          step.locator('[data-suggestable="steps.1.detail"] [data-suggested]')
        );

        // The step's Edit is on its heading's row, above the suggestion.
        assert.isBelow(edit.y, heading.y + heading.height);
        assert.isBelow(heading.y, edit.y + edit.height);
        assert.isAtMost(edit.y + edit.height, block.y);

        // The suggestion's own Edit and Discard sit inside its block.
        for (const name of wanted.slice(1)) {
          const button = yield* boxOf(page.getByRole("button", { name }));

          assert.isAtLeast(button.y, block.y, name);
          assert.isAtMost(
            button.y + button.height,
            block.y + block.height,
            name
          );
        }
      }),
    60_000
  );

  it.live(
    "use one heading for each section, with the field named for a screen reader",
    () =>
      Effect.gen(function* () {
        const { page } = yield* served;

        yield* pin(page, "server");

        for (const [heading, name] of [
          ["Raise a question", "A new question about this"],
          ["Notes", "Pin a note"],
        ] as const) {
          const section = page
            .locator(`${panel} section`)
            .filter({ has: page.getByRole("heading", { name: heading }) });

          assert.strictEqual(
            yield* Effect.promise(() => section.count()),
            1,
            heading
          );

          // The box's label takes no room on screen: the heading says it.
          const labels = yield* Effect.promise(() =>
            section.locator("label").all()
          );

          const boxes = yield* Effect.forEach(labels, (label) =>
            Effect.promise(() => label.boundingBox())
          );

          const shown = Arr.filter(
            boxes,
            (box) => box !== null && box.width > 1 && box.height > 1
          ).length;

          assert.strictEqual(shown, 0, heading);
          assert.strictEqual(
            yield* Effect.promise(() =>
              section.getByRole("textbox", { name }).count()
            ),
            1,
            heading
          );
        }
      })
  );
});
