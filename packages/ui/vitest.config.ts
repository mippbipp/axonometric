import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    css: false,
    environment: "jsdom",
    globals: true,
    setupFiles: ["./test/setup.ts"],
  },
});
