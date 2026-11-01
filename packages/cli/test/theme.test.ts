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
  Effect.promise(() => page.locator("[data-theme-toggle]").click());

const toggleLabel = (page: Page) =>
  Effect.promise(() => page.locator("[data-theme-toggle]").textContent());

const prefer = (page: Page, colorScheme: "light" | "dark") =>
  Effect.promise(() => page.emulateMedia({ colorScheme }));

describe("the theme", () => {
  it.live("follows the system's colour scheme by default", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* builtPage;

        yield* prefer(page, "light");
        const light = yield* paperOf(page);

        yield* prefer(page, "dark");
        const dark = yield* paperOf(page);

        assert.strictEqual(yield* themeOf(page), null);
        assert.notStrictEqual(light, dark);
      })
    )
  );

  it.live("flips the visible theme on the first click, on either system", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* builtPage;

        yield* prefer(page, "light");
        const lightSystem = yield* paperOf(page);
        const lightLabel = yield* toggleLabel(page);

        yield* toggle(page);
        const fromLight = yield* paperOf(page);
        const fromLightTheme = yield* themeOf(page);

        // Back to following the system, which is now dark.
        yield* toggle(page);
        yield* prefer(page, "dark");
        const darkSystem = yield* paperOf(page);
        const darkLabel = yield* toggleLabel(page);

        yield* toggle(page);
        const fromDark = yield* paperOf(page);
        const fromDarkTheme = yield* themeOf(page);

        assert.strictEqual(lightLabel, "Use dark theme");
        assert.strictEqual(fromLightTheme, "dark");
        assert.notStrictEqual(fromLight, lightSystem);
        assert.strictEqual(darkLabel, "Use light theme");
        assert.strictEqual(fromDarkTheme, "light");
        assert.notStrictEqual(fromDark, darkSystem);
        assert.strictEqual(fromDark, lightSystem);
      })
    )
  );

  it.live("goes back to the system on the next click, and remembers", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* builtPage;

        yield* prefer(page, "light");
        yield* toggle(page);

        // Reloading keeps the choice, and sets it before the page draws.
        yield* Effect.promise(() => page.reload());
        const kept = yield* themeOf(page);
        const label = yield* toggleLabel(page);

        yield* toggle(page);
        const back = yield* themeOf(page);

        assert.strictEqual(kept, "dark");
        assert.strictEqual(label, "Follow system theme");
        assert.strictEqual(back, null);
      })
    )
  );
});
