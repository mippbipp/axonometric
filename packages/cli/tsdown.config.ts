import { defineConfig } from "tsdown";

export default defineConfig({
  entry: { bin: "src/bin.ts" },
  format: "esm",
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
});
