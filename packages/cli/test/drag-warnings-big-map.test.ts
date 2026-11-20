import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Clock, Effect, Order } from "effect";
import type { Page } from "playwright";

import { goToChapterPaused, inPage, openUrl, waitFor } from "./browser.ts";
import { pipelineMap } from "./fixtures.ts";
import { makeHome, startServe, mapIn } from "./harness.ts";

// The drag warnings on a map big enough that checking every chapter takes
// seconds: the flake pipeline, with 15 structures, 29 hops and 8 chapters.
// The check runs in a worker, the chapter on screen first, so the page keeps
// up with the pointer while the rest come in.

const served = Effect.gen(function* () {
  const pipelineMapFiles = yield* pipelineMap;
  const root = yield* makeHome(pipelineMapFiles);
  const { home } = mapIn(root, "flake-pipeline");
  const serve = yield* startServe(home, ["--port", "0"]);
  const { errors, page } = yield* openUrl(serve.url);

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

/** Each drag warning's message, sorted. */
const shownWarnings = (page: Page) =>
  inPage<ReadonlyArray<string>>(
    page,
    `[...document.querySelectorAll("[data-drag-warning] [data-warning-message]")].map((item) => item.textContent)`
  ).pipe(Effect.map((shown) => Arr.sort(shown, Order.String)));

describe("the drag warnings on a big map", () => {
  it.live(
    "check the chapter on screen first, keep the drag smooth, and end with every chapter",
    () =>
      Effect.gen(function* () {
        const { errors, page } = yield* served;

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

        // On the main thread, checking every chapter held each move for
        // seconds. With the check in a worker, no move waits on it.
        const slowest = yield* slowestMove(page, { from, moves: 16 });

        assert.isBelow(slowest, 1000, `a move took ${slowest} ms to paint`);

        // Some chapters come in while the rest are still checked.
        yield* waitFor(page, "[data-drag-warnings-heading][data-checking]");

        const early = yield* shownWarnings(page);

        // Then every chapter, and the heading stops saying it's checking.
        yield* Effect.promise(() =>
          page
            .locator("[data-drag-warnings-heading]:not([data-checking])")
            .first()
            .waitFor({ timeout: 90_000 })
        );

        const all = yield* shownWarnings(page);

        assert.isAtLeast(all.length, early.length);
        assert.isTrue(
          Arr.some(all, (message) =>
            /in chapter "(?!c-monday")/u.test(message)
          ),
          "the other chapters' warnings are in"
        );

        yield* Effect.promise(() => page.mouse.up());
        assert.deepStrictEqual(errors, []);
      }).pipe(Effect.provide(NodeServices.layer)),
    180_000
  );
});
