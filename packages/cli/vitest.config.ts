import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Browser tests drive Chromium and build real maps. On shared CI runners
    // they take several times longer than locally, past Vitest's 5 s default.
    testTimeout: 30_000,
    // Test files in one worker share modules instead of importing everything
    // again, which saves the import time. Module state that a test file
    // leaves behind has to be reset from a setup file, which runs per file.
    isolate: false,
    setupFiles: ["./test/browser-setup.ts"],
  },
});
