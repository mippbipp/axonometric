import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import type { Page } from "playwright";

import { attributesOf } from "./browser.ts";
import { fullMap } from "./fixtures.ts";
import { buildAndOpen } from "./harness.ts";

// These tests click structures with real mouse clicks, not dispatched
// events: Playwright checks that the structure is what's under the pointer,
// so a redraw that stops clicks from landing fails them. Packets keep playing
// while they click, which redraws the view every frame.

const reviewPage = Effect.gen(function* () {
  return yield* buildAndOpen(yield* fullMap, "review");
});

const structure = (id: string) => `[data-structure="${id}"]`;

const indexItem = (id: string) =>
  `[data-side-index] button[data-index-structure="${id}"]`;

const waitFor = (page: Page, selector: string) =>
  Effect.promise(() => page.locator(selector).first().waitFor());

const waitGone = (page: Page, selector: string) =>
  Effect.promise(() =>
    page.locator(selector).first().waitFor({ state: "detached" })
  );

const click = (page: Page, selector: string) =>
  Effect.promise(() => page.locator(selector).click());

const press = (page: Page, key: string) =>
  Effect.promise(() => page.keyboard.press(key));

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

const goToChapter = Effect.fnUntraced(function* (page: Page, id: string) {
  yield* click(page, `[data-chapter-rail] button[data-chapter="${id}"]`);
  yield* waitFor(page, `[data-walkthrough][data-chapter="${id}"]`);
});

/** Clicks a structure and waits for its panel to say it's pinned. */
const pin = Effect.fnUntraced(function* (page: Page, id: string) {
  yield* click(page, structure(id));
  yield* waitFor(page, `[data-structure-panel="${id}"][data-pinned]`);
});

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

describe("hovering a structure", () => {
  it.live("shows its name and one-liner, and hides when the mouse leaves", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page, errors } = yield* reviewPage;

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

describe("clicking a structure", () => {
  it.live("pins its panel, and the panel says it's pinned", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page, errors } = yield* reviewPage;

        yield* pin(page, "page");

        const panel = yield* textOf(page, "[data-structure-panel]");

        assert.include(panel, "Pinned");
        assert.include(panel, "P");
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

        assert.deepStrictEqual(
          yield* attributesOf(page, '[data-selected="true"]', "data-structure"),
          ["page"]
        );

        // Clicking another structure moves the pin.
        yield* pin(page, "engineer");
        assert.deepStrictEqual(
          yield* attributesOf(page, '[data-selected="true"]', "data-structure"),
          ["engineer"]
        );
        assert.deepStrictEqual(errors, []);
      })
    )
  );

  it.live("then clicking empty space unpins it", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* reviewPage;

        yield* pin(page, "page");
        yield* clickEmptySpace(page);
        yield* waitGone(page, "[data-structure-panel]");
        yield* waitFor(page, "[data-chapter-story]");

        assert.strictEqual(yield* count(page, '[data-selected="true"]'), 0);
      })
    )
  );

  it.live("then Escape unpins it", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* reviewPage;

        yield* pin(page, "page");
        yield* press(page, "Escape");
        yield* waitFor(page, "[data-chapter-story]");
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
        assert.strictEqual(
          yield* count(page, '[data-structure="server"][data-selected="true"]'),
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
    assert.strictEqual(yield* count(page, "[data-chapter-rail]"), 0);

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
    yield* waitFor(page, "[data-chapter-rail]");
  });

  it.live("opens from the Go inside button, and Come out returns", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page, errors } = yield* reviewPage;

        yield* goToChapter(page, "c-save");
        yield* pin(page, "page");
        yield* click(page, '[data-control="go-inside"]');
        yield* expectInside(page);

        yield* click(page, '[data-breadcrumb] [data-control="come-out"]');
        yield* expectOutWithPin(page, "c-save");
        assert.deepStrictEqual(errors, []);
      })
    )
  );

  it.live("opens on a double-click", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* reviewPage;

        yield* Effect.promise(() => page.locator(structure("page")).dblclick());
        yield* expectInside(page);
      })
    )
  );

  it.live("opens with → while a structure is selected, and ← comes out", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* reviewPage;

        yield* goToChapter(page, "c-save");
        yield* pin(page, "page");
        yield* press(page, "ArrowRight");
        yield* expectInside(page);

        yield* press(page, "ArrowLeft");
        yield* expectOutWithPin(page, "c-save");
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
        assert.strictEqual(yield* count(page, '[data-control="go-inside"]'), 0);

        // → stays on the structure rather than moving on a chapter.
        yield* press(page, "ArrowRight");
        yield* waitFor(page, '[data-walkthrough][data-chapter="c-page"]');
        assert.strictEqual(yield* count(page, "[data-inside-view]"), 0);
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

        // Chapter 1 reveals only the page's questions.
        assert.deepStrictEqual(
          yield* attributesOf(page, "[data-question]", "data-question"),
          ["Q-P1", "Q-P2"]
        );

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
        yield* click(page, '[data-question="Q-S1"]');
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
        const { page } = yield* reviewPage;

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
        assert.include(yield* textOf(page, indexItem("page")), "P");
        assert.include(yield* textOf(page, indexItem("page")), "Map page");

        // "ch 2" jumps to the chapter that reveals the structure.
        yield* click(page, '[data-side-index] [data-revealed-in="2"] >> nth=0');
        yield* waitFor(page, '[data-walkthrough][data-chapter="c-save"]');
      })
    )
  );

  it.live("selects a structure on click and moves with ↑ and ↓", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* reviewPage;

        yield* click(page, indexItem("engineer"));
        yield* waitFor(page, '[data-structure-panel="engineer"][data-pinned]');
        yield* waitFor(page, `${indexItem("engineer")}[aria-current="true"]`);

        yield* press(page, "ArrowDown");
        yield* waitFor(page, '[data-structure-panel="page"][data-pinned]');
        yield* waitFor(page, '[data-structure="page"][data-selected="true"]');

        // Unrevealed structures are skipped.
        yield* press(page, "ArrowDown");
        yield* waitFor(page, '[data-structure-panel="page"][data-pinned]');

        yield* press(page, "ArrowUp");
        yield* waitFor(page, '[data-structure-panel="engineer"][data-pinned]');

        const focused = yield* Effect.promise(() =>
          page.evaluate(
            "document.activeElement?.getAttribute('data-index-structure')"
          )
        );

        assert.strictEqual(focused, "engineer");
      })
    )
  );
});
