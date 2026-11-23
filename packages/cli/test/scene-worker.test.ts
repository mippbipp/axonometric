import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect, FileSystem, String as Str } from "effect";
import type { Page } from "playwright";

import {
  centreOf,
  choose,
  click,
  goToChapterPaused,
  inPage,
  openUrl,
  unitOnScreen,
  waitFor,
  waitForAddForm,
  waitTimeout,
} from "./browser.ts";
import { homeAt, serveReviewMap, waitForRevision } from "./harness.ts";

interface Point {
  readonly x: number;
  readonly y: number;
}

/** Presses at `from`, moves by `by` in small steps, and releases. */
const dragBy = Effect.fnUntraced(function* (
  page: Page,
  from: Point,
  by: Point
) {
  yield* Effect.promise(() => page.mouse.move(from.x, from.y));
  yield* Effect.promise(() => page.mouse.down());
  yield* Effect.promise(() =>
    page.mouse.move(from.x + by.x, from.y + by.y, { steps: 12 })
  );
  yield* Effect.promise(() => page.mouse.up());
});

// The page draws a map with new data, such as one with a proposed structure,
// in a worker. These tests cover what happens when that worker can't help.

/**
 * Runs before the page's own scripts. A worker named "scene drawing" fails
 * to start, as when the browser refuses an inline worker; the page's other
 * workers start as usual.
 */
const refuseSceneWorker = `
const PageWorker = globalThis.Worker;
globalThis.Worker = class extends PageWorker {
  constructor(url, options) {
    if (options?.name === "scene drawing") {
      throw new DOMException("refused", "SecurityError");
    }
    super(url, options);
  }
};
`;

/** The review map, served and open at 1280 × 800 with `initScript` run first. */
const openWith = Effect.fnUntraced(function* (initScript: string) {
  const served = yield* serveReviewMap({}, []);
  const opened = yield* openUrl(served.url, { initScript });

  yield* Effect.promise(() =>
    opened.page.setViewportSize({ height: 800, width: 1280 })
  );

  return { ...served, ...opened };
});

describe("drawing a map with new data", () => {
  it.live(
    "draws on the page when the scene worker won't start",
    () =>
      Effect.gen(function* () {
        const { errors, page } = yield* openWith(refuseSceneWorker);

        yield* goToChapterPaused(page, "c-all");
        yield* click(page, '[data-control="add-structure"]');
        yield* waitFor(page, "[data-add-structure]");
        yield* Effect.promise(() =>
          page.locator('[data-add="name"]').fill("Build cache")
        );
        yield* choose(page, '[data-add="status"]', "planned");
        yield* Effect.promise(() => page.locator('[data-add="x"]').fill("12"));
        yield* Effect.promise(() => page.locator('[data-add="y"]').fill("12"));
        yield* waitForAddForm(page);
        yield* click(page, '[data-add="submit"]');
        yield* waitFor(
          page,
          '[data-map-layer] [data-structure^="build-cache-"][data-pending="true"]'
        );

        assert.deepStrictEqual(errors, []);
      }),
    60_000
  );
});

/**
 * Runs before the page's own scripts. While `globalThis.holdScenes` is true,
 * the scene worker's answers wait in `globalThis.heldScenes`, so a test acts
 * on the page before the worker has drawn the map.
 */
const holdScenes = `
globalThis.holdScenes = true;
globalThis.heldScenes = [];
const SceneWorker = globalThis.Worker;
globalThis.Worker = class extends SceneWorker {
  constructor(url, options) {
    super(url, options);
    if (options?.name === "scene drawing") {
      this.addEventListener("message", (event) => {
        if (globalThis.holdScenes) {
          event.stopImmediatePropagation();
          globalThis.heldScenes.push({ data: event.data, worker: this });
        }
      });
    }
  }
};
globalThis.releaseScenes = () => {
  globalThis.holdScenes = false;
  for (const { data, worker } of globalThis.heldScenes.splice(0)) {
    worker.dispatchEvent(new MessageEvent("message", { data }));
  }
};
`;

/** Rewrites a file in the map's folder with `edit` applied to its text. */
const editFile = Effect.fnUntraced(function* (
  file: string,
  edit: (text: string) => string
) {
  const fs = yield* FileSystem.FileSystem;
  const text = yield* fs.readFileString(file);

  yield* fs.writeFileString(file, edit(text));
}, Effect.provide(NodeServices.layer));

describe("editing while the scene worker draws", () => {
  it.live(
    "keeps a structure's new size when it is dragged before the new map is drawn",
    () =>
      Effect.gen(function* () {
        const { errors, home, page } = yield* openWith(holdScenes);
        const files = homeAt(home);

        yield* goToChapterPaused(page, "c-all");
        // One update that renames a structure, so its data is new, and
        // widens another, so its footprint is new.
        yield* editFile(
          files.dataFile,
          Str.replace('name: "Engineer"', 'name: "The engineer"')
        );
        yield* editFile(
          files.layoutFile,
          Str.replace(
            '"page": { "x": 4, "y": 0, "w": 2, "d": 2 }',
            '"page": { "x": 4, "y": 0, "w": 3, "d": 2 }'
          )
        );
        yield* Effect.promise(() =>
          page.waitForFunction(
            "globalThis.heldScenes.length > 0",
            undefined,
            waitTimeout
          )
        );

        const unit = yield* unitOnScreen(page, "iso");
        const from = yield* centreOf(page, '[data-structure="page"]');

        yield* dragBy(page, from, { x: 0, y: unit * 2.2 });

        const saved = yield* waitForRevision(home, 1);

        assert.deepStrictEqual(
          Arr.map(saved.layout, ({ kind }) => kind),
          ["move"],
          "the drag saved a move and no resize"
        );
        yield* inPage(page, "globalThis.releaseScenes()");
        assert.deepStrictEqual(errors, []);
      }),
    60_000
  );
});
