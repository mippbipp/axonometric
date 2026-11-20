import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Test files in one worker share modules instead of importing everything
    // again, which saves the import time.
    isolate: false,
    // The slowest test took 11.2 s on the Windows runner in CI (run
    // 44645090501), and the next on that runner 8.4 s. This is about 2.7 times
    // the slowest.
    testTimeout: 30_000,
  },
});
