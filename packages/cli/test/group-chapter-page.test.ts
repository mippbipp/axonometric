import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect, String as Str } from "effect";
import type { Page } from "playwright";

import {
  click,
  count,
  goToChapterPaused,
  showViewFitted,
  textOf,
  waitFor,
  waitTimeout,
} from "./browser.ts";
import { crosses, drawingReport } from "./drawing-report.ts";
import type { Drawn, DrawingReport } from "./drawing-report.ts";
import { openReviewMap, proposalsOrEmpty } from "./harness.ts";

// Seam 2: group and chapter proposals in a page that a real serve serves. The
// review map's chapters are c-page (engineer, page), c-save (server,
// proposals) and c-all (the rest), and its hops h-note, h-save, h-store, h-pr.

const served = openReviewMap({});

/** Waits until proposals.json holds `wanted` open chapter proposals. */
const waitForChapters = (page: Page, home: string, wanted: number) =>
  Effect.gen(function* () {
    for (let tries = 0; tries < 60; tries += 1) {
      const held = yield* proposalsOrEmpty(home);

      if ((held.chapters ?? []).length === wanted) {
        return held;
      }

      yield* Effect.promise(() => page.waitForTimeout(100));
    }

    return yield* proposalsOrEmpty(home);
  });

const middleOf = Effect.fnUntraced(function* (page: Page, selector: string) {
  const box = yield* Effect.promise(() =>
    page.locator(selector).first().boundingBox()
  );

  assert.isNotNull(box, `${selector} isn't on screen`);

  return box === null
    ? { x: 0, y: 0 }
    : { x: box.x + box.width / 2, y: box.y + box.height / 2 };
});

/** Unpins and clears the selection, so the side panel shows the chapter. */
const unpin = Effect.fnUntraced(function* (page: Page) {
  yield* Effect.promise(() => page.keyboard.press("Escape"));
  yield* Effect.promise(() => page.keyboard.press("Escape"));
  yield* waitFor(page, "[data-chapter-editor]");
});

/** Picks two structures together and creates a group from them. */
const makeGroup = Effect.fnUntraced(function* (page: Page, title: string) {
  yield* click(page, '[data-structure="server"]');
  yield* Effect.promise(() =>
    page.locator('[data-structure="server"]').click({ modifiers: ["Shift"] })
  );
  yield* Effect.promise(() =>
    page.locator('[data-structure="proposals"]').click({ modifiers: ["Shift"] })
  );
  yield* click(page, '[data-control="add-group"]');
  yield* waitFor(page, "[data-new-group]");
  yield* Effect.promise(() =>
    page.locator("[data-new-group-title]").fill(title)
  );
  yield* click(page, "[data-new-group-submit]");
  yield* waitFor(page, "[data-pending-zone]");
});

describe("creating a group", () => {
  it.live(
    "from two selected structures, drawn in the pending look in both views",
    () =>
      Effect.gen(function* () {
        const { home, page, errors } = yield* served;

        yield* goToChapterPaused(page, "c-save");
        yield* makeGroup(page, "Data layer");

        const held = yield* proposalsOrEmpty(home);

        assert.strictEqual(held.groups?.length, 1);
        assert.deepStrictEqual(
          Arr.map(held.structures ?? [], ({ change }) =>
            change.action === "group" ? change.structure : ""
          ),
          ["server", "proposals"]
        );

        for (const which of ["iso", "plan"] as const) {
          yield* showViewFitted(page, which);
          const value = yield* count(page, "[data-pending-zone]");
          assert.strictEqual(value, 1);

          const value_1 = yield* count(
            page,
            '[data-structure="server"][data-pending="true"]'
          );

          assert.strictEqual(value_1, 1);
        }

        const value = yield* textOf(page, "[data-side-index]");
        // The side index lists the new group with its members.
        assert.include(value, "Data layer");
        assert.deepStrictEqual(errors, []);
      }),
    90_000
  );

  it.live(
    "empty, from the same form with nothing selected",
    () =>
      Effect.gen(function* () {
        const { home, page } = yield* served;

        yield* click(page, '[data-control="add-group"]');
        yield* Effect.promise(() =>
          page.locator("[data-new-group-title]").fill("Spare")
        );
        const value = yield* textOf(page, "[data-new-group-members]");
        assert.include(value, "starts empty");
        yield* click(page, "[data-new-group-submit]");
        yield* click(page, '[role="tab"][data-tab="pending"]');
        yield* waitFor(page, "[data-review-item]");

        const held = yield* proposalsOrEmpty(home);

        assert.strictEqual(held.groups?.length, 1);
        assert.deepStrictEqual(held.structures ?? [], []);
      }),
    90_000
  );
});

describe("renaming a group", () => {
  it.live(
    "from the zone's title and the group's panel, drawing the zone pending, and refuses a title another group has",
    () =>
      Effect.gen(function* () {
        const { home, page } = yield* served;

        yield* goToChapterPaused(page, "c-all");

        const title = yield* middleOf(page, '[data-zone-title-hit="loop"]');

        yield* Effect.promise(() => page.mouse.click(title.x, title.y));
        yield* waitFor(page, '[data-group-panel="loop"]');

        yield* Effect.promise(() =>
          page.locator("[data-group-title]").fill("The save loop")
        );
        yield* click(page, "[data-group-rename]");
        yield* waitFor(page, '[data-pending-zone="loop"]');

        // The Pending tab names the title the map has now, not the new one.
        yield* click(page, '[role="tab"][data-tab="pending"]');
        yield* waitFor(page, '[data-review-kind="group"]');
        const value = yield* textOf(page, '[data-review-kind="group"]');
        assert.include(value, "Rename the group The loop to The save loop");
        yield* click(page, '[role="tab"][data-tab="details"]');

        const held = yield* proposalsOrEmpty(home);

        assert.deepStrictEqual(
          Arr.map(held.groups ?? [], ({ change }) => change),
          [{ action: "rename", group: "loop", title: "The save loop" }]
        );

        // Renaming it back to the title the map has takes the proposal away.
        yield* Effect.promise(() =>
          page.locator("[data-group-title]").fill("The loop")
        );
        yield* click(page, "[data-group-rename]");
        yield* Effect.promise(() =>
          page
            .locator('[data-pending-zone="loop"]')
            .waitFor({ state: "detached", ...waitTimeout })
        );

        // A title another group has is refused in the panel.
        yield* Effect.promise(() =>
          page.locator("[data-group-title]").fill("People")
        );
        yield* click(page, "[data-group-rename]");
        yield* waitFor(page, "[data-group-failure]");
        const value_2 = yield* textOf(page, "[data-group-failure]");
        assert.include(value_2, "already has a group");
      }),
    90_000
  );
});

describe("a chapter proposal", () => {
  it.live(
    "shows its pending look in its chapter and in no other",
    () =>
      Effect.gen(function* () {
        const { home, page } = yield* served;

        yield* goToChapterPaused(page, "c-save");
        yield* click(page, '[data-structure="server"]');
        yield* click(page, '[data-chapter-toggle="hide"]');
        yield* waitFor(page, '[data-chapter-mark="hide"]');

        const held = yield* waitForChapters(page, home, 1);

        assert.strictEqual(held.chapters?.length, 1);

        const value = yield* count(
          page,
          '[data-chapter-mark="hide"][data-chapter-mark-of="server"]'
        );

        // c-save shows the ring, and a chapter that also draws the structure
        // does not.
        assert.strictEqual(value, 1);

        yield* goToChapterPaused(page, "c-all");
        const value_3 = yield* count(page, '[data-structure="server"]');
        assert.strictEqual(value_3, 1);
        const value_4 = yield* count(page, "[data-chapter-mark]");
        assert.strictEqual(value_4, 0);

        const value_5 = yield* count(
          page,
          '[data-structure="server"][data-pending="true"]'
        );

        assert.strictEqual(value_5, 0);

        yield* goToChapterPaused(page, "c-save");

        const value_6 = yield* count(
          page,
          '[data-structure="server"][data-pending="true"]'
        );

        assert.strictEqual(value_6, 1);
      }),
    90_000
  );

  it.live(
    "reveals a structure in its chapter, from the panel's list",
    () =>
      Effect.gen(function* () {
        const { home, page } = yield* served;

        yield* goToChapterPaused(page, "c-save");
        yield* click(page, '[data-reveal="pull-request"]');
        yield* waitForChapters(page, home, 1);
        yield* waitFor(
          page,
          '[data-chapter-mark="reveal"][data-chapter-mark-of="pull-request"]'
        );

        yield* goToChapterPaused(page, "c-page");
        const value = yield* count(page, "[data-chapter-mark]");
        assert.strictEqual(value, 0);
        const value_7 = yield* count(page, '[data-structure="pull-request"]');
        assert.strictEqual(value_7, 0);
      }),
    90_000
  );

  it.live(
    "hides from the context menu",
    () =>
      Effect.gen(function* () {
        const { home, page } = yield* served;

        yield* goToChapterPaused(page, "c-save");
        yield* Effect.promise(() =>
          page
            .locator('[data-structure="proposals"]')
            .click({ button: "right" })
        );
        yield* waitFor(page, '[data-structure-menu="proposals"]');
        const value = yield* textOf(page, '[data-menu="chapter-toggle"]');
        assert.include(value, "Hide from this chapter");
        yield* click(page, '[data-menu="chapter-toggle"]');
        yield* waitForChapters(page, home, 1);
        yield* waitFor(page, '[data-chapter-mark="hide"]');
      }),
    90_000
  );

  it.live(
    "reorders the plays by dragging a row",
    () =>
      Effect.gen(function* () {
        const { home, page } = yield* served;

        yield* goToChapterPaused(page, "c-save");
        yield* Effect.promise(() =>
          page
            .locator('[data-play="h-store"]')
            .dragTo(page.locator('[data-play="h-note"]'))
        );

        const held = yield* waitForChapters(page, home, 1);

        assert.deepStrictEqual(
          Arr.map(held.chapters ?? [], ({ change }) =>
            change.action === "order" ? change.plays : []
          ),
          [["h-store", "h-note", "h-save"]]
        );
      }),
    90_000
  );

  it.live(
    "reorders the plays with the keyboard",
    () =>
      Effect.gen(function* () {
        const { home, page } = yield* served;

        yield* goToChapterPaused(page, "c-save");
        yield* Effect.promise(() =>
          page.locator('[data-play-down="h-note"]').focus()
        );
        yield* Effect.promise(() => page.keyboard.press("Enter"));

        const held = yield* waitForChapters(page, home, 1);

        assert.deepStrictEqual(
          Arr.map(held.chapters ?? [], ({ change }) =>
            change.action === "order" ? change.plays : []
          ),
          [["h-save", "h-note", "h-store"]]
        );
        yield* waitFor(
          page,
          '[data-chapter-mark="order"], [data-play-up="h-note"]'
        );
      }),
    90_000
  );

  it.live(
    "adds a hop to a chapter and flags the ends it hasn't revealed",
    () =>
      Effect.gen(function* () {
        const { home, page } = yield* served;

        yield* goToChapterPaused(page, "c-page");
        yield* Effect.promise(() =>
          page.locator("[data-add-play-hop]").selectOption("h-store")
        );
        yield* click(page, "[data-add-play-submit]");
        yield* waitForChapters(page, home, 1);
        yield* waitFor(page, '[data-play="h-store"][data-play-pending="play"]');

        // The panel says which structures the chapter lacks.
        yield* waitFor(page, '[data-play="h-store"] [data-play-lacks]');
      }),
    90_000
  );
});

describe("the Pending tab", () => {
  it.live(
    "lists diagram changes and chapter changes in separate sections, each item once",
    () =>
      Effect.gen(function* () {
        const { page } = yield* served;

        yield* goToChapterPaused(page, "c-save");
        yield* makeGroup(page, "Data layer");
        yield* unpin(page);
        yield* click(page, '[data-reveal="pull-request"]');
        yield* click(page, '[role="tab"][data-tab="pending"]');
        yield* waitFor(page, '[data-review-section="chapter"]');

        const value = yield* count(page, "[data-review-section]");
        assert.strictEqual(value, 2);

        const value_8 = yield* textOf(
          page,
          '[data-review-section="diagram"] h3'
        );

        assert.include(value_8, "Diagram changes");

        const value_9 = yield* textOf(
          page,
          '[data-review-section="chapter"] h3'
        );

        assert.include(value_9, "Chapter changes");

        const value_10 = yield* count(
          page,
          '[data-review-section="chapter"] [data-review-kind="chapter"]'
        );

        assert.strictEqual(value_10, 1);

        const value_11 = yield* count(
          page,
          '[data-review-section="diagram"] [data-review-kind="chapter"]'
        );

        assert.strictEqual(value_11, 0);

        // Each item is listed once, and there's no old structures heading.
        const ids = yield* Effect.promise(() =>
          page.evaluate<readonly string[]>(
            `[...document.querySelectorAll("[data-side-panel] [data-review-item]")].map((row) => row.getAttribute("data-review-item"))`
          )
        );

        assert.isAbove(ids.length, 2);
        assert.strictEqual(new Set(ids).size, ids.length, Arr.join(ids, ", "));
        const value_12 = yield* count(page, "[data-pending-structures]");
        assert.strictEqual(value_12, 0);

        const value_13 = yield* count(
          page,
          "[data-side-panel] h3:text-is('Structure proposals')"
        );

        assert.strictEqual(value_13, 0);
      }),
    90_000
  );
});

/** Every pending ring piece that crosses a visible name tag, code chip, zone title or hop label. */
const ringsOverText = (report: DrawingReport): readonly string[] => {
  const text: readonly Drawn[] = [...report.text, ...report.chips];

  return Arr.flatMap(report.rings, ({ id, segment }) =>
    Arr.flatMap(text, (other) =>
      crosses(segment, other.polygon) ? [`${id} × ${other.id}`] : []
    )
  );
};

const reportOf = (page: Page) =>
  Effect.promise(() => page.evaluate<DrawingReport>(drawingReport));

describe("the pending rings and lines", () => {
  it.live(
    "stay clear of every name tag, chip, zone title and hop label, in both views",
    () =>
      Effect.gen(function* () {
        const { page, errors } = yield* served;

        yield* goToChapterPaused(page, "c-save");
        yield* makeGroup(page, "Data layer");
        yield* unpin(page);
        yield* click(page, '[data-reveal="pull-request"]');
        yield* waitFor(page, '[data-chapter-mark="reveal"]');
        yield* click(page, '[data-structure="proposals"]');
        yield* click(page, '[data-chapter-toggle="hide"]');
        yield* waitFor(page, '[data-chapter-mark="hide"]');
        yield* unpin(page);

        for (const which of ["iso", "plan"] as const) {
          yield* showViewFitted(page, which);

          const report = yield* reportOf(page);

          // The rings and zone titles are drawn, so the check has something
          // to check.
          assert.isAbove(report.rings.length, 4, `${which}: no rings drawn`);
          assert.isAbove(
            Arr.filter(report.text, ({ id }) => Str.startsWith("title:")(id))
              .length,
            0,
            `${which}: no zone titles drawn`
          );
          assert.deepStrictEqual(ringsOverText(report), [], which);
        }

        assert.deepStrictEqual(errors, []);
      }),
    90_000
  );
});

/** The warnings as one line each, for an assertion's message. */
const words = (found: readonly { message: string; isNew: boolean }[]) =>
  Arr.join(
    Arr.map(found, ({ message, isNew }) => `${isNew ? "NEW " : ""}${message}`),
    " | "
  );

const warnings = (page: Page) =>
  Effect.promise(() =>
    page.evaluate<readonly { message: string; isNew: boolean }[]>(
      `[...document.querySelectorAll("[data-drag-warning]")].map((item) => ({ message: item.querySelector("[data-warning-message]").textContent, isNew: item.getAttribute("data-warning-new") === "true" }))`
    )
  );

describe("the warnings panel for group and chapter proposals", () => {
  it.live(
    "warns, marked New from this change, while the new group's form is open",
    () =>
      Effect.gen(function* () {
        const { page } = yield* served;

        yield* goToChapterPaused(page, "c-all");
        yield* click(page, '[data-structure="server"]');
        yield* Effect.promise(() =>
          page
            .locator('[data-structure="server"]')
            .click({ modifiers: ["Shift"] })
        );
        yield* Effect.promise(() =>
          page
            .locator('[data-structure="proposals"]')
            .click({ modifiers: ["Shift"] })
        );
        yield* click(page, '[data-control="add-group"]');
        yield* Effect.promise(() =>
          page.locator("[data-new-group-title]").fill("Data layer")
        );
        yield* waitFor(page, "[data-drag-warnings]");

        const open = yield* warnings(page);

        assert.isTrue(
          Arr.some(
            open,
            ({ message, isNew }) =>
              isNew &&
              /zones of groups "loop" and "data-layer-\w+" overlap/u.test(
                message
              )
          ),
          words(open)
        );
        const value = yield* textOf(page, "[data-warning-badge]");
        assert.include(value, "New from this change");

        // Still there after the group is sent.
        yield* click(page, "[data-new-group-submit]");
        yield* waitFor(page, "[data-pending-zone]");

        const sent = yield* warnings(page);

        assert.isTrue(
          Arr.some(sent, ({ message }) => Str.includes("overlap")(message)),
          words(sent)
        );
      }),
    90_000
  );

  it.live(
    "warns for a chapter proposal, in the chapter viewed",
    () =>
      Effect.gen(function* () {
        const { page } = yield* served;

        yield* goToChapterPaused(page, "c-save");
        yield* makeGroup(page, "Data layer");
        yield* unpin(page);
        yield* click(page, '[data-reveal="pull-request"]');
        yield* waitFor(page, "[data-drag-warnings]");

        const shown = yield* warnings(page);

        assert.isTrue(
          Arr.some(
            shown,
            ({ message, isNew }) =>
              isNew &&
              Str.includes("overlap")(message) &&
              Str.includes('chapter "c-save"')(message)
          ),
          words(shown)
        );
      }),
    90_000
  );
});

describe("the chapter details for a proposal", () => {
  it.live(
    "say Proposed order on the rows an order moved, and explain play and unplay",
    () =>
      Effect.gen(function* () {
        const { page } = yield* served;

        yield* goToChapterPaused(page, "c-save");
        yield* click(page, '[data-play-down="h-note"]');
        yield* waitFor(page, '[data-play-pending="order"]');

        const moved = yield* Effect.promise(() =>
          page.evaluate<readonly string[]>(
            `[...document.querySelectorAll('[data-play-pending="order"] [data-play-state]')].map((el) => el.textContent)`
          )
        );

        assert.isAbove(moved.length, 0);
        assert.isTrue(Arr.every(moved, (said) => said === "Proposed order"));

        yield* click(page, '[data-play-toggle="h-store"]');
        yield* waitFor(page, '[data-play-pending="unplay"]');

        const value = yield* textOf(
          page,
          '[data-play-pending="unplay"] [data-play-state]'
        );

        assert.include(value, "Proposed to stop playing");

        yield* Effect.promise(() =>
          page.locator("[data-add-play-hop]").selectOption("h-pr")
        );
        yield* click(page, "[data-add-play-submit]");
        yield* waitFor(page, '[data-play-pending="play"]');

        const value_14 = yield* textOf(
          page,
          '[data-play-pending="play"] [data-play-state]'
        );

        assert.include(value_14, "Proposed to play");
      }),
    90_000
  );

  it.live(
    "show a key for the looks in use, and only those",
    () =>
      Effect.gen(function* () {
        const { page } = yield* served;

        yield* goToChapterPaused(page, "c-save");
        const value = yield* count(page, "[data-chapter-legend]");
        assert.strictEqual(value, 0);

        yield* click(page, '[data-reveal="pull-request"]');
        yield* waitFor(page, '[data-legend="reveal"]');
        const value_15 = yield* textOf(page, '[data-legend="reveal"]');
        assert.include(value_15, "Proposed to show");
        const value_16 = yield* count(page, '[data-legend="hide"]');
        assert.strictEqual(value_16, 0);

        yield* click(page, '[data-structure="proposals"]');
        yield* click(page, '[data-chapter-toggle="hide"]');
        yield* unpin(page);
        yield* waitFor(page, '[data-legend="hide"]');
        const value_17 = yield* textOf(page, '[data-legend="hide"]');
        assert.include(value_17, "Proposed to hide");

        // Another chapter shows none of it.
        yield* goToChapterPaused(page, "c-page");
        const value_18 = yield* count(page, "[data-chapter-legend]");
        assert.strictEqual(value_18, 0);
      }),
    90_000
  );
});
