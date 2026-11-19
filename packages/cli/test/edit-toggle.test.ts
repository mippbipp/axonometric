import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import type { Page } from "playwright";

import {
  attributesOf,
  boxesOf,
  centreOf,
  click,
  count,
  goToChapter,
  press,
  showView,
  textOf,
  unitOnScreen,
  waitFor,
  waitGone,
} from "./browser.ts";
import { fullMap } from "./fixtures.ts";
import {
  buildAndOpen,
  openReviewMap,
  proposalsText,
  readProposals,
} from "./harness.ts";

// The Edit toggle: a served page starts for reading, and Edit brings back the
// controls that change the map. The read-only file has no Edit at all.

const toolbar = "[data-edit-toolbar]";

const editButton = "[data-edit-toggle]";

/** The review map served with Edit off, as a first visit finds it. */
const firstVisit = openReviewMap({}, { edit: false });

const pressed = (page: Page) =>
  Effect.promise(() => page.locator(editButton).getAttribute("aria-pressed"));

/** The page's boxes for `a` and `b` do not overlap. */
const apart = (
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number }
) =>
  a.x + a.width <= b.x ||
  b.x + b.width <= a.x ||
  a.y + a.height <= b.y ||
  b.y + b.height <= a.y;

describe("edit, off by default", () => {
  it.live(
    "hides the toolbar, dragging, edge handles and the chapter panel's editing controls",
    () =>
      Effect.gen(function* () {
        const { page, home, errors } = yield* firstVisit;

        const value = yield* pressed(page);
        assert.strictEqual(value, "false");
        const value_1 = yield* count(page, toolbar);
        assert.strictEqual(value_1, 0);
        const value_2 = yield* count(page, "[data-ready-for-review]");
        assert.strictEqual(value_2, 0);
        const value_3 = yield* count(page, '[data-tab="flows"]');
        assert.strictEqual(value_3, 0);
        const value_4 = yield* count(page, "[data-add-play]");
        assert.strictEqual(value_4, 0);
        const value_5 = yield* count(page, "[data-reveal]");
        assert.strictEqual(value_5, 0);
        const value_6 = yield* count(page, "[data-play-up]");
        assert.strictEqual(value_6, 0);
        const value_7 = yield* count(page, '[data-layout-editor="on"]');
        assert.strictEqual(value_7, 0);
        const value_8 = yield* count(page, '[data-group-editor="on"]');
        assert.strictEqual(value_8, 0);
        const value_9 = yield* count(page, '[data-route-editor="on"]');
        assert.strictEqual(value_9, 0);

        const value_10 = yield* count(page, '[data-tab="pending"]');
        // Pending and History stay, since they are part of reading.
        assert.strictEqual(value_10, 1);
        const value_11 = yield* count(page, '[data-tab="history"]');
        assert.strictEqual(value_11, 1);

        yield* goToChapter(page, "c-all");
        yield* showView(page, "plan");

        const unit = yield* unitOnScreen(page, "plan");
        const from = yield* centreOf(page, '[data-structure="engineer"]');

        yield* Effect.promise(() => page.mouse.move(from.x, from.y));
        yield* Effect.promise(() => page.mouse.down());
        yield* Effect.promise(() =>
          page.mouse.move(from.x + unit, from.y + unit * 3, { steps: 12 })
        );
        yield* Effect.promise(() => page.mouse.up());

        const value_12 = yield* count(page, '[data-pending="true"]');
        assert.strictEqual(value_12, 0);
        const value_13 = yield* count(page, "[data-edge-handles] circle");
        assert.strictEqual(value_13, 0);
        const value_14 = yield* proposalsText(home);
        assert.strictEqual(value_14, "");

        assert.deepStrictEqual(errors, []);
      })
  );

  it.live("shows no editing hint but offers e, and no Shift-click hint", () =>
    Effect.gen(function* () {
      const { page } = yield* firstVisit;

      const hints = yield* Effect.promise(() =>
        page.locator("[data-hint]").allTextContents()
      );

      assert.include(hints, "e edits");
      assert.notInclude(hints, "Shift-click or Shift-drag selects several");
      assert.notInclude(hints, "+ and − zoom, 0 fits");
    })
  );

  it.live("hides a structure's editing controls but keeps Answer", () =>
    Effect.gen(function* () {
      const { page, home } = yield* firstVisit;

      yield* goToChapter(page, "c-all");
      yield* click(page, '[data-structure="server"]');
      yield* waitFor(page, '[data-structure-panel="server"][data-pinned]');

      const value = yield* count(page, "[data-change-structure]");
      assert.strictEqual(value, 0);
      const value_15 = yield* count(page, "[data-chapter-reveal]");
      assert.strictEqual(value_15, 0);
      const value_16 = yield* count(page, "[data-notes-section]");
      assert.strictEqual(value_16, 0);
      const value_17 = yield* count(page, "[data-raised-section]");
      assert.strictEqual(value_17, 0);
      const value_18 = yield* count(page, "[data-suggest]");
      assert.strictEqual(value_18, 0);

      yield* click(page, '[role="tab"][data-tab="questions"]');
      yield* click(page, '[data-question="Q-S1"] [data-answer-open="Q-S1"]');
      yield* Effect.promise(() =>
        page
          .locator('[data-question="Q-S1"] [data-note-text]')
          .fill("5178 first.")
      );
      yield* click(page, '[data-question="Q-S1"] [data-note-send]');
      yield* waitFor(page, '[data-question="Q-S1"] [data-answer]');

      const proposals = yield* readProposals(home);

      assert.strictEqual(proposals.answers?.[0]?.text, "5178 first.");

      const value_19 = yield* textOf(page, "[data-ready-for-review]");
      // Ready for review shows once something waits to be sent.
      assert.strictEqual(value_19, "Ready for review · 1");

      // The answer is reading, so it can be discarded from Pending too, while
      // a note or a suggestion could not be.
      yield* click(page, '[role="tab"][data-tab="pending"]');
      yield* click(page, "[data-review-item] button:has-text('Discard')");
      yield* waitGone(page, "[data-review-item]");
      const value_20 = yield* count(page, "[data-ready-for-review]");
      assert.strictEqual(value_20, 0);
    })
  );
});

describe("turning Edit on", () => {
  it.live(
    "the button and the e key switch it, and the browser remembers it",
    () =>
      Effect.gen(function* () {
        const { page } = yield* firstVisit;

        yield* click(page, editButton);
        yield* waitFor(page, toolbar);
        const value = yield* pressed(page);
        assert.strictEqual(value, "true");

        const value_21 = yield* count(page, "[data-ready-for-review]");
        // Nothing waits, so there is nothing to send, with Edit on or off.
        assert.strictEqual(value_21, 0);

        yield* Effect.promise(() => page.reload());
        yield* waitFor(page, toolbar);
        const value_22 = yield* pressed(page);
        assert.strictEqual(value_22, "true");

        yield* press(page, "e");
        yield* waitGone(page, toolbar);
        const value_23 = yield* pressed(page);
        assert.strictEqual(value_23, "false");

        yield* Effect.promise(() => page.reload());
        yield* waitFor(page, editButton);
        const value_24 = yield* count(page, toolbar);
        assert.strictEqual(value_24, 0);

        yield* press(page, "e");
        yield* waitFor(page, toolbar);
      })
  );

  it.live("e is left alone while typing in a field", () =>
    Effect.gen(function* () {
      const { page } = yield* firstVisit;

      yield* goToChapter(page, "c-all");
      yield* click(page, '[data-structure="server"]');
      yield* click(page, '[role="tab"][data-tab="questions"]');
      yield* click(page, '[data-question="Q-S1"] [data-answer-open="Q-S1"]');
      yield* Effect.promise(() =>
        page.locator('[data-question="Q-S1"] [data-note-text]').press("e")
      );

      const value = yield* pressed(page);
      assert.strictEqual(value, "false");
    })
  );

  it.live("turning it off closes an open add form and the Note tool", () =>
    Effect.gen(function* () {
      const { page } = yield* openReviewMap({});

      yield* click(page, '[data-control="add-structure"]');
      yield* waitFor(page, "[data-add-structure-panel]");
      yield* click(page, editButton);
      yield* waitGone(page, "[data-add-structure-panel]");
      yield* waitGone(page, toolbar);
    })
  );

  it.live("keeps the toolbar clear of the chapter title at 1280 × 800", () =>
    Effect.gen(function* () {
      const { page } = yield* openReviewMap({});

      const chapters = yield* attributesOf(
        page,
        "[data-chapter-rail] button[data-chapter]",
        "data-chapter"
      );

      assert.isAbove(chapters.length, 1);

      for (const chapter of chapters) {
        yield* goToChapter(page, chapter);

        for (const view of ["iso", "plan"] as const) {
          yield* showView(page, view);

          const [rail] = yield* boxesOf(page, "[data-chapter-rail]");
          const [bar] = yield* boxesOf(page, toolbar);
          const [title] = yield* boxesOf(page, "[data-chapter-rail] > span");

          assert.isDefined(rail);
          assert.isDefined(bar);
          assert.isDefined(title);

          if (rail !== undefined && bar !== undefined && title !== undefined) {
            assert.isTrue(apart(bar, title));
            assert.isTrue(apart(bar, rail));
          }
        }
      }
    })
  );
});

describe("the read-only file", () => {
  it.live("has no Edit button and no editing controls", () =>
    Effect.gen(function* () {
      const fullMap_1 = yield* fullMap;
      const opened = yield* buildAndOpen(fullMap_1, "review");

      const value = yield* count(opened.page, editButton);
      assert.strictEqual(value, 0);
      const value_25 = yield* count(opened.page, toolbar);
      assert.strictEqual(value_25, 0);

      yield* press(opened.page, "e");
      const value_26 = yield* count(opened.page, toolbar);
      assert.strictEqual(value_26, 0);

      const hints = yield* Effect.promise(() =>
        opened.page.locator("[data-hint]").allTextContents()
      );

      assert.notInclude(hints, "e edits");
    })
  );
});
