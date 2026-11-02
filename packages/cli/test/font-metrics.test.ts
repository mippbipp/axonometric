import { tagCharWidth, textSizes } from "@axonometric/contracts";
import { boldBase64, regularBase64 } from "@axonometric/drawing/font-data";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect, FileSystem, Path } from "effect";

// The scene measures text with fixed widths per character, not with a canvas
// or the DOM, so the page and the command place text the same way. Those
// widths are right only if the font is as wide as they assume. This reads the
// full TTF's own advance widths to check. The WOFF2 subsets that the page and
// the SVGs embed are checked in the browser (font-width.test.ts), and this
// checks they are the files the strings were made from.

/** Every glyph's advance width in a TTF, and the font's units per em. */
const advancesOf = (font: Uint8Array) => {
  const view = new DataView(font.buffer, font.byteOffset, font.byteLength);

  const tables = new Map(
    Arr.makeBy(view.getUint16(4), (at) => {
      const entry = 12 + at * 16;

      return [
        String.fromCodePoint(...font.subarray(entry, entry + 4)),
        view.getUint32(entry + 8),
      ] as const;
    })
  );

  const head = tables.get("head") ?? 0;
  const hmtx = tables.get("hmtx") ?? 0;
  const metrics = view.getUint16((tables.get("hhea") ?? 0) + 34);

  return {
    unitsPerEm: view.getUint16(head + 18),
    advances: Arr.makeBy(metrics, (glyph) => view.getUint16(hmtx + glyph * 4)),
  };
};

describe("the bundled fonts", () => {
  it.effect("are as wide as the scene assumes when it places text", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const fonts = path.join(import.meta.dirname, "..", "assets", "fonts");

      for (const weight of ["Regular", "Bold"]) {
        const { unitsPerEm, advances } = advancesOf(
          yield* fs.readFile(path.join(fonts, `LiberationMono-${weight}.ttf`))
        );

        // hmtx lists a metric for each glyph up to the last whose advance
        // differs, and every glyph after it shares the last one. A monospace
        // font lists only a few.
        assert.isAbove(advances.length, 1);

        // Every glyph is 0.6 em wide except .null, which has no width.
        for (const advance of Arr.filter(advances, (width) => width > 0)) {
          // 1229 of 2048 units, 0.6001 em.
          assert.closeTo(advance / unitsPerEm, 0.6, 0.0005, weight);
        }
      }

      // A name tag's width per character is its font size times the advance.
      assert.closeTo(tagCharWidth, textSizes.tag.font * 0.6, 0.01);
    }).pipe(Effect.provide(NodeServices.layer))
  );

  it.effect("are the files the embedded base64 strings came from", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;

      const assets = path.join(
        import.meta.dirname,
        "..",
        "..",
        "drawing",
        "assets",
        "fonts"
      );

      for (const [weight, base64] of [
        ["Regular", regularBase64],
        ["Bold", boldBase64],
      ] as const) {
        const file = yield* fs.readFile(
          path.join(assets, `LiberationMono-${weight}-subset.woff2`)
        );

        assert.strictEqual(
          Buffer.from(file).toString("base64"),
          base64,
          weight
        );
      }
    }).pipe(Effect.provide(NodeServices.layer))
  );
});
