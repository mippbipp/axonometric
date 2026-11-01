import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect, Order } from "effect";
import type { Page } from "playwright";

import { attributesOf, boxesOf } from "./browser.ts";
import { fullMap, minimalMap } from "./fixtures.ts";
import { buildAndOpen } from "./harness.ts";

const reviewPage = Effect.gen(function* () {
  return yield* buildAndOpen(yield* fullMap, "review");
});

const drawnStructures = (page: Page) =>
  attributesOf(page, "[data-structure]", "data-structure").pipe(
    Effect.map((ids) => Arr.sort(ids, Order.String))
  );

const newMarkers = (page: Page) =>
  attributesOf(page, "[data-new-marker]", "data-new-marker").pipe(
    Effect.map((ids) => Arr.sort(ids, Order.String))
  );

const waitForChapter = (page: Page, id: string) =>
  Effect.promise(() =>
    page.locator(`[data-walkthrough][data-chapter="${id}"]`).waitFor()
  );

const press = (page: Page, key: string) =>
  Effect.promise(() => page.keyboard.press(key));

const click = (page: Page, selector: string) =>
  Effect.promise(() => page.locator(selector).click());

const scaleExpression =
  'Number(document.querySelector("svg[data-scale]").dataset.scale)';

const scaleOf = (page: Page) =>
  Effect.promise(() => page.evaluate<number>(scaleExpression));

/** Waits until the viewport's zoom passes `test`, such as `> 2`. */
const waitForScale = (page: Page, test: string) =>
  Effect.promise(() =>
    page.waitForFunction(`${scaleExpression} ${test}`, undefined, {
      timeout: 5000,
    })
  );

const zoomIn = (page: Page) =>
  click(page, 'button[aria-label="Zoom in"]').pipe(
    Effect.andThen(click(page, 'button[aria-label="Zoom in"]'))
  );

/** Asserts that every drawn structure and name tag is inside the canvas. */
const assertInside = Effect.fnUntraced(function* (page: Page) {
  const [svg] = yield* boxesOf(page, "svg[data-scale]");
  const drawn = yield* boxesOf(page, "[data-structure], [data-name-tag]");

  assert.isDefined(svg);

  if (svg === undefined) {
    return;
  }

  for (const box of drawn) {
    assert.isAtLeast(box.x, svg.x);
    assert.isAtLeast(box.y, svg.y);
    assert.isAtMost(box.x + box.width, svg.x + svg.width);
    assert.isAtMost(box.y + box.height, svg.y + svg.height);
  }
});

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
        const fitted = yield* scaleOf(page);

        yield* press(page, "ArrowRight");
        yield* press(page, "ArrowRight");
        yield* waitForChapter(page, "c-all");
        yield* waitForScale(page, `< ${fitted}`);

        const last = yield* boxesOf(page, '[data-structure="engineer"]');

        assert.isDefined(svg);
        // Two structures are drawn larger in chapter 1 than when six share
        // the view.
        assert.isAbove(first[0]?.width ?? 0, last[0]?.width ?? 0);
      })
    )
  );

  it.live("caps the fit for a small chapter and centres the drawing", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* reviewPage;
        const [svg] = yield* boxesOf(page, "svg[data-scale]");
        const drawn = yield* boxesOf(page, "[data-structure], [data-name-tag]");

        assert.isAtMost(yield* scaleOf(page), 1.5);
        assert.isDefined(svg);

        if (svg === undefined) {
          return;
        }

        const left = Math.min(...Arr.map(drawn, (box) => box.x));
        const right = Math.max(...Arr.map(drawn, (box) => box.x + box.width));
        const top = Math.min(...Arr.map(drawn, (box) => box.y));
        const bottom = Math.max(...Arr.map(drawn, (box) => box.y + box.height));

        // The fitted bounds use each footprint's full top, which reaches a
        // little above the engineer's figure, so the vertical check is looser.
        assert.closeTo((left + right) / 2, svg.x + svg.width / 2, 8);
        assert.closeTo((top + bottom) / 2, svg.y + svg.height / 2, 40);

        // Zooming by hand still goes past the cap.
        yield* zoomIn(page);
        yield* zoomIn(page);
        yield* waitForScale(page, "> 1.5");
      })
    )
  );

  it.live("refits the view on every chapter change, after a manual zoom", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* reviewPage;
        const fittedFirst = yield* scaleOf(page);

        yield* zoomIn(page);
        yield* waitForScale(page, `> ${fittedFirst * 1.3}`);

        yield* press(page, "ArrowRight");
        yield* waitForChapter(page, "c-save");
        // Four structures need a smaller scale than two.
        yield* waitForScale(page, `< ${fittedFirst}`);
        yield* assertInside(page);

        const fittedSecond = yield* scaleOf(page);

        yield* zoomIn(page);
        yield* waitForScale(page, `> ${fittedSecond * 1.3}`);
        yield* press(page, "ArrowLeft");
        yield* waitForChapter(page, "c-page");
        yield* waitForScale(page, `=== ${fittedFirst}`);
        yield* assertInside(page);
      })
    )
  );

  it.live(
    "leaves the zoom keys to the viewport and the arrows to chapters",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { page } = yield* reviewPage;
          const fitted = yield* scaleOf(page);

          yield* press(page, "Equal");
          yield* waitForScale(page, `> ${fitted}`);
          yield* press(page, "Digit0");
          yield* waitForScale(page, `=== ${fitted}`);

          const chapter = yield* attributesOf(
            page,
            "[data-walkthrough]",
            "data-chapter"
          );

          yield* press(page, "BracketRight");
          yield* waitForChapter(page, "c-save");

          assert.deepStrictEqual(chapter, ["c-page"]);
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
