import { tagCharWidth, textSizes } from "@axonometric/contracts";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Path } from "effect";

// The scene measures text with fixed widths per character, not with a canvas
// or the DOM, so the page and the command place text the same way. Those
// widths are right for the bundled font only if it is as wide as they
// assume. This reads the font's own advance width to check.

/** The advance width of the font's first glyph, in em. */
const advanceInEm = (font: Uint8Array) => {
  const view = new DataView(font.buffer, font.byteOffset, font.byteLength);
  const tables = view.getUint16(4);
  const offsets = new Map<string, number>();

  for (let at = 0; at < tables; at += 1) {
    const entry = 12 + at * 16;

    offsets.set(
      String.fromCodePoint(...font.subarray(entry, entry + 4)),
      view.getUint32(entry + 8)
    );
  }

  const head = offsets.get("head") ?? 0;
  const hmtx = offsets.get("hmtx") ?? 0;

  return view.getUint16(hmtx) / view.getUint16(head + 18);
};

describe("the bundled font", () => {
  it.effect("is as wide as the scene assumes when it places text", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;

      const font = yield* fs.readFile(
        path.join(
          import.meta.dirname,
          "..",
          "assets",
          "fonts",
          "LiberationMono-Regular.ttf"
        )
      );

      const em = advanceInEm(font);

      assert.closeTo(em, 0.6, 0.001);
      // A name tag's width per character is its font size times the advance.
      assert.closeTo(tagCharWidth, textSizes.tag.font * em, 0.01);
    }).pipe(Effect.provide(NodeServices.layer))
  );
});
