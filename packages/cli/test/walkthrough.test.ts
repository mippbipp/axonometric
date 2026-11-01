import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect, Order } from "effect";
import type { Page } from "playwright";

import { boxesOf } from "./browser.ts";
import { fullMap, minimalMap } from "./fixtures.ts";
import { buildAndOpen } from "./harness.ts";

const reviewPage = Effect.gen(function* () {
  return yield* buildAndOpen(yield* fullMap, "review");
});

const drawnStructures = (page: Page) =>
  Effect.promise(async () =>
    Arr.sort(
      await page
        .locator("[data-structure]")
        .evaluateAll((elements) =>
          elements.map((element) => element.getAttribute("data-structure"))
        ),
      Order.String
    )
  );

const newMarkers = (page: Page) =>
  Effect.promise(async () =>
    Arr.sort(
      await page
        .locator("[data-new-marker]")
        .evaluateAll((elements) =>
          elements.map((element) => element.getAttribute("data-new-marker"))
        ),
      Order.String
    )
  );

const waitForChapter = (page: Page, id: string) =>
  Effect.promise(() =>
    page.locator(`[data-walkthrough][data-chapter="${id}"]`).waitFor()
  );

const press = (page: Page, key: string) =>
  Effect.promise(() => page.keyboard.press(key));

const click = (page: Page, selector: string) =>
  Effect.promise(() => page.locator(selector).click());

describe("the chapter walkthrough", () => {
  it.live("lists every chapter in the rail and opens on the first", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page, errors } = yield* reviewPage;

        const rail = yield* Effect.promise(() =>
          page.locator("[data-chapter-rail] button").allTextContents()
        );

        const story = yield* Effect.promise(() =>
          page.locator("[data-chapter-story]").textContent()
        );

        assert.deepStrictEqual(rail, ["1", "2", "3"]);
        yield* waitForChapter(page, "c-page");
        assert.include(story ?? "", "The page");
        assert.include(story ?? "", "The engineer reads the map.");
        assert.include(story ?? "", "Everything starts on the page.");
        assert.deepStrictEqual(errors, []);
      })
    )
  );

  it.live("draws only the structures revealed so far and marks new ones", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* reviewPage;

        assert.deepStrictEqual(yield* drawnStructures(page), [
          "engineer",
          "page",
        ]);

        yield* click(page, '[data-chapter-rail] button[data-chapter="c-save"]');
        yield* waitForChapter(page, "c-save");

        assert.deepStrictEqual(yield* drawnStructures(page), [
          "engineer",
          "page",
          "proposals",
          "server",
        ]);
        assert.deepStrictEqual(yield* newMarkers(page), [
          "proposals",
          "server",
        ]);

        const hops = yield* Effect.promise(() =>
          page.locator("[data-hop]").count()
        );

        // h-pr ends at the pull request, which isn't revealed yet.
        assert.strictEqual(hops, 3);
      })
    )
  );

  it.live("moves between chapters with the arrow keys", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* reviewPage;

        yield* press(page, "ArrowRight");
        yield* waitForChapter(page, "c-save");
        yield* press(page, "ArrowRight");
        yield* waitForChapter(page, "c-all");
        // The last chapter stays put.
        yield* press(page, "ArrowRight");
        yield* waitForChapter(page, "c-all");

        assert.lengthOf(yield* drawnStructures(page), 6);

        yield* press(page, "ArrowLeft");
        yield* waitForChapter(page, "c-save");
        yield* press(page, "BracketLeft");
        yield* waitForChapter(page, "c-page");
      })
    )
  );

  it.live("zooms to fit the structures revealed so far", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* reviewPage;
        const [svg] = yield* boxesOf(page, "svg");
        const first = yield* boxesOf(page, '[data-structure="engineer"]');

        yield* press(page, "ArrowRight");
        yield* press(page, "ArrowRight");
        yield* waitForChapter(page, "c-all");

        const last = yield* boxesOf(page, '[data-structure="engineer"]');

        assert.isDefined(svg);
        // Two structures fill the view in chapter 1; six share it later.
        assert.isAbove(first[0]?.width ?? 0, (last[0]?.width ?? 0) * 1.5);
      })
    )
  );

  it.live("shows a map with no chapters whole, as one chapter", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* buildAndOpen(yield* minimalMap, "pipeline");

        const rail = yield* Effect.promise(() =>
          page.locator("[data-chapter-rail] button").count()
        );

        assert.strictEqual(rail, 1);
        assert.lengthOf(yield* drawnStructures(page), 2);
        assert.deepStrictEqual(yield* newMarkers(page), []);
      })
    )
  );
});
