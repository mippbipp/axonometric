import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect } from "effect";
import type { Page } from "playwright";

import {
  attributesOf,
  goToChapterPaused,
  inPage,
  showViewFitted,
  waitFor,
} from "./browser.ts";
import { pipelineMap } from "./fixtures.ts";
import { buildAndOpen } from "./harness.ts";

/**
 * How tall each piece of text matching `selector` draws on screen, in
 * pixels: its font size through its screen transform, CSS transforms
 * included. Text that's hidden isn't listed.
 */
const sizesOf = (page: Page, selector: string) =>
  inPage<ReadonlyArray<number>>(
    page,
    `[...document.querySelectorAll(${JSON.stringify(selector)})]
      .filter((text) => getComputedStyle(text).visibility !== "hidden")
      .map((text) => {
        const matrix = text.getScreenCTM();

        return parseFloat(getComputedStyle(text).fontSize) * Math.hypot(matrix.a, matrix.b);
      })`
  );

const openAt1280 = Effect.fnUntraced(function* (
  files: Parameters<typeof buildAndOpen>[0],
  system: string
) {
  const { page } = yield* buildAndOpen(files, system);

  yield* Effect.promise(() =>
    page.setViewportSize({ height: 800, width: 1280 })
  );

  return page;
});

describe("text on the pipeline map at 1280×800", () => {
  it.live("keeps the Flake fixer's 9 step names at 10 px inside it", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const pipelineMapFiles = yield* pipelineMap;
        const page = yield* openAt1280(pipelineMapFiles, "flake-pipeline");

        yield* goToChapterPaused(page, "c-all");
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
          ReadonlyArray<{
            readonly nearest: number;
            readonly onOthers: ReadonlyArray<number>;
            readonly step: number;
          }>
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

describe("grown text at 1280×800", () => {
  for (const view of ["plan"] as const) {
    it.live(
      `shows the pipeline map's hop labels at 9 px or more in the ${view} view, and a hidden one while its hop is hovered`,
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const pipelineMapFiles = yield* pipelineMap;
            const page = yield* openAt1280(pipelineMapFiles, "flake-pipeline");

            yield* goToChapterPaused(page, "c-all");
            yield* showViewFitted(page, view);

            const sizes = yield* sizesOf(page, "[data-hop-label]");

            const shown = yield* attributesOf(
              page,
              "[data-hop-label]",
              "data-hop-label"
            );

            assert.isNotEmpty(sizes);

            for (const size of yield* sizesOf(page, "[data-name-tag] text")) {
              assert.isAtLeast(size, 9.95);
            }

            for (const size of sizes) {
              assert.isAtLeast(size, 8.95);
            }

            const hopIds = yield* attributesOf(page, "[data-hop]", "data-hop");
            const hidden = Arr.filter(hopIds, (hop) => !shown.includes(hop));

            // At fit the pipeline map's labels grow to reach 9 px, and some
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
        const pipelineMapFiles = yield* pipelineMap;
        const page = yield* openAt1280(pipelineMapFiles, "flake-pipeline");

        yield* goToChapterPaused(page, "c-all");

        // A packet on a hop whose label the scene hid, and that hop's label
        // from the map state.
        const hidden = yield* inPage<Array<{ hop: string; label: string }>>(
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

          const packetLabelText = yield* Effect.promise(() =>
            page.locator("[data-packet-label]").textContent()
          );

          assert.strictEqual(packetLabelText, label);
        }
      })
    )
  );
});
