import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect } from "effect";
import type { Page } from "playwright";

import {
  click,
  goToChapterPaused,
  inPage,
  openUrl,
  waitFor,
} from "./browser.ts";
import { pipelineMap } from "./fixtures.ts";
import { makeHome, mapIn, startServe } from "./harness.ts";

// The add form on a map big enough that finding a spot for a new structure
// takes seconds: the flake pipeline, with 15 structures, 29 hops and 8
// chapters. Every change to the name moves the spot, because the name sets
// the width of the name tag, so the search runs again for each keystroke.
//
// A slow runner slows every keystroke, so the test doesn't hold one to a
// fixed time. It types the same keys into the Flows tab's name field, which
// checks nothing as it changes, and holds the add form's slowest keystroke to
// a factor of that one's.

/** The add form's slowest keystroke may be this many times the baseline's. */
const factor = 5;

/**
 * Added to the allowance, so a baseline of a few milliseconds isn't a limit
 * of tens. Drawing one chapter of this map takes about 550 ms here, so a
 * keystroke that waits on even one chapter's drawing goes over.
 */
const floorMillis = 250;

/** What the test types into each field. */
const keys = "cache";

/**
 * Runs before the page's own scripts. For each key pressed it records how
 * long the page took from the keydown to its next frame, which is how long
 * the keystroke held the page.
 */
const timeKeys = `
globalThis.keyFrames = [];
addEventListener("keydown", () => {
  const at = performance.now();
  globalThis.keyFrames.push(
    new Promise((done) => requestAnimationFrame(() => done(performance.now() - at)))
  );
}, { capture: true });
`;

const served = Effect.gen(function* () {
  const pipelineMapFiles = yield* pipelineMap;
  const root = yield* makeHome(pipelineMapFiles);
  const { home } = mapIn(root, "flake-pipeline");
  const serve = yield* startServe(home, ["--port", "0"]);
  const { errors, page } = yield* openUrl(serve.url, { initScript: timeKeys });

  yield* Effect.promise(() =>
    page.setViewportSize({ height: 900, width: 1600 })
  );

  return { errors, page };
}).pipe(Effect.provide(NodeServices.layer));

/**
 * Types `keys` into the field `selector`, as a person types, and gives the
 * longest any keystroke held the page, in milliseconds.
 */
const slowestKey = Effect.fnUntraced(function* (page: Page, selector: string) {
  const field = page.locator(selector);

  yield* Effect.promise(() => field.click());
  yield* inPage(page, "globalThis.keyFrames.splice(0).length");
  yield* Effect.promise(() => page.keyboard.type(keys, { delay: 80 }));

  const times = yield* inPage<ReadonlyArray<number>>(
    page,
    "Promise.all(globalThis.keyFrames.splice(0))"
  );

  const typed = yield* Effect.promise(() => field.inputValue());

  assert.strictEqual(typed, keys, selector);
  assert.lengthOf(times, keys.length, selector);

  return Arr.reduce(times, 0, Math.max);
});

describe("the add form on a big map", () => {
  it.live(
    "keeps painting every keystroke of a new structure's name",
    () =>
      Effect.gen(function* () {
        const { errors, page } = yield* served;

        yield* goToChapterPaused(page, "c-all");
        yield* click(page, '[data-tab="flows"]');
        yield* waitFor(page, "[data-flows-tab]");

        const baseline = yield* slowestKey(page, "[data-new-flow-name]");

        yield* click(page, '[data-control="add-structure"]');
        yield* waitFor(page, "[data-add-structure]");
        yield* Effect.promise(() =>
          page.waitForFunction(
            `document.querySelector('[data-add="x"]')?.value !== ""`,
            undefined,
            { timeout: 120_000 }
          )
        );

        const slowest = yield* slowestKey(page, '[data-add="name"]');
        const allowed = baseline * factor + floorMillis;

        assert.isAtMost(
          slowest,
          allowed,
          `a keystroke held the page for ${Math.round(slowest)} ms, where the Flows tab's name field took ${Math.round(baseline)} ms`
        );
        assert.deepStrictEqual(errors, []);
      }).pipe(Effect.provide(NodeServices.layer)),
    240_000
  );
});
