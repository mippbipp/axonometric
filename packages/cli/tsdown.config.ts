import { fileURLToPath } from "node:url";

import { defineConfig } from "tsdown";
import type { UserConfig } from "tsdown";

const editorPageModule = /[\\/]cli[\\/]src[\\/]editor-page\.ts$/u;

const editorPageHtml = fileURLToPath(
  new URL("../editor/dist/index.html", import.meta.url)
);

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
