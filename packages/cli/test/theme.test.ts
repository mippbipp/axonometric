import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import type { Page } from "playwright";

import { minimalMap } from "./fixtures.ts";
import { buildAndOpen } from "./harness.ts";

const builtPage = Effect.gen(function* () {
  return yield* buildAndOpen(yield* minimalMap, "pipeline");
});

const themeOf = (page: Page) =>
  Effect.promise(() =>
    page.evaluate<string | null>(
      'document.documentElement.getAttribute("data-theme")'
    )
  );

const paperOf = (page: Page) =>
  Effect.promise(() =>
    page.evaluate<string>(
      "getComputedStyle(document.querySelector('main')).backgroundColor"
    )
  );

const toggle = (page: Page) =>
  Effect.promise(() => page.getByRole("button", { name: /^Theme:/u }).click());

const toggleLabel = (page: Page) =>
  Effect.promise(() =>
    page.getByRole("button", { name: /^Theme:/u }).textContent()
  );

describe("the theme", () => {
  it.live("follows the system's colour scheme by default", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* builtPage;
        const light = yield* paperOf(page);

        yield* Effect.promise(() => page.emulateMedia({ colorScheme: "dark" }));

        const dark = yield* paperOf(page);

        assert.strictEqual(yield* themeOf(page), null);
        assert.strictEqual(yield* toggleLabel(page), "Theme: System");
        assert.notStrictEqual(light, dark);
      })
    )
  );

  it.live("toggles between light, dark and the system, and remembers", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* builtPage;
        const system = yield* paperOf(page);

        yield* toggle(page);
        const darkTheme = yield* themeOf(page);
        const dark = yield* paperOf(page);

        yield* toggle(page);
        const lightTheme = yield* themeOf(page);
        const light = yield* paperOf(page);

        // Reloading keeps the choice, and sets it before the page draws.
        yield* Effect.promise(() => page.reload());
        const kept = yield* themeOf(page);

        yield* toggle(page);
        const back = yield* themeOf(page);

        assert.strictEqual(darkTheme, "dark");
        assert.notStrictEqual(dark, system);
        assert.strictEqual(lightTheme, "light");
        assert.strictEqual(light, system);
        assert.strictEqual(kept, "light");
        assert.strictEqual(back, null);
      })
    )
  );
});
