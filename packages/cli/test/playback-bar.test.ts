import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect } from "effect";
import type { Page } from "playwright";

import { boxesOf } from "./browser.ts";
import { fullMap } from "./fixtures.ts";
import { buildAndOpen } from "./harness.ts";

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const reviewPage = Effect.gen(function* () {
  return yield* buildAndOpen(yield* fullMap, "review");
});

const goToLastChapter = Effect.fnUntraced(function* (page: Page) {
  yield* Effect.promise(() =>
    page.locator('[data-chapter-rail] button[data-chapter="c-all"]').click()
  );
  yield* Effect.promise(() =>
    page.locator('[data-walkthrough][data-chapter="c-all"]').waitFor()
  );
});

/** The smallest box around every box in `boxes`. */
const unionOf = (boxes: readonly Box[]) => {
  const left = Math.min(...Arr.map(boxes, (box) => box.x));
  const top = Math.min(...Arr.map(boxes, (box) => box.y));
  const right = Math.max(...Arr.map(boxes, (box) => box.x + box.width));
  const bottom = Math.max(...Arr.map(boxes, (box) => box.y + box.height));

  return { x: left, y: top, width: right - left, height: bottom - top };
};

const intersects = (a: Box, b: Box) =>
  a.x < b.x + b.width &&
  b.x < a.x + a.width &&
  a.y < b.y + b.height &&
  b.y < a.y + a.height;

const zoomControlsBox = Effect.fnUntraced(function* (page: Page) {
  const buttons = yield* Effect.forEach(
    ["Zoom in", "Zoom out", "Zoom to fit"],
    (name) =>
      Effect.promise(() =>
        page.getByRole("button", { name, exact: true }).boundingBox()
      )
  );

  const boxes = Arr.filter(buttons, (box) => box !== null);

  assert.lengthOf(boxes, 3);

  return unionOf(boxes);
});

describe("the playback bar", () => {
  it.live("holds Play, Step and the flow choices in one container", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page, errors } = yield* reviewPage;

        yield* goToLastChapter(page);

        const inBar = (selector: string) =>
          Effect.promise(() =>
            page.locator(`[data-playback-bar] ${selector}`).count()
          );

        // The last chapter starts playing, so Pause stands in for Play.
        assert.strictEqual(
          yield* inBar('[data-control="play"], [data-control="pause"]'),
          1
        );
        assert.strictEqual(yield* inBar('[data-control="step"]'), 1);
        assert.isAbove(yield* inBar("[data-flow-picker] [data-flow]"), 0);
        assert.strictEqual(
          yield* Effect.promise(() =>
            page.locator("header [data-playback-controls]").count()
          ),
          0
        );
        assert.deepStrictEqual(errors, []);
      })
    )
  );

  for (const width of [1280, 900]) {
    it.live(`stays clear of the zoom controls at ${width}×800`, () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { page } = yield* reviewPage;

          yield* Effect.promise(() =>
            page.setViewportSize({ width, height: 800 })
          );
          yield* goToLastChapter(page);

          const [bar] = yield* boxesOf(page, "[data-playback-bar]");
          const zoom = yield* zoomControlsBox(page);

          assert.isDefined(bar);
          assert.isFalse(intersects(bar ?? zoom, zoom));
        })
      )
    );
  }
});
