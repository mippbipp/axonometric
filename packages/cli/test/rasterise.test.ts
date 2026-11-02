import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect } from "effect";

import { rasterise, RasteriseFailed } from "../src/rasterise.ts";
import { decodePng, pngSignature } from "./png.ts";

/** A 20 × 10 SVG: a red square in the left half, and nothing in the right. */
const square = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><rect width="10" height="10" fill="#ff0000"/></svg>`;

const textual = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="20"><rect width="80" height="20" fill="#ffffff"/><text x="2" y="15" font-size="14" font-family="Arial, sans-serif" fill="#000000">MMMM</text></svg>`;

describe("the rasteriser", () => {
  it.effect("draws an SVG as a PNG at the scale given", () =>
    Effect.gen(function* () {
      const png = yield* rasterise(square, 2);
      const image = yield* decodePng(png);

      assert.deepStrictEqual([...png.subarray(0, 8)], pngSignature);
      assert.strictEqual(image.width, 40);
      assert.strictEqual(image.height, 20);
      assert.deepStrictEqual(image.pixel(5, 5), [255, 0, 0, 255]);
      assert.deepStrictEqual(image.pixel(30, 5), [0, 0, 0, 0]);
    }).pipe(Effect.provide(NodeServices.layer))
  );

  it.effect("draws text in the bundled font, not the OS's", () =>
    Effect.gen(function* () {
      const image = yield* decodePng(yield* rasterise(textual, 1));

      const dark = Arr.filter(
        Arr.makeBy(image.width * image.height, (at) => at),
        (at) => (image.pixels[at * 4] ?? 255) < 128
      );

      // "MMMM" in a monospace face covers a few hundred pixels. With no font
      // available, resvg would draw nothing.
      assert.isAbove(dark.length, 100);
    }).pipe(Effect.provide(NodeServices.layer))
  );

  it.effect("fails with the reason when the SVG can't be read", () =>
    Effect.gen(function* () {
      const error = yield* rasterise("not an svg", 1).pipe(Effect.flip);

      assert.instanceOf(error, RasteriseFailed);
      assert.isAbove(error.reason.length, 0);
    }).pipe(Effect.provide(NodeServices.layer))
  );
});
