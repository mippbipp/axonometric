import { promisify } from "node:util";
import { inflate } from "node:zlib";

import { assert } from "@effect/vitest";
import { Effect } from "effect";

// The bytes of "\x89PNG\r\n\x1A\n", in decimal.
export const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];

const inflateAsync = promisify(inflate);

/** The RGBA pixels of an 8-bit RGBA PNG, such as resvg writes. */
export const decodePng = Effect.fnUntraced(function* (bytes: Uint8Array) {
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
