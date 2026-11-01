import { promisify } from "node:util";
import { inflate } from "node:zlib";

import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect } from "effect";

import { rasterise, RasteriseFailed } from "../src/rasterise.ts";

// The bytes of "\x89PNG\r\n\x1A\n", in decimal.
const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];

const inflateAsync = promisify(inflate);

/** The RGBA pixels of an 8-bit RGBA PNG, such as resvg writes. */
const decodePng = Effect.fnUntraced(function* (bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const data: Uint8Array[] = [];
  let width = 0;
  let height = 0;
  let at = pngSignature.length;

  while (at < bytes.length) {
    const length = view.getUint32(at);
    const type = String.fromCodePoint(...bytes.subarray(at + 4, at + 8));
    const body = bytes.subarray(at + 8, at + 8 + length);

    if (type === "IHDR") {
      width = view.getUint32(at + 8);
      height = view.getUint32(at + 12);
      // Bit depth 8, colour type 6 (RGBA).
      assert.deepStrictEqual([...body.subarray(8, 10)], [8, 6]);
    } else if (type === "IDAT") {
      data.push(body);
    }

    at += 12 + length;
  }

  const raw = yield* Effect.promise(() => inflateAsync(Buffer.concat(data)));
  const stride = width * 4;
  const pixels = new Uint8Array(stride * height);

  for (let row = 0; row < height; row += 1) {
    const filter = raw[row * (stride + 1)];
    const line = raw.subarray(row * (stride + 1) + 1, (row + 1) * (stride + 1));

    for (let column = 0; column < stride; column += 1) {
      const left = column >= 4 ? (pixels[row * stride + column - 4] ?? 0) : 0;
      const up = row > 0 ? (pixels[(row - 1) * stride + column] ?? 0) : 0;

      const upLeft =
        row > 0 && column >= 4
          ? (pixels[(row - 1) * stride + column - 4] ?? 0)
          : 0;

      const estimate = left + up - upLeft;
      const toLeft = Math.abs(estimate - left);
      const toUp = Math.abs(estimate - up);
      const toUpLeft = Math.abs(estimate - upLeft);

      const paeth =
        toLeft <= toUp && toLeft <= toUpLeft
          ? left
          : toUp <= toUpLeft
            ? up
            : upLeft;

      const predictions = [0, left, up, (left + up) >> 1, paeth];

      pixels[row * stride + column] =
        ((line[column] ?? 0) + (predictions[filter ?? 0] ?? 0)) % 256;
    }
  }

  return {
    width,
    height,
    pixel: (x: number, y: number) => [
      ...pixels.subarray((y * width + x) * 4, (y * width + x) * 4 + 4),
    ],
    pixels,
  };
});

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
