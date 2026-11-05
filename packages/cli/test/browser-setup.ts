import { afterAll } from "vitest";

import { closeBrowser } from "./browser.ts";

// oxlint-disable-next-line vitest/require-top-level-describe, vitest/no-hooks -- one hook per file, from the setup file, so test files don't register it
afterAll(closeBrowser);
