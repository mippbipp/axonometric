import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import type { Page } from "playwright";

import { literal } from "./browser.ts";
import { minimalMap } from "./fixtures.ts";
import { buildAndOpen } from "./harness.ts";

const builtPage = Effect.gen(function* () {
  return yield* buildAndOpen(yield* minimalMap, "pipeline");
});

const paper =
  "getComputedStyle(document.querySelector('main')).backgroundColor";

const label = 'document.querySelector("[data-theme-toggle]").textContent';

const theme = 'document.documentElement.getAttribute("data-theme")';

/**
 * Waits until `expression` evaluates to `expected` in the page. Theme
 * changes reach the page asynchronously (a matchMedia change event, then a
 * React render), so a test waits for each new state instead of reading once.
 */
const waitFor = (page: Page, expression: string, expected: string | null) =>
  Effect.promise(() =>
    page.waitForFunction(
      `(${expression}) === ${literal(expected)}`,
      undefined,
      {
        timeout: 5000,
      }
    )
  );

/** Waits until `expression` evaluates to anything but `previous`. */
const waitForChange = (page: Page, expression: string, previous: string) =>
  Effect.promise(() =>
    page.waitForFunction(
      `(${expression}) !== ${literal(previous)}`,
      undefined,
      {
        timeout: 5000,
      }
    )
  );

const read = (page: Page, expression: string) =>
  Effect.promise(() => page.evaluate<string>(expression));

const toggle = (page: Page) =>
  Effect.promise(() => page.locator("[data-theme-toggle]").click());

const prefer = (page: Page, colorScheme: "light" | "dark") =>
  Effect.promise(() => page.emulateMedia({ colorScheme }));

/** Follows the system in `colorScheme`, once the page shows it. */
const onSystem = Effect.fnUntraced(function* (
  page: Page,
  colorScheme: "light" | "dark"
) {
  yield* prefer(page, colorScheme);
  yield* waitFor(page, theme, null);
  yield* waitFor(
    page,
    label,
    colorScheme === "light" ? "Use dark theme" : "Use light theme"
  );

  return yield* read(page, paper);
});

describe("the theme", () => {
  it.live("follows the system's colour scheme by default", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* builtPage;
        const light = yield* onSystem(page, "light");
        const dark = yield* onSystem(page, "dark");

        assert.notStrictEqual(light, dark);
      })
    )
  );

  it.live("flips the visible theme on the first click, on either system", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* builtPage;
        const lightSystem = yield* onSystem(page, "light");

        yield* toggle(page);
        yield* waitFor(page, theme, "dark");
        yield* waitForChange(page, paper, lightSystem);
        yield* waitFor(page, label, "Follow system theme");

        // Back to following the system, which is now dark.
        yield* toggle(page);
        const darkSystem = yield* onSystem(page, "dark");

        yield* toggle(page);
        yield* waitFor(page, theme, "light");
        yield* waitFor(page, paper, lightSystem);

        assert.notStrictEqual(darkSystem, lightSystem);
      })
    )
  );

  it.live("goes back to the system on the next click, and remembers", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* builtPage;

        yield* onSystem(page, "light");
        yield* toggle(page);
        yield* waitFor(page, theme, "dark");

        // Reloading keeps the choice. The inline script sets it before the
        // page draws, so it's there as soon as the page loads.
        yield* Effect.promise(() => page.reload());
        const kept = yield* read(page, theme);

        yield* waitFor(page, label, "Follow system theme");
        yield* toggle(page);
        yield* waitFor(page, theme, null);

        assert.strictEqual(kept, "dark");
      })
    )
  );
});
