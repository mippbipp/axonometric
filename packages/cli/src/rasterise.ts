import { exportFontFamily } from "@axonometric/contracts";
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import { Effect, Schema } from "effect";
import { CliError } from "effect/cli";

import { resvgFont, resvgWasm } from "./rasterise-assets.ts";

/** The SVG couldn't be drawn as a PNG. Nothing was written. */
export class RasteriseFailed extends Schema.TaggedError<
  RasteriseFailed,
  { readonly brand: unique symbol }
>()("RasteriseFailed", { reason: Schema.String }) {
  public override get [CliError.userMessage]() {
    return `Couldn't draw the PNG: ${this.reason}`;
  }
}

/** The start of the renderer, once it has begun. resvg-wasm starts once per process. */
let started: Promise<void> | undefined;

const start = resvgWasm.pipe(
  Effect.flatMap((bytes) =>
    Effect.tryPromise(() => {
      started ??= initWasm(bytes);

      return started;
    })
  ),
  Effect.mapError((cause) =>
    RasteriseFailed.make({
      reason: `the renderer didn't start: ${String(cause)}`,
    })
  )
);

/**
 * Draws `svgText` as PNG bytes, `scale` times its own size, with no browser.
 * Text is drawn in the embedded Liberation Mono whatever `font-family` says,
 * and never reads the OS's fonts, so the same SVG gives the same PNG on every
 * platform.
 */
export const rasterise = Effect.fn("rasterise")(function* (
  svgText: string,
  scale: number
) {
  yield* start;

  const font = yield* resvgFont.pipe(
    Effect.mapError((cause) =>
      RasteriseFailed.make({ reason: `the font didn't load: ${String(cause)}` })
    )
  );

  return yield* Effect.try({
    try: () => {
      const resvg = new Resvg(svgText, {
        fitTo: { mode: "zoom", value: scale },
        font: {
          loadSystemFonts: false,
          fontBuffers: [font],
          defaultFontFamily: exportFontFamily,
          monospaceFamily: exportFontFamily,
          sansSerifFamily: exportFontFamily,
          serifFamily: exportFontFamily,
        },
      });

      try {
        return resvg.render().asPng();
      } finally {
        resvg.free();
      }
    },
    catch: (cause) => RasteriseFailed.make({ reason: String(cause) }),
  });
});
