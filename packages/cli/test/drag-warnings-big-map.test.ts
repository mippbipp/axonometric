import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Clock, Effect } from "effect";
import type { Page } from "playwright";

import { goToChapterPaused, inPage, openUrl } from "./browser.ts";
import { pipelineMap } from "./fixtures.ts";
import { makeHome, startServe, mapIn } from "./harness.ts";

// A drag on a map big enough that checking every chapter takes seconds: the
// flake pipeline, with 15 structures, 29 hops and 8 chapters. The check runs
// in a worker, so the page keeps up with the pointer. The order and the
// answers of the check are tested in contracts, on the same map.
//
// A slow runner slows every move, so the test doesn't hold a move to a fixed
// time. It drags twice in the same run, once with the drag check turned off,
// and holds the real drag's slowest move to a factor of the other's.

/** The real drag's slowest move may be this many times the baseline's. */
const factor = 5;

/** Added to the allowance, so a baseline of a few milliseconds isn't a limit of tens. */
const floorMillis = 300;

/**
 * Runs before the page's own scripts. With it set the page starts no drag
 * check, and a drag paints as it would if the check were free. Only a test
 * sets it: nothing on the page does.
 */
const checkOff = "globalThis.axonometricDragCheckOff = true;";

const served = (options?: { readonly initScript?: string }) =>
  Effect.gen(function* () {
    const pipelineMapFiles = yield* pipelineMap;
    const root = yield* makeHome(pipelineMapFiles);
    const { home } = mapIn(root, "flake-pipeline");
    const serve = yield* startServe(home, ["--port", "0"]);
    const { errors, page } = yield* openUrl(serve.url, options);

    yield* Effect.promise(() =>
      page.setViewportSize({ height: 900, width: 1600 })
    );

    return { errors, page };
  }).pipe(Effect.provide(NodeServices.layer));

/**
 * The longest the page took to paint after a pointer move, in milliseconds,
 * over `moves` moves of 3 px to the right from `from`, still pressed.
 */
const slowestMove = Effect.fnUntraced(function* (
  page: Page,
  {
    from,
    moves,
  }: { readonly from: { x: number; y: number }; readonly moves: number }
) {
  const times: Array<number> = [];

  for (const index of Arr.range(1, moves)) {
    const began = yield* Clock.currentTimeMillis;

    yield* Effect.promise(() => page.mouse.move(from.x + index * 3, from.y));
    yield* inPage(
      page,
      "new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))"
    );
    times.push((yield* Clock.currentTimeMillis) - began);
  }

  return Arr.reduce(times, 0, Math.max);
});

/** Drags `updater` in the last chapter on a fresh serve, and gives its slowest move. */
const draggedOnce = Effect.fnUntraced(function* (options?: {
  readonly initScript?: string;
}) {
  const { errors, page } = yield* served(options);

  yield* goToChapterPaused(page, "c-monday");

  const box = yield* Effect.promise(() =>
    page.locator('[data-structure="updater"]').first().boundingBox()
  );

  assert.isNotNull(box);

  const from = {
    x: (box?.x ?? 0) + (box?.width ?? 0) / 2,
    y: (box?.y ?? 0) + (box?.height ?? 0) / 2,
  };

  yield* Effect.promise(() => page.mouse.move(from.x, from.y));
  yield* Effect.promise(() => page.mouse.down());

  const slowest = yield* slowestMove(page, { from, moves: 16 });

  yield* Effect.promise(() => page.mouse.up());
  assert.deepStrictEqual(errors, []);

  return slowest;
});

describe("the drag warnings on a big map", () => {
  it.live(
    "keeps painting every move of a drag",
    () =>
      Effect.gen(function* () {
        // On the main thread, checking every chapter held each move for
        // seconds. With the check in a worker, no move waits on it.
        const baseline = yield* draggedOnce({ initScript: checkOff });
        const slowest = yield* draggedOnce();
        const allowed = baseline * factor + floorMillis;

        assert.isAtMost(
          slowest,
          allowed,
          `a move took ${slowest} ms to paint, where ${baseline} ms was the slowest with no check`
        );
      }).pipe(Effect.provide(NodeServices.layer)),
    180_000
  );
});
