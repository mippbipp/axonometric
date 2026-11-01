import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Browser tests drive Chromium and build real maps. On shared CI runners
    // they take several times longer than locally, past Vitest's 5 s default.
    testTimeout: 30_000,
  },
});
