import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

import {
  choose,
  click,
  goToChapterPaused,
  openUrl,
  waitFor,
  waitForAddForm,
} from "./browser.ts";
import { serveReviewMap } from "./harness.ts";

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
