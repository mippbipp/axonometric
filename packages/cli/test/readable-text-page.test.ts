import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect, Order, String as Str } from "effect";
import type { Page } from "playwright";

import { drawingReport, overlap } from "./drawing-report.ts";
import type { DrawingReport } from "./drawing-report.ts";
import { crowdedMap, fullMap, pipelineMap } from "./fixtures.ts";
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

        // Each step tag clears every other step's box, and sits nearer its
        // own step than any other.
        const tags = yield* inPage<
          readonly {
            readonly step: number;
            readonly onOthers: readonly number[];
            readonly nearest: number;
          }[]
        >(
          page,
          `(() => {
            const boxes = [...document.querySelectorAll("[data-inside-view] [data-step]")].map((step) => ({
              step: Number(step.dataset.step),
              polygons: [...step.querySelectorAll("polygon")].map((part) => part.getBoundingClientRect()),
              centre: (() => { const at = step.getBoundingClientRect(); return { x: at.x + at.width / 2, y: at.y + at.height / 2 }; })(),
            }));
            const meets = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;

            return [...document.querySelectorAll("[data-step-tag]")].map((tag) => {
              const step = Number(tag.dataset.stepTag);
              const at = tag.querySelector("rect").getBoundingClientRect();
              const centre = { x: at.x + at.width / 2, y: at.y + at.height / 2 };
              const distance = (box) => Math.hypot(box.centre.x - centre.x, box.centre.y - centre.y);

              return {
                step,
                onOthers: boxes.filter((box) => box.step !== step && box.polygons.some((part) => meets(at, part))).map((box) => box.step),
                nearest: boxes.reduce((best, box) => (distance(box) < distance(best) ? box : best)).step,
              };
            });
          })()`
        );

        for (const tag of tags) {
          assert.deepStrictEqual(tag.onOthers, [], `step ${tag.step}`);
          assert.strictEqual(tag.nearest, tag.step, `step ${tag.step}`);
        }
      })
    )
  );
});

/** Every text over text, and text over a box, drawn now. */
const textClashes = Effect.fnUntraced(function* (page: Page) {
  const report = yield* inPage<DrawingReport>(page, drawingReport);

  return [
    ...Arr.flatMap(report.text, (first, index) =>
      Arr.flatMap(report.text.slice(index + 1), (second) =>
        overlap(first.polygon, second.polygon)
          ? [`${first.id} × ${second.id}`]
          : []
      )
    ),
    ...Arr.flatMap(report.text, (text) =>
      Arr.flatMap(report.structures, (box) =>
        overlap(text.polygon, box.polygon) ? [`${text.id} × ${box.id}`] : []
      )
    ),
  ];
});

/** Whether every structure, tag, zone and label is inside the canvas. */
const outsideCanvas = (page: Page) =>
  inPage<readonly string[]>(
    page,
    `(() => {
      const box = document.querySelector("svg[data-scale]").getBoundingClientRect();

      return [...document.querySelectorAll("[data-name-tag], [data-structure], [data-zone-plate], [data-hop-label], [data-zone-title]")]
        .filter((element) => {
          const at = element.getBoundingClientRect();

          return at.left < box.left - 0.5 || at.right > box.right + 0.5 || at.top < box.top - 0.5 || at.bottom > box.bottom + 0.5;
        })
        .map((element) => element.outerHTML.slice(0, 60));
    })()`
  );

describe("grown text at fit, at 1280×800", () => {
  for (const { name, map, system } of [
    { name: "review", map: fullMap, system: "review" },
    { name: "crowded", map: crowdedMap, system: "crowded" },
    { name: "pipeline", map: pipelineMap, system: "flake-pipeline" },
  ]) {
    it.live(
      `stays clear of text and boxes on the ${name} map, in both views`,
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const page = yield* openAt1280(yield* map, system);

            yield* goToChapter(page, "c-all");

            for (const view of ["iso", "plan"] as const) {
              yield* showView(page, view);

              assert.deepStrictEqual(
                yield* textClashes(page),
                [],
                `${view} view`
              );
            }
          })
        ),
      60_000
    );
  }

  it.live("fits the whole pipeline map in both views", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const page = yield* openAt1280(yield* pipelineMap, "flake-pipeline");

        yield* goToChapter(page, "c-all");

        for (const view of ["iso", "plan"] as const) {
          yield* showView(page, view);
          assert.deepStrictEqual(yield* outsideCanvas(page), [], view);
        }
      })
    )
  );

  it.live("shows the review map's hop labels that fit at 9 px", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const page = yield* openAt1280(yield* fullMap, "review");

        yield* goToChapter(page, "c-all");

        const shown = Effect.fnUntraced(function* () {
          const ids = yield* inPage<readonly string[]>(
            page,
            '[...document.querySelectorAll("[data-hop-label]")].map((label) => label.dataset.hopLabel)'
          );

          return Arr.sort(ids, Order.String);
        });

        // At full size the Iso view has room for h-note and h-store only;
        // h-save and h-pr have none and show on hover. At fit, 0.65, labels
        // grow 21% to reach 9 px, and h-note's grown label no longer clears
        // the engineer's and the page's boxes, so it shows on hover too.
        assert.deepStrictEqual(yield* shown(), ["h-store"]);

        // Plan view at fit, 0.50, keeps room for h-pr and h-store. Grown
        // 25%, h-note's and h-save's labels land on the boxes around them.
        yield* showView(page, "plan");
        assert.deepStrictEqual(yield* shown(), ["h-pr", "h-store"]);

        // A hidden label still shows while the pointer is on its hop.
        yield* Effect.promise(() =>
          page.locator('[data-hop="h-note"]').dispatchEvent("pointerover")
        );
        yield* waitFor(page, '[data-hop-label="h-note"]');
      })
    )
  );
});

describe("hidden hop labels on the pipeline map at fit", () => {
  it.live("can be read in the panel of a packet on the hop", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const page = yield* openAt1280(yield* pipelineMap, "flake-pipeline");

        yield* goToChapter(page, "c-all");

        // A packet on a hop whose label the scene hid, and that hop's label
        // from the map state.
        const hidden = yield* inPage<{ hop: string; label: string }[]>(
          page,
          `(() => {
            const state = JSON.parse(document.getElementById("axonometric-map-state").textContent);
            const labelOf = new Map(state.data.hops.map((hop) => [hop.id, hop.label]));

            return [...document.querySelectorAll("[data-packet]")]
              .map((packet) => packet.dataset.packet)
              .filter((hop) => document.querySelector('[data-hop-label="' + hop + '"]') === null)
              .map((hop) => ({ hop, label: labelOf.get(hop) }));
          })()`
        );

        assert.isNotEmpty(hidden, "no packet is on a hop with a hidden label");

        for (const { hop, label } of hidden.slice(0, 2)) {
          yield* Effect.promise(() =>
            page
              .locator(`[data-packet="${hop}"]`)
              .first()
              .dispatchEvent("click")
          );
          yield* waitFor(page, `[data-packet-panel="${hop}"]`);

          assert.strictEqual(
            yield* Effect.promise(() =>
              page.locator("[data-packet-label]").textContent()
            ),
            label
          );
        }
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
