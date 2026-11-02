import { createRequire } from "node:module";

import { Effect, FileSystem, Path } from "effect";

/**
 * The files the PNG rasteriser needs: resvg's WASM and the fonts it draws
 * in. Running from source reads them from disk. The bundle replaces this
 * module with one that holds them, compressed, as strings (see
 * `tsdown.config.ts`), so the bundle and the single-executable binaries need
 * no other files.
 */
export const resvgWasm = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;

  const wasm = createRequire(import.meta.url).resolve(
    "@resvg/resvg-wasm/index_bg.wasm"
  );

  return yield* fs.readFile(wasm);
});

/** The weights of Liberation Mono the drawing uses: regular, and bold for code chips. */
const fontFiles = [
  "LiberationMono-Regular.ttf",
  "LiberationMono-Bold.ttf",
] as const;

export const resvgFonts = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  return yield* Effect.forEach(fontFiles, (name) =>
    fs.readFile(path.join(import.meta.dirname, "..", "assets", "fonts", name))
  );
});
