import { tagCharWidth } from "@axonometric/contracts";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import type { Page } from "playwright";

import { inPage } from "./browser.ts";
import { pipelineMap } from "./fixtures.ts";
import { buildAndOpen } from "./harness.ts";

// Seam 2: the page draws text at the width the scene measured, 0.6 em a
// character, whatever fonts the machine has. The dev shell's Chromium has
// only DejaVu Sans, which is proportional, and a Linux box with no monospace
// fonts is the same; without the embedded Liberation Mono these widths would
// be DejaVu's.

interface TagWidth {
  readonly id: string;
  readonly text: string;
  readonly width: number;
  readonly size: number;
}

/**
 * Each name tag's text, its advance width and its font size. The advance is
 * what the scene models; `getBBox` would add the ink's overshoot.
 */
const nameTags = (page: Page) =>
  inPage<readonly TagWidth[]>(
    page,
    `[...document.querySelectorAll("[data-map-layer] [data-name-tag] text")].map((text) => ({
      id: text.parentElement.dataset.nameTag,
      text: text.textContent,
      width: text.getComputedTextLength(),
      size: parseFloat(getComputedStyle(text).fontSize),
    }))`
  );

/**
 * The Export button's text and every hop label's, with their advance widths
 * and font sizes. The button is HTML, so its text is measured with a range;
 * a label is SVG text, measured as the tags are.
 */
const textWidths = (page: Page) =>
  inPage<readonly TagWidth[]>(
    page,
    `(() => {
      const control = document.querySelector("[data-control='export']");
      const range = document.createRange();
      range.selectNodeContents(control);
      return [
        {
          id: "control:export",
          text: control.textContent.trim(),
          width: range.getBoundingClientRect().width,
          size: parseFloat(getComputedStyle(control).fontSize),
        },
        ...[...document.querySelectorAll("[data-map-layer] [data-hop-label]")]
          .filter((label) => getComputedStyle(label).visibility !== "hidden")
          .map((label) => ({
            id: "label:" + label.dataset.hopLabel,
            text: label.textContent,
            width: label.getComputedTextLength(),
            size: parseFloat(getComputedStyle(label).fontSize),
          })),
      ];
    })()`
  );

describe("the page's font", () => {
  it.live(
    "draws name tags, hop labels and controls at 0.6 em a character",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { page, errors } = yield* buildAndOpen(
            yield* pipelineMap,
            "flake-pipeline"
          );

          // The last chapter shows every structure.
          yield* Effect.promise(() =>
            page
              .locator('[data-chapter-rail] button[data-chapter="c-all"]')
              .click()
          );
          yield* Effect.promise(() =>
            page.evaluate("document.fonts.ready.then(() => undefined)")
          );

          const tags = yield* nameTags(page);

          assert.lengthOf(tags, 15);

          for (const tag of tags) {
            const expected = tag.text.length * 0.6 * tag.size;

            // Within a pixel, or half a percent on a long tag at a large
            // size: Chromium rounds a glyph's advance at fractional sizes,
            // so 0.5972 em shows where the font says 0.6001. DejaVu Sans is
            // off by tens of pixels.
            assert.closeTo(
              tag.width,
              expected,
              Math.max(1, expected * 0.005),
              `${tag.id} "${tag.text}"`
            );
          }

          // The Export button is HTML text in the same font, so it measures
          // 0.6 em a character too. HTML rounds each advance to a whole pixel
          // at small sizes, so 7.2 px a character shows as 7: a quarter of a
          // pixel a character allows that, and DejaVu Sans is off by more.
          const [control] = yield* textWidths(page);

          assert.isDefined(control);

          if (control !== undefined) {
            assert.closeTo(
              control.width,
              control.text.length * 0.6 * control.size,
              Math.max(1, control.text.length * 0.25),
              `${control.id} "${control.text}"`
            );
          }

          // Hop labels are SVG text like the name tags, so they measure
          // 0.6 em a character too, at any zoom. Without geometric
          // precision Chromium rounds each advance to a whole screen pixel:
          // a 9 px label drew at 5 px a character, narrower than the scene
          // measured, and a 9.25 px one at 6, wider.
          const checkLabels = (at: string) =>
            Effect.gen(function* () {
              const [, ...shown] = yield* textWidths(page);

              assert.isAtLeast(shown.length, 2, at);

              for (const label of shown) {
                const expected = label.text.length * 0.6 * label.size;

                assert.closeTo(
                  label.width,
                  expected,
                  Math.max(1, expected * 0.005),
                  `${label.id} "${label.text}" ${at}`
                );
              }
            });

          yield* checkLabels("at fit");

          // Zoom in until a label is 9.25 px on screen. The wheel zooms by
          // e^(0.0015 a pixel); the wait checks the size it reached.
          const box = yield* Effect.promise(() =>
            page.locator("svg[data-scale]").boundingBox()
          );

          const onScreen = yield* inPage<number>(
            page,
            `(() => {
              const label = document.querySelector("[data-map-layer] [data-hop-label]");
              return parseFloat(getComputedStyle(label).fontSize) * label.getScreenCTM().a;
            })()`
          );

          assert.isNotNull(box);

          if (box !== null) {
            yield* Effect.promise(() =>
              page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
            );
          }

          yield* Effect.promise(() =>
            page.mouse.wheel(0, -Math.log(9.25 / onScreen) / 0.0015)
          );
          yield* Effect.promise(() =>
            page.waitForFunction(
              `(() => {
                const label = document.querySelector("[data-map-layer] [data-hop-label]");
                return Math.abs(parseFloat(getComputedStyle(label).fontSize) * label.getScreenCTM().a - 9.25) < 0.05;
              })()`,
              undefined,
              { timeout: 5000 }
            )
          );
          yield* checkLabels("at 9.25 px on screen");

          // Name tags too, at whatever size this zoom draws them.
          for (const tag of yield* nameTags(page)) {
            const expected = tag.text.length * 0.6 * tag.size;

            assert.closeTo(
              tag.width,
              expected,
              Math.max(1, expected * 0.005),
              `${tag.id} "${tag.text}" zoomed in`
            );
          }

          // The scene's own estimate of a tag's character agrees with what
          // the page draws: 0.6 em at the 12 px base size is 7.2 px.
          assert.closeTo(tagCharWidth, 7.2, 0.01);
          assert.deepStrictEqual(errors, []);
        })
      ),
    60_000
  );

  it.live(
    "draws every character it embeds, and the ones the editor's text uses, at 0.6 em",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { page } = yield* buildAndOpen(
            yield* pipelineMap,
            "flake-pipeline"
          );

          // Basic Latin, Latin-1 Supplement without the soft hyphen (which is
          // zero width), Latin Extended-A, the 40 box-drawing characters
          // Liberation Mono has (the single and double lines and their
          // corners and joins, the ones file layouts use), then each other
          // character the editor's strings use that it has. Characters it
          // lacks (the other box-drawing characters, ‖ ↶ ↷ ▸ ◂ ☐ ☑) use the
          // system's fonts, at whatever width those have.
          const odd = yield* inPage<readonly string[]>(
            page,
            `(async () => {
              await document.fonts.load("20px 'Liberation Mono'", "a");
              const canvas = document.createElement("canvas").getContext("2d");
              canvas.font = "20px 'Liberation Mono'";
              const ranges = [[0x20, 0x7e], [0xa0, 0xac], [0xae, 0xff], [0x100, 0x17f], [0x2550, 0x256c]];
              const singles = [..."·×–…›←↑→↓−²─│┌┐└┘├┤┬┴┼"].map((c) => c.codePointAt(0));
              const codes = [...ranges.flatMap(([from, to]) => Array.from({ length: to - from + 1 }, (_, i) => from + i)), ...singles];
              return codes.flatMap((code) => {
                const width = canvas.measureText(String.fromCodePoint(code)).width;
                return Math.abs(width - 12) > 0.05 ? [code.toString(16) + ":" + width] : [];
              });
            })()`
          );

          assert.deepStrictEqual(odd, []);
        })
      ),
    60_000
  );
});
