import { emptyProposals, Proposals } from "@axonometric/contracts";
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
import { crosses, drawingReport } from "./drawing-report.ts";
import type { Drawn, DrawingReport } from "./drawing-report.ts";
import { fullMap } from "./fixtures.ts";
import { makeHome, startServe } from "./harness.ts";

// Seam 2: group and chapter proposals in a page that a real serve serves. The
// review map's chapters are c-page (engineer, page), c-save (server,
// proposals) and c-all (the rest), and its hops h-note, h-save, h-store, h-pr.

const waitTimeout = { timeout: 15_000 };

const decodeProposals = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Proposals)
);

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

const click = (page: Page, selector: string) =>
  Effect.promise(() => page.locator(selector).first().click());

const waitFor = (page: Page, selector: string) =>
  Effect.promise(() => page.locator(selector).first().waitFor(waitTimeout));

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

const chapter = Effect.fnUntraced(function* (page: Page, id: string) {
  yield* click(page, `[data-chapter-rail] button[data-chapter="${id}"]`);
  yield* waitFor(page, `[data-walkthrough][data-chapter="${id}"]`);
  yield* click(page, '[data-playback-controls] [data-control="pause"]');
});

const view = Effect.fnUntraced(function* (page: Page, which: "iso" | "plan") {
  yield* click(page, `[data-view-toggle] [data-view="${which}"]`);
  yield* waitFor(page, `[data-walkthrough][data-view="${which}"]`);
  yield* Effect.promise(() => page.keyboard.press("0"));
});

const readProposals = Effect.fnUntraced(function* (home: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const file = path.join(home, "proposals.json");

  // The file is made by the first write.
  return (yield* fs.exists(file))
    ? yield* decodeProposals(yield* fs.readFileString(file))
    : emptyProposals;
}, Effect.provide(NodeServices.layer));

/** Waits until proposals.json holds `wanted` open chapter proposals. */
const waitForChapters = (page: Page, home: string, wanted: number) =>
  Effect.gen(function* () {
    for (let tries = 0; tries < 60; tries += 1) {
      const held = yield* readProposals(home);

      if ((held.chapters ?? []).length === wanted) {
        return held;
      }

      yield* Effect.promise(() => page.waitForTimeout(100));
    }

    return yield* readProposals(home);
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

        yield* chapter(page, "c-save");
        yield* makeGroup(page, "Data layer");

        const held = yield* readProposals(home);

        assert.strictEqual(held.groups?.length, 1);
        assert.deepStrictEqual(
          Arr.map(held.structures ?? [], ({ change }) =>
            change.action === "group" ? change.structure : ""
          ),
          ["server", "proposals"]
        );

        for (const which of ["iso", "plan"] as const) {
          yield* view(page, which);
          assert.strictEqual(yield* count(page, "[data-pending-zone]"), 1);
          assert.strictEqual(
            yield* count(
              page,
              '[data-structure="server"][data-pending="true"]'
            ),
            1
          );
        }

        // The side index lists the new group with its members.
        assert.include(yield* textOf(page, "[data-side-index]"), "Data layer");
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
        assert.include(
          yield* textOf(page, "[data-new-group-members]"),
          "starts empty"
        );
        yield* click(page, "[data-new-group-submit]");
        yield* click(page, '[role="tab"][data-tab="pending"]');
        yield* waitFor(page, "[data-review-item]");

        const held = yield* readProposals(home);

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

        yield* chapter(page, "c-all");

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
        assert.include(
          yield* textOf(page, '[data-review-kind="group"]'),
          "Rename the group The loop to The save loop"
        );
        yield* click(page, '[role="tab"][data-tab="details"]');

        const held = yield* readProposals(home);

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
        assert.include(
          yield* textOf(page, "[data-group-failure]"),
          "already has a group"
        );
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

        yield* chapter(page, "c-save");
        yield* click(page, '[data-structure="server"]');
        yield* click(page, '[data-chapter-toggle="hide"]');
        yield* waitFor(page, '[data-chapter-mark="hide"]');

        const held = yield* waitForChapters(page, home, 1);

        assert.strictEqual(held.chapters?.length, 1);

        // c-save shows the ring, and a chapter that also draws the structure
        // does not.
        assert.strictEqual(
          yield* count(
            page,
            '[data-chapter-mark="hide"][data-chapter-mark-of="server"]'
          ),
          1
        );

        yield* chapter(page, "c-all");
        assert.strictEqual(yield* count(page, '[data-structure="server"]'), 1);
        assert.strictEqual(yield* count(page, "[data-chapter-mark]"), 0);
        assert.strictEqual(
          yield* count(page, '[data-structure="server"][data-pending="true"]'),
          0
        );

        yield* chapter(page, "c-save");
        assert.strictEqual(
          yield* count(page, '[data-structure="server"][data-pending="true"]'),
          1
        );
      }),
    90_000
  );

  it.live(
    "reveals a structure in its chapter, from the panel's list",
    () =>
      Effect.gen(function* () {
        const { home, page } = yield* served;

        yield* chapter(page, "c-save");
        yield* click(page, '[data-reveal="pull-request"]');
        yield* waitForChapters(page, home, 1);
        yield* waitFor(
          page,
          '[data-chapter-mark="reveal"][data-chapter-mark-of="pull-request"]'
        );

        yield* chapter(page, "c-page");
        assert.strictEqual(yield* count(page, "[data-chapter-mark]"), 0);
        assert.strictEqual(
          yield* count(page, '[data-structure="pull-request"]'),
          0
        );
      }),
    90_000
  );

  it.live(
    "hides from the context menu",
    () =>
      Effect.gen(function* () {
        const { home, page } = yield* served;

        yield* chapter(page, "c-save");
        yield* Effect.promise(() =>
          page
            .locator('[data-structure="proposals"]')
            .click({ button: "right" })
        );
        yield* waitFor(page, '[data-structure-menu="proposals"]');
        assert.include(
          yield* textOf(page, '[data-menu="chapter-toggle"]'),
          "Hide from this chapter"
        );
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

        yield* chapter(page, "c-save");
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

        yield* chapter(page, "c-save");
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

        yield* chapter(page, "c-page");
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

        yield* chapter(page, "c-save");
        yield* makeGroup(page, "Data layer");
        yield* unpin(page);
        yield* click(page, '[data-reveal="pull-request"]');
        yield* click(page, '[role="tab"][data-tab="pending"]');
        yield* waitFor(page, '[data-review-section="chapter"]');

        assert.strictEqual(yield* count(page, "[data-review-section]"), 2);
        assert.include(
          yield* textOf(page, '[data-review-section="diagram"] h3'),
          "Diagram changes"
        );
        assert.include(
          yield* textOf(page, '[data-review-section="chapter"] h3'),
          "Chapter changes"
        );
        assert.strictEqual(
          yield* count(
            page,
            '[data-review-section="chapter"] [data-review-kind="chapter"]'
          ),
          1
        );
        assert.strictEqual(
          yield* count(
            page,
            '[data-review-section="diagram"] [data-review-kind="chapter"]'
          ),
          0
        );

        // Each item is listed once, and there's no old structures heading.
        const ids = yield* Effect.promise(() =>
          page.evaluate<readonly string[]>(
            `[...document.querySelectorAll("[data-side-panel] [data-review-item]")].map((row) => row.getAttribute("data-review-item"))`
          )
        );

        assert.isAbove(ids.length, 2);
        assert.strictEqual(new Set(ids).size, ids.length, Arr.join(ids, ", "));
        assert.strictEqual(yield* count(page, "[data-pending-structures]"), 0);
        assert.strictEqual(
          yield* count(
            page,
            "[data-side-panel] h3:text-is('Structure proposals')"
          ),
          0
        );
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

        yield* chapter(page, "c-save");
        yield* makeGroup(page, "Data layer");
        yield* unpin(page);
        yield* click(page, '[data-reveal="pull-request"]');
        yield* waitFor(page, '[data-chapter-mark="reveal"]');
        yield* click(page, '[data-structure="proposals"]');
        yield* click(page, '[data-chapter-toggle="hide"]');
        yield* waitFor(page, '[data-chapter-mark="hide"]');
        yield* unpin(page);

        for (const which of ["iso", "plan"] as const) {
          yield* view(page, which);

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

        yield* chapter(page, "c-all");
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
        assert.include(
          yield* textOf(page, "[data-warning-badge]"),
          "New from this change"
        );

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

        yield* chapter(page, "c-save");
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

        yield* chapter(page, "c-save");
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
        assert.include(
          yield* textOf(page, '[data-play-pending="unplay"] [data-play-state]'),
          "Proposed to stop playing"
        );

        yield* Effect.promise(() =>
          page.locator("[data-add-play-hop]").selectOption("h-pr")
        );
        yield* click(page, "[data-add-play-submit]");
        yield* waitFor(page, '[data-play-pending="play"]');
        assert.include(
          yield* textOf(page, '[data-play-pending="play"] [data-play-state]'),
          "Proposed to play"
        );
      }),
    90_000
  );

  it.live(
    "show a key for the looks in use, and only those",
    () =>
      Effect.gen(function* () {
        const { page } = yield* served;

        yield* chapter(page, "c-save");
        assert.strictEqual(yield* count(page, "[data-chapter-legend]"), 0);

        yield* click(page, '[data-reveal="pull-request"]');
        yield* waitFor(page, '[data-legend="reveal"]');
        assert.include(
          yield* textOf(page, '[data-legend="reveal"]'),
          "Proposed to show"
        );
        assert.strictEqual(yield* count(page, '[data-legend="hide"]'), 0);

        yield* click(page, '[data-structure="proposals"]');
        yield* click(page, '[data-chapter-toggle="hide"]');
        yield* unpin(page);
        yield* waitFor(page, '[data-legend="hide"]');
        assert.include(
          yield* textOf(page, '[data-legend="hide"]'),
          "Proposed to hide"
        );

        // Another chapter shows none of it.
        yield* chapter(page, "c-page");
        assert.strictEqual(yield* count(page, "[data-chapter-legend]"), 0);
      }),
    90_000
  );
});
