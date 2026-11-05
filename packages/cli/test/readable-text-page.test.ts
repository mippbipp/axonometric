import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect } from "effect";
import type { Page } from "playwright";

import { attributesOf } from "./browser.ts";
import { crosses, drawingReport, overlap } from "./drawing-report.ts";
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

            assert.lengthOf(tags, yield* countOf(page, "[data-structure]"));
            assert.isAtLeast(Math.min(...tags), 9.95);

            const labels = yield* sizesOf(page, "[data-hop-label]");
            const chips = yield* sizesOf(page, "[data-code-chip] text");

            for (const size of [...labels, ...chips]) {
              assert.isAtLeast(size, 8.95);
            }

            // At fit the pipeline map has more hops than readable labels.
            // Zoomed in, the hidden ones come back.
            assert.isBelow(labels.length, yield* countOf(page, "[data-hop]"));

            for (let step = 0; step < 4; step += 1) {
              yield* zoomIn(page);
            }

            assert.isAbove(
              (yield* sizesOf(page, "[data-hop-label]")).length,
              labels.length
            );
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

/**
 * Every text over text and text over a box, drawn now, plus in the Iso view
 * every first leg through its own source's name tag. Text includes name
 * tags, shown hop labels and zone titles.
 */
const textClashes = Effect.fnUntraced(function* (page: Page) {
  const report = yield* inPage<DrawingReport>(page, drawingReport);

  const view = yield* inPage<string>(
    page,
    'document.querySelector("[data-walkthrough]").dataset.view'
  );

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
    ...(view === "iso"
      ? Arr.flatMap(report.firstLegs, ({ hop, from, leg }) =>
          Arr.some(
            report.text,
            (tag) => tag.id === `tag:${from}` && crosses(leg, tag.polygon)
          )
            ? [`first leg of ${hop} × tag:${from}`]
            : []
        )
      : []),
  ];
});

/** Presses + until text draws at its own size or larger. */
const zoomInToBaseSize = Effect.fnUntraced(function* (page: Page) {
  while ((yield* inPage<number>(page, scaleExpression)) < 1) {
    yield* zoomIn(page);
  }
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

describe("grown text at 1280×800", () => {
  for (const { name, map, system, fits, isoChapters } of [
    {
      name: "review",
      map: fullMap,
      system: "review",
      fits: false,
      isoChapters: ["c-all"],
    },
    {
      name: "crowded",
      map: crowdedMap,
      system: "crowded",
      fits: false,
      isoChapters: ["c-all"],
    },
    {
      name: "pipeline",
      map: pipelineMap,
      system: "flake-pipeline",
      fits: true,
      isoChapters: ["c-monday", "c-pr", "c-all"],
    },
  ]) {
    it.live(
      `stays clear of text and boxes on the ${name} map, in both views`,
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const page = yield* openAt1280(yield* map, system);

            const chapters = yield* attributesOf(
              page,
              "[data-chapter-rail] button[data-chapter]",
              "data-chapter"
            );

            // Plan view is checked in every chapter, at fit and zoomed in to
            // where text draws at its own size; the Iso view at fit.
            for (const view of ["iso", "plan"] as const) {
              yield* showView(page, view);

              for (const chapter of view === "plan" ? chapters : isoChapters) {
                yield* goToChapter(page, chapter);

                const where = `${chapter} in the ${view} view`;

                assert.deepStrictEqual(
                  yield* textClashes(page),
                  [],
                  `${where} at fit`
                );

                if (fits && chapter === "c-all") {
                  assert.deepStrictEqual(yield* outsideCanvas(page), [], where);
                }

                if (view === "plan") {
                  // At fit, hop labels may be too small to show. Zoomed in to
                  // where text draws at its own size, the hidden ones show.
                  yield* zoomInToBaseSize(page);
                  assert.isNotEmpty(
                    yield* attributesOf(
                      page,
                      "[data-hop-label]",
                      "data-hop-label"
                    ),
                    `no hop labels in ${where}`
                  );
                  assert.deepStrictEqual(
                    yield* textClashes(page),
                    [],
                    `${where} zoomed in`
                  );
                }
              }
            }
          })
        ),
      120_000
    );
  }

  it.live(
    "stays clear of text and boxes on the pipeline map at 1780×1020",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { page } = yield* buildAndOpen(
            yield* pipelineMap,
            "flake-pipeline"
          );

          yield* Effect.promise(() =>
            page.setViewportSize({ width: 1780, height: 1020 })
          );

          for (const chapter of ["c-monday", "c-pr", "c-all"]) {
            yield* goToChapter(page, chapter);
            assert.deepStrictEqual(yield* textClashes(page), [], chapter);
          }
        })
      ),
    60_000
  );

  for (const view of ["iso", "plan"] as const) {
    it.live(
      `shows the review map's hop labels at 9 px or more in the ${view} view, and a hidden one while its hop is hovered`,
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const page = yield* openAt1280(yield* fullMap, "review");

            yield* goToChapter(page, "c-all");
            yield* showView(page, view);

            const sizes = yield* sizesOf(page, "[data-hop-label]");

            const shown = yield* attributesOf(
              page,
              "[data-hop-label]",
              "data-hop-label"
            );

            assert.isNotEmpty(sizes);

            for (const size of sizes) {
              assert.isAtLeast(size, 8.95);
            }

            const hidden = Arr.filter(
              yield* attributesOf(page, "[data-hop]", "data-hop"),
              (hop) => !shown.includes(hop)
            );

            // At fit the review map's labels grow to reach 9 px, and some
            // no longer have room beside their hop.
            assert.isNotEmpty(hidden);

            for (const hop of hidden) {
              // Packets move over the line, so dispatch the hover on the
              // hop rather than aiming the mouse at it.
              yield* Effect.promise(() =>
                page.locator(`[data-hop="${hop}"]`).dispatchEvent("pointerover")
              );
              yield* waitFor(page, `[data-hop-label="${hop}"]`);
              yield* Effect.promise(() =>
                page.locator(`[data-hop="${hop}"]`).dispatchEvent("pointerout")
              );
            }
          })
        )
    );
  }
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
