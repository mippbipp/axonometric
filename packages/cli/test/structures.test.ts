import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect } from "effect";
import type { Page } from "playwright";

import {
  assertCount,
  assertTextIncludes,
  attributesOf,
  boxesOf,
  click,
  goToChapter,
  literal,
  press,
  textOf,
  waitFor,
  waitGone,
} from "./browser.ts";
import { fullMap } from "./fixtures.ts";
import { buildAndOpen } from "./harness.ts";

// These tests click structures with real mouse clicks, not dispatched
// events: Playwright checks that the structure is what's under the pointer,
// so a redraw that stops clicks from landing fails them. Packets keep playing
// while they click, which redraws the view every frame.

const reviewPage = Effect.gen(function* () {
  const fullMapFiles = yield* fullMap;

  return yield* buildAndOpen(fullMapFiles, "review");
});

/** The review page at 1280 × 800, wide enough to show the side index. */
const widePage = Effect.gen(function* () {
  const opened = yield* reviewPage;

  yield* Effect.promise(() =>
    opened.page.setViewportSize({ height: 800, width: 1280 })
  );
  yield* waitFor(opened.page, "[data-side-index]");

  return opened;
});

const structure = (id: string) => `[data-structure="${id}"]`;

const indexItem = (id: string) =>
  `[data-side-index] button[data-index-structure="${id}"]`;

/** Clicks a structure and waits for its panel to say it's pinned. */
const pin = Effect.fnUntraced(function* (page: Page, id: string) {
  yield* click(page, structure(id));
  yield* waitFor(page, `[data-structure-panel="${id}"][data-pinned]`);
});

/** Waits two animation frames, so a resize has been observed and drawn. */
const nextFrames = (page: Page) =>
  Effect.promise(() =>
    page.evaluate(
      "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))"
    )
  );

/** Clicks near the view's top-right corner, where nothing is drawn. */
const clickEmptySpace = Effect.fnUntraced(function* (page: Page) {
  const surface = page.locator("[data-map-surface]");

  const box = yield* Effect.promise(() => surface.boundingBox());

  assert.isNotNull(box);

  yield* Effect.promise(() =>
    surface.click({
      position: { x: (box?.width ?? 0) - 12, y: 12 },
    })
  );
});

/** What has keyboard focus, by its data-structure or data-control. */
const focusedOn = (page: Page) =>
  Effect.promise(() =>
    page.evaluate<string | null>(
      "document.activeElement?.getAttribute('data-structure') ?? document.activeElement?.getAttribute('data-control') ?? document.activeElement?.tagName ?? null"
    )
  );

describe("hovering a structure", () => {
  it.live("shows its name and one-liner, and hides when the mouse leaves", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { errors, page } = yield* reviewPage;

        yield* Effect.promise(() => page.locator(structure("page")).hover());
        yield* waitFor(page, '[data-tooltip="page"]');

        const tooltip = yield* textOf(page, "[data-tooltip]");

        assert.include(tooltip, "Map page");
        assert.include(tooltip, "Shows the map and records notes.");

        yield* Effect.promise(() => page.locator("header").hover());
        yield* waitGone(page, "[data-tooltip]");
        assert.deepStrictEqual(errors, []);
      })
    )
  );
});

describe("the tooltip", () => {
  it.live("stays inside the canvas for a structure at its right edge", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* reviewPage;

        yield* goToChapter(page, "c-all");

        const target = page.locator(structure("upstream"));
        const box = yield* Effect.promise(() => target.boundingBox());

        assert.isNotNull(box);

        // Hover the structure's right-hand corner, as far right as it goes.
        yield* Effect.promise(() =>
          target.hover({
            position: {
              x: (box?.width ?? 0) - 6,
              y: (box?.height ?? 0) / 2,
            },
          })
        );
        yield* waitFor(page, '[data-tooltip="upstream"]');

        const [canvas] = yield* boxesOf(page, "[data-map-surface]");
        const [tooltip] = yield* boxesOf(page, "[data-tooltip]");

        assert.isDefined(canvas);
        assert.isDefined(tooltip);

        if (canvas !== undefined && tooltip !== undefined) {
          assert.isAtLeast(tooltip.x, canvas.x);
          assert.isAtLeast(tooltip.y, canvas.y);
          assert.isAtMost(tooltip.x + tooltip.width, canvas.x + canvas.width);
          assert.isAtMost(tooltip.y + tooltip.height, canvas.y + canvas.height);
        }
      })
    )
  );
});

describe("the tooltip on keyboard focus and Escape", () => {
  it.live(
    "opens when Tab reaches a structure, describes it, and Escape closes it without unpinning",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { page } = yield* reviewPage;

          yield* goToChapter(page, "c-all");
          yield* pin(page, "page");

          yield* Effect.promise(() => page.mouse.move(0, 0));
          yield* press(page, "Tab");
          yield* waitFor(page, "[role=tooltip][data-open]");

          const focused = yield* focusedOn(page);
          const said = yield* textOf(page, "[role=tooltip][data-open]");

          const describedBy = yield* Effect.promise(() =>
            page.evaluate<boolean>(
              "document.activeElement?.getAttribute('aria-describedby') === document.querySelector('[role=tooltip][data-open]')?.id"
            )
          );

          assert.isTrue(describedBy);
          assert.include(said, "·");
          assert.notStrictEqual(focused, "page");

          // Escape closes the tooltip first. The pin is the next Escape's.
          yield* press(page, "Escape");
          yield* waitGone(page, "[role=tooltip][data-open]");
          yield* waitFor(page, '[data-structure-panel="page"][data-pinned]');

          yield* press(page, "Escape");
          yield* waitGone(page, '[data-structure-panel="page"][data-pinned]');
        })
      ),
    60_000
  );
});

describe("the tooltip's placement", () => {
  it.live("keeps clear of the other structures where it can", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* widePage;

        yield* goToChapter(page, "c-save");
        yield* Effect.promise(() => page.locator(structure("server")).hover());
        yield* waitFor(page, '[data-tooltip="server"]');

        const [tooltip] = yield* boxesOf(page, "[data-tooltip]");

        const others = yield* boxesOf(
          page,
          '[data-structure]:not([data-structure="server"])'
        );

        assert.isDefined(tooltip);

        // Boxes that touch along an edge, within a pixel, don't count.
        const covers = Arr.filter(
          others,
          (other) =>
            tooltip !== undefined &&
            tooltip.x + 1 < other.x + other.width &&
            other.x + 1 < tooltip.x + tooltip.width &&
            tooltip.y + 1 < other.y + other.height &&
            other.y + 1 < tooltip.y + tooltip.height
        );

        assert.lengthOf(covers, 0);
      })
    )
  );
});

describe("clicking a structure", () => {
  it.live("pins its panel, and the panel says it's pinned", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { errors, page } = yield* reviewPage;

        yield* pin(page, "page");

        const panel = yield* textOf(page, "[data-structure-panel]");

        assert.include(panel, "Pinned");

        const pinnedChipCount = yield* Effect.promise(() =>
          page
            .locator("[data-structure-panel]")
            .getByText(/^P · Pinned\b/u)
            .count()
        );

        // The code chip's letter heads the panel, beside "Pinned".
        assert.strictEqual(pinnedChipCount, 1);
        assert.include(panel, "Map page");
        assert.include(panel, "Live");
        assert.include(panel, "Shows the map and records notes.");
        assert.include(
          panel,
          "Draws the map and saves each note as a proposal."
        );
        assert.include(panel, "The editor app, built into one HTML file.");
        assert.include(panel, "Q-P1");
        assert.include(panel, "Should notes have a length limit?");
        assert.include(panel, "Yes, read-only.");
        assert.include(panel, "mippbipp");
        assert.include(panel, "2026-10-30");

        const pinnedStructures = yield* attributesOf(
          page,
          '[data-selected="true"]',
          "data-structure"
        );

        assert.deepStrictEqual(pinnedStructures, ["page"]);

        // Clicking another structure moves the pin.
        yield* pin(page, "engineer");

        const movedPin = yield* attributesOf(
          page,
          '[data-selected="true"]',
          "data-structure"
        );

        assert.deepStrictEqual(movedPin, ["engineer"]);
        assert.deepStrictEqual(errors, []);
      })
    )
  );

  it.live("then clicking empty space or pressing Escape unpins it", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* reviewPage;

        yield* pin(page, "page");
        yield* clickEmptySpace(page);
        yield* waitGone(page, "[data-structure-panel]");
        yield* waitFor(page, "[data-chapter-story]");

        yield* assertCount(page, '[data-selected="true"]', 0);

        yield* pin(page, "page");
        yield* press(page, "Escape");
        yield* waitGone(page, "[data-structure-panel]");
        yield* waitFor(page, "[data-chapter-story]");

        yield* assertCount(page, '[data-selected="true"]', 0);
      })
    )
  );

  it.live("then panning over empty space keeps it pinned", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* reviewPage;

        yield* pin(page, "page");

        const [canvas] = yield* boxesOf(page, "[data-map-surface]");

        assert.isDefined(canvas);

        const x = (canvas?.x ?? 0) + (canvas?.width ?? 0) - 20;
        const y = (canvas?.y ?? 0) + 80;

        const before = yield* Effect.promise(() =>
          page.locator("[data-viewport]").getAttribute("transform")
        );

        yield* Effect.promise(() => page.mouse.move(x, y));
        yield* Effect.promise(() => page.mouse.down());
        yield* Effect.promise(() =>
          page.mouse.move(x - 120, y + 60, { steps: 6 })
        );
        yield* Effect.promise(() => page.mouse.up());

        yield* Effect.promise(() =>
          page.waitForFunction(
            `document.querySelector("[data-viewport]").getAttribute("transform") !== ${literal(before ?? "")}`
          )
        );

        yield* assertCount(
          page,
          '[data-structure-panel="page"][data-pinned]',
          1
        );

        yield* assertCount(
          page,
          '[data-structure="page"][data-selected="true"]',
          1
        );
      })
    )
  );

  it.live("then the map keeps its size and zoom", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* reviewPage;

        // At this width the hints for a pinned structure would wrap onto a
        // second line if the hint bar let them.
        yield* Effect.promise(() =>
          page.setViewportSize({ height: 640, width: 900 })
        );

        const scale = () =>
          Effect.promise(() =>
            page.evaluate<number>(
              'Number(document.querySelector("svg[data-scale]").dataset.scale)'
            )
          );

        yield* click(page, '[aria-label="Zoom in"]');

        const zoomed = yield* scale();
        const [before] = yield* boxesOf(page, "svg[data-scale]");

        yield* pin(page, "page");
        yield* nextFrames(page);

        const [after] = yield* boxesOf(page, "svg[data-scale]");

        assert.deepStrictEqual(after, before);
        const scaleAfterPin = yield* scale();
        assert.strictEqual(scaleAfterPin, zoomed);
      })
    )
  );

  it.live("then clicking a packet shows the packet until it's closed", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* reviewPage;

        yield* goToChapter(page, "c-save");
        yield* pin(page, "server");
        yield* click(page, '[data-playback-controls] [data-control="pause"]');
        yield* waitFor(page, '[data-packets][data-playing="false"]');
        yield* click(page, "[data-packet]");
        yield* waitFor(page, "[data-packet-panel]");

        // The pin stays while the packet shows.
        yield* assertCount(
          page,
          '[data-structure="server"][data-selected="true"]',
          1
        );

        yield* click(page, '[data-packet-panel] [data-control="close"]');
        yield* waitFor(page, '[data-structure-panel="server"][data-pinned]');

        // Clicking a structure while a packet shows switches to the structure.
        yield* click(page, "[data-packet]");
        yield* waitFor(page, "[data-packet-panel]");
        yield* pin(page, "page");
      })
    )
  );
});

describe("the inside view", () => {
  const expectInside = Effect.fnUntraced(function* (page: Page) {
    yield* waitFor(page, '[data-inside-view="page"]');

    const steps = yield* attributesOf(
      page,
      "[data-inside-view] [data-step]",
      "data-step"
    );

    const breadcrumb = yield* textOf(page, "[data-breadcrumb]");

    assert.lengthOf(steps, 2);
    assert.include(breadcrumb, "Map page");

    const chapterRailVisible = yield* Effect.promise(() =>
      page.locator("[data-chapter-rail]").isVisible()
    );

    assert.isFalse(chapterRailVisible);

    const panel = yield* textOf(page, "[data-inside-panel]");

    assert.include(panel, "Pin");
    assert.include(panel, "The engineer pins a note to a structure.");
    assert.include(panel, "Save");
  });

  const expectOutWithPin = Effect.fnUntraced(function* (
    page: Page,
    chapter: string
  ) {
    yield* waitGone(page, "[data-inside-view]");
    yield* waitFor(page, `[data-walkthrough][data-chapter="${chapter}"]`);
    yield* waitFor(page, '[data-structure="page"][data-selected="true"]');
    yield* waitFor(page, '[data-structure-panel="page"][data-pinned]');
    yield* Effect.promise(() =>
      page.locator("[data-chapter-rail]").waitFor({ state: "visible" })
    );
  });

  it.live("moves focus to Come out going inside, and back coming out", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* reviewPage;

        yield* Effect.promise(() => page.locator(structure("page")).focus());
        yield* press(page, "Enter");
        yield* waitFor(page, '[data-structure-panel="page"][data-pinned]');
        yield* press(page, "ArrowRight");
        yield* waitFor(page, '[data-inside-view="page"]');
        const focusedInside = yield* focusedOn(page);
        assert.strictEqual(focusedInside, "come-out");

        yield* press(page, "ArrowLeft");
        yield* waitGone(page, "[data-inside-view]");
        const focusedAfterComeOut = yield* focusedOn(page);
        assert.strictEqual(focusedAfterComeOut, "page");

        // The button way round lands in the same places.
        yield* click(page, '[data-control="go-inside"]');
        yield* waitFor(page, '[data-inside-view="page"]');
        const focusedInsideByButton = yield* focusedOn(page);
        assert.strictEqual(focusedInsideByButton, "come-out");
        yield* press(page, "Enter");
        yield* waitGone(page, "[data-inside-view]");
        const focusedAfterComeOutByButton = yield* focusedOn(page);
        assert.strictEqual(focusedAfterComeOutByButton, "page");
      })
    )
  );

  it.live("keeps the map's zoom after coming out", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* reviewPage;

        const scale = () =>
          Effect.promise(() =>
            page.evaluate<number>(
              'Number(document.querySelector("svg[data-scale]").dataset.scale)'
            )
          );

        const fitted = yield* scale();

        yield* click(page, '[aria-label="Zoom in"]');
        yield* click(page, '[aria-label="Zoom in"]');

        const zoomed = yield* scale();

        assert.isAbove(zoomed, fitted * 1.2);

        yield* pin(page, "page");
        yield* click(page, '[data-control="go-inside"]');
        yield* waitFor(page, '[data-inside-view="page"]');
        yield* click(page, '[data-breadcrumb] [data-control="come-out"]');
        yield* waitGone(page, "[data-inside-view]");

        const scaleAfterComeOut = yield* scale();
        assert.closeTo(scaleAfterComeOut, zoomed, 1e-6);
      })
    )
  );

  it.live(
    "opens from the Go inside button, a double-click or →, and Come out or ← returns",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { errors, page } = yield* reviewPage;

          yield* goToChapter(page, "c-save");
          yield* pin(page, "page");
          yield* click(page, '[data-control="go-inside"]');
          yield* expectInside(page);
          yield* click(page, '[data-breadcrumb] [data-control="come-out"]');
          yield* expectOutWithPin(page, "c-save");

          yield* Effect.promise(() =>
            page.locator(structure("page")).dblclick()
          );
          yield* expectInside(page);
          yield* press(page, "ArrowLeft");
          yield* expectOutWithPin(page, "c-save");

          yield* press(page, "ArrowRight");
          yield* expectInside(page);
          yield* press(page, "ArrowLeft");
          yield* expectOutWithPin(page, "c-save");
          assert.deepStrictEqual(errors, []);
        })
      )
  );

  it.live("plays a packet along the steps, still under reduced motion", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* reviewPage;

        yield* Effect.promise(() =>
          page.emulateMedia({ reducedMotion: "reduce" })
        );
        yield* Effect.promise(() => page.reload());
        yield* pin(page, "page");
        yield* click(page, '[data-control="go-inside"]');
        yield* waitFor(page, "[data-inside-view] [data-inside-packet]");
        yield* waitFor(
          page,
          '[data-inside-view] [data-inside-packet][data-playing="false"]'
        );
      })
    )
  );

  it.live("isn't offered for a structure with no steps", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* reviewPage;

        yield* pin(page, "engineer");
        yield* assertCount(page, '[data-control="go-inside"]', 0);

        // → stays on the structure rather than moving on a chapter.
        yield* press(page, "ArrowRight");
        yield* waitFor(page, '[data-walkthrough][data-chapter="c-page"]');
        yield* assertCount(page, "[data-inside-view]", 0);
      })
    )
  );
});

describe("the Open questions tab", () => {
  it.live("lists revealed questions by ID, open first, by structure", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* reviewPage;

        yield* click(page, '[role="tab"][data-tab="questions"]');

        const questionIds = yield* attributesOf(
          page,
          "[data-question]",
          "data-question"
        );

        // Chapter 1 reveals only the page's questions.
        assert.deepStrictEqual(questionIds, ["Q-P1", "Q-P2"]);

        yield* goToChapter(page, "c-save");
        yield* click(page, '[role="tab"][data-tab="questions"]');

        const open = yield* attributesOf(
          page,
          '[data-question-list="open"] [data-question]',
          "data-question"
        );

        const openGroups = yield* attributesOf(
          page,
          '[data-question-list="open"] [data-question-group]',
          "data-question-group"
        );

        const resolved = yield* textOf(
          page,
          '[data-question-list="resolved"] [data-question="Q-P2"]'
        );

        const serverGroup = yield* textOf(
          page,
          '[data-question-list="open"] [data-question-group="server"]'
        );

        assert.deepStrictEqual(open, ["Q-P1", "Q-S1"]);
        assert.deepStrictEqual(openGroups, ["page", "server"]);
        assert.include(serverGroup, "Save server");
        assert.include(serverGroup, "Q-S1");
        assert.include(serverGroup, "Which port does it try first?");
        assert.include(resolved, "Does the page work without the server?");
        assert.include(resolved, "Yes, read-only.");
        assert.include(resolved, "mippbipp");
        assert.include(resolved, "2026-10-30");
      })
    )
  );

  it.live("selects a question's structure when it's clicked", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* reviewPage;

        yield* goToChapter(page, "c-save");
        yield* click(page, '[role="tab"][data-tab="questions"]');
        yield* click(page, '[data-question="Q-S1"] button');
        yield* waitFor(page, '[data-structure-panel="server"][data-pinned]');
        yield* waitFor(page, '[data-structure="server"][data-selected="true"]');
      })
    )
  );
});

describe("the side index", () => {
  it.live("lists the structures by group and dims unrevealed ones", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* widePage;

        const groups = yield* attributesOf(
          page,
          "[data-side-index] [data-index-group]",
          "data-index-group"
        );

        const items = yield* attributesOf(
          page,
          "[data-side-index] [data-index-structure]",
          "data-index-structure"
        );

        const later = yield* attributesOf(
          page,
          "[data-side-index] [data-revealed-in]",
          "data-revealed-in"
        );

        assert.deepStrictEqual(groups, ["people", "loop", "outside"]);
        assert.deepStrictEqual(items, [
          "engineer",
          "page",
          "server",
          "proposals",
          "pull-request",
          "upstream",
        ]);
        assert.deepStrictEqual(later, ["2", "2", "3", "3"]);
        yield* assertTextIncludes(page, indexItem("page"), "P");
        yield* assertTextIncludes(page, indexItem("page"), "Map page");

        // "ch 2" jumps to the chapter that reveals the structure.
        yield* click(page, '[data-side-index] [data-revealed-in="2"] >> nth=0');
        yield* waitFor(page, '[data-walkthrough][data-chapter="c-save"]');
      })
    )
  );

  it.live("selects on click and Enter; ↑ and ↓ only move focus", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* widePage;

        const focusedIndexItem = () =>
          Effect.promise(() =>
            page.evaluate<string | null>(
              "document.activeElement?.getAttribute('data-index-structure') ?? null"
            )
          );

        const tabStops = () =>
          Effect.promise(() =>
            page.evaluate<Array<string>>(
              "[...document.querySelectorAll('[data-side-index] [data-index-structure][tabindex=\"0\"]')].map((el) => el.getAttribute('data-index-structure'))"
            )
          );

        const pinnedPanels = () =>
          attributesOf(
            page,
            "[data-structure-panel][data-pinned]",
            "data-structure-panel"
          );

        const currentItems = () =>
          attributesOf(
            page,
            '[data-side-index] [aria-current="true"]',
            "data-index-structure"
          );

        const initialStops = yield* tabStops();
        // Before any selection one item holds the Tab stop.
        assert.lengthOf(initialStops, 1);

        yield* click(page, indexItem("engineer"));
        yield* waitFor(page, '[data-structure-panel="engineer"][data-pinned]');
        yield* waitFor(page, `${indexItem("engineer")}[aria-current="true"]`);
        yield* waitFor(page, `${indexItem("engineer")}[tabindex="0"]`);
        const stopsAfterClick = yield* tabStops();
        assert.deepStrictEqual(stopsAfterClick, ["engineer"]);
        const focusAfterClick = yield* focusedIndexItem();
        assert.strictEqual(focusAfterClick, "engineer");

        // ↓ moves focus to the next revealed item, not the selection.
        yield* press(page, "ArrowDown");
        yield* waitFor(page, `${indexItem("page")}:focus`);
        const pinnedAfterDown = yield* pinnedPanels();
        assert.deepStrictEqual(pinnedAfterDown, ["engineer"]);
        const currentAfterDown = yield* currentItems();
        assert.deepStrictEqual(currentAfterDown, ["engineer"]);
        const stopsAfterDown = yield* tabStops();
        assert.deepStrictEqual(stopsAfterDown, ["engineer"]);

        // Later structures are reachable, and focusing one doesn't jump
        // chapters.
        yield* press(page, "ArrowDown");
        yield* waitFor(page, `${indexItem("server")}:focus`);
        const chapterAfterLater = yield* attributesOf(
          page,
          "[data-walkthrough]",
          "data-chapter"
        );
        assert.deepStrictEqual(chapterAfterLater, ["c-page"]);
        const pinnedAfterLater = yield* pinnedPanels();
        assert.deepStrictEqual(pinnedAfterLater, ["engineer"]);

        yield* press(page, "ArrowUp");
        yield* press(page, "ArrowUp");
        yield* waitFor(page, `${indexItem("engineer")}:focus`);
        const focusAfterUp = yield* focusedIndexItem();
        assert.strictEqual(focusAfterUp, "engineer");

        // Enter on the focused item selects it, and the stop follows.
        yield* press(page, "ArrowDown");
        yield* waitFor(page, `${indexItem("page")}:focus`);
        yield* press(page, "Enter");
        yield* waitFor(page, '[data-structure-panel="page"][data-pinned]');
        yield* waitFor(page, `${indexItem("page")}[aria-current="true"]`);
        yield* waitFor(page, `${indexItem("page")}[tabindex="0"]`);
        const stopsAfterEnter = yield* tabStops();
        assert.deepStrictEqual(stopsAfterEnter, ["page"]);
        const currentAfterEnter = yield* currentItems();
        assert.deepStrictEqual(currentAfterEnter, ["page"]);
      })
    )
  );
});
