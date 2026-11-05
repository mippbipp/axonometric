import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Test files in one worker share modules instead of importing everything
    // again, which saves the import time.
    isolate: false,
  },
});
