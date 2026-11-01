import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect, String as Str } from "effect";
import type { Page } from "playwright";

import { drawingReport, overlap } from "./drawing-report.ts";
import type { DrawingReport } from "./drawing-report.ts";
import { fullMap, pipelineMap } from "./fixtures.ts";
import { buildAndOpen } from "./harness.ts";

const inPage = <A>(page: Page, expression: string) =>
  Effect.promise(() => page.evaluate<A>(expression));

const click = (page: Page, selector: string) =>
  Effect.promise(() => page.locator(selector).first().click());

const waitFor = (page: Page, selector: string) =>
  Effect.promise(() => page.locator(selector).first().waitFor());

const scaleExpression =
  'Number(document.querySelector("svg[data-scale]").dataset.scale)';

/**
 * How tall each piece of text matching `selector` draws on screen, in
 * pixels: its font size through its screen transform, CSS transforms
 * included. Text that's hidden isn't listed.
 */
const sizesOf = (page: Page, selector: string) =>
  inPage<readonly number[]>(
    page,
    `[...document.querySelectorAll(${JSON.stringify(selector)})]
      .filter((text) => getComputedStyle(text).visibility !== "hidden")
      .map((text) => {
        const matrix = text.getScreenCTM();

        return parseFloat(getComputedStyle(text).fontSize) * Math.hypot(matrix.a, matrix.b);
      })`
  );

/** How many elements match `selector`, shown or hidden. */
const countOf = (page: Page, selector: string) =>
  Effect.promise(() => page.locator(selector).count());

const openAt1280 = Effect.fnUntraced(function* (
  files: Parameters<typeof buildAndOpen>[0],
  system: string
) {
  const { page } = yield* buildAndOpen(files, system);

  yield* Effect.promise(() =>
    page.setViewportSize({ width: 1280, height: 800 })
  );

  return page;
});

const goToChapter = Effect.fnUntraced(function* (page: Page, id: string) {
  yield* click(page, `[data-chapter-rail] button[data-chapter="${id}"]`);
  yield* waitFor(page, `[data-walkthrough][data-chapter="${id}"]`);
  // Pause, so a packet's selection doesn't bring a hidden label in.
  yield* click(page, '[data-playback-controls] [data-control="pause"]');
});

const showView = Effect.fnUntraced(function* (
  page: Page,
  view: "iso" | "plan"
) {
  yield* click(page, `[data-view-toggle] [data-view="${view}"]`);
  yield* waitFor(page, `[data-walkthrough][data-view="${view}"]`);
  // A switch keeps the zoom; 0 fits the chapter in this view.
  yield* Effect.promise(() => page.keyboard.press("0"));
});

const zoomIn = Effect.fnUntraced(function* (page: Page) {
  const before = yield* inPage<number>(page, scaleExpression);

  yield* Effect.promise(() => page.keyboard.press("+"));
  yield* Effect.promise(() =>
    page.waitForFunction(`${scaleExpression} > ${before}`, undefined, {
      timeout: 5000,
    })
  );
});

const tagClashes = Effect.fnUntraced(function* (page: Page) {
  const report = yield* inPage<DrawingReport>(page, drawingReport);
  const tags = Arr.filter(report.text, ({ id }) => Str.startsWith("tag:")(id));

  return Arr.flatMap(tags, (first, index) =>
    Arr.flatMap(tags.slice(index + 1), (second) =>
      overlap(first.polygon, second.polygon)
        ? [`${first.id} × ${second.id}`]
        : []
    )
  );
});

describe("text on the pipeline map at 1280×800", () => {
  for (const view of ["iso", "plan"] as const) {
    it.live(
      `keeps name tags at 10 px and shows only readable hop labels in the ${view} view`,
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const page = yield* openAt1280(
              yield* pipelineMap,
              "flake-pipeline"
            );

            yield* goToChapter(page, "c-all");
            yield* showView(page, view);

            const tags = yield* sizesOf(page, "[data-name-tag] text");

            assert.lengthOf(tags, 15);
            assert.isAtLeast(Math.min(...tags), 9.95);
            assert.deepStrictEqual(yield* tagClashes(page), []);

            const labels = yield* sizesOf(page, "[data-hop-label]");
            const chips = yield* sizesOf(page, "[data-code-chip] text");

            for (const size of [...labels, ...chips]) {
              assert.isAtLeast(size, 8.95);
            }

            const placed = yield* countOf(page, "[data-hop-label]");

            if (labels.length < placed) {
              // Hidden at fit, back once zoomed in far enough.
              for (let step = 0; step < 4; step += 1) {
                yield* zoomIn(page);
              }

              assert.strictEqual(
                (yield* sizesOf(page, "[data-hop-label]")).length,
                placed
              );
            }
          })
        ),
      60_000
    );
  }

  it.live("keeps the Flake fixer's 9 step names at 10 px inside it", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const page = yield* openAt1280(yield* pipelineMap, "flake-pipeline");

        yield* goToChapter(page, "c-all");
        yield* Effect.promise(() =>
          page.locator('[data-structure="fixer"]').dblclick()
        );
        yield* waitFor(page, '[data-inside-view="fixer"]');

        const steps = yield* sizesOf(page, "[data-step-tag] text");

        assert.lengthOf(steps, 9);
        assert.isAtLeast(Math.min(...steps), 9.95);
      })
    )
  );
});

describe("text on the review map at 1280×800", () => {
  it.live("fits at the same zoom as before name tags kept their size", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const page = yield* openAt1280(yield* fullMap, "review");

        yield* goToChapter(page, "c-all");

        // Measured before the change: the review map's tags never collide,
        // so fitting it is unchanged.
        assert.closeTo(
          yield* inPage<number>(page, scaleExpression),
          0.651,
          1e-3
        );
      })
    )
  );
});
