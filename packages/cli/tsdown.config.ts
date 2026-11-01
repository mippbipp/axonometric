import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { brotliCompress, constants } from "node:zlib";

import { defineConfig } from "tsdown";
import type { UserConfig } from "tsdown";

const editorPageModule = /[\\/]cli[\\/]src[\\/]editor-page\.ts$/u;

const editorPageHtml = fileURLToPath(
  new URL("../editor/dist/index.html", import.meta.url)
);

const rasteriseAssetsModule = /[\\/]cli[\\/]src[\\/]rasterise-assets\.ts$/u;

const resvgWasmFile = fileURLToPath(
  import.meta.resolve("@resvg/resvg-wasm/index_bg.wasm")
);

const fontFile = fileURLToPath(
  new URL("assets/fonts/LiberationMono-Regular.ttf", import.meta.url)
);

const compress = promisify(brotliCompress);

/** `bytes` brotli-compressed and written as base64 text. */
const packed = (bytes: Uint8Array) =>
  compress(bytes, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
      [constants.BROTLI_PARAM_SIZE_HINT]: bytes.length,
    },
  }).then((packedBytes) => packedBytes.toString("base64"));

const shared: UserConfig = {
  platform: "node",
  target: "node24.22",
  dts: false,
  // The npm package is one self-contained file. Everything, including
  // @axonometric/contracts and effect, is bundled, so the output may import
  // Node built-ins only.
  deps: {
    onlyBundle: false,
    onlyImport: [],
  },
  plugins: [
    {
      // The PNG rasteriser's WASM and font ride in the bundle as compressed
      // strings, and are unpacked on first use.
      name: "axonometric:embed-rasteriser-assets",
      load(id) {
        if (!rasteriseAssetsModule.test(id)) {
          return null;
        }

        return Promise.all([
          this.fs.readFile(resvgWasmFile).then(packed),
          this.fs.readFile(fontFile).then(packed),
        ]).then(
          ([wasm, font]) => `import { brotliDecompressSync } from "node:zlib";
import { Effect } from "effect";
const unpack = (text) => Effect.sync(() => new Uint8Array(brotliDecompressSync(Buffer.from(text, "base64"))));
export const resvgWasm = unpack(${JSON.stringify(wasm)});
export const resvgFont = unpack(${JSON.stringify(font)});
`
        );
      },
    },
    {
      // From source, the CLI reads the editor's built page from disk. The
      // bundle carries the page as a string instead, so it needs no other
      // files, and a CommonJS single executable can use it the same way.
      name: "axonometric:embed-editor-page",
      load(id) {
        if (!editorPageModule.test(id)) {
          return null;
        }

        return this.fs
          .readFile(editorPageHtml, { encoding: "utf8" })
          .then(
            (html) =>
              `import { Effect } from "effect";\nexport const editorPage = Effect.succeed(${JSON.stringify(html)});\n`
          );
      },
    },
  ],
};

export default defineConfig([
  { ...shared, entry: { bin: "src/bin.ts" }, format: "esm" },
  // Node 24's single executables only run a CommonJS entry script, so the
  // binaries are built from this copy (see scripts/build-sea.ts).
  {
    ...shared,
    entry: { sea: "src/bin.ts" },
    format: "cjs",
    clean: false,
    outExtensions: () => ({ js: ".cjs" }),
  },
]);
