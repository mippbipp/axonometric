import { tagCharWidth, textSizes } from "@axonometric/contracts";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Record as Rec } from "effect";
import type { Page } from "playwright";

import { pipelineMap } from "./fixtures.ts";
import { buildAndOpen } from "./harness.ts";

// Seam 2: the page draws text at the width the scene measured, 0.6 em a
// character, whatever fonts the machine has. The dev shell's Chromium has
// only DejaVu Sans, which is proportional, and a Linux box with no monospace
// fonts is the same; without the embedded Liberation Mono these widths would
// be DejaVu's.

const inPage = <A>(page: Page, expression: string) =>
  Effect.promise(() => page.evaluate<A>(expression));

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

describe("the page's font", () => {
  it.live(
    "draws name tags at 0.6 em a character",
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

          // The scene's own estimate, at the base size, agrees.
          assert.closeTo(tagCharWidth, textSizes.tag.font * 0.6, 0.01);
          assert.deepStrictEqual(errors, []);
        })
      ),
    60_000
  );

  it.live(
    "draws the controls and hop labels in the embedded font too",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { page } = yield* buildAndOpen(
            yield* pipelineMap,
            "flake-pipeline"
          );

          const families = yield* inPage<Record<string, string>>(
            page,
            `Object.fromEntries([
              ["body", "main"],
              ["control", "[data-control='export']"],
              ["label", "[data-hop-label]"],
              ["tag", "[data-name-tag] text"],
            ].map(([name, selector]) => [name, getComputedStyle(document.querySelector(selector)).fontFamily.split(",")[0].trim()]))`
          );

          for (const [name, family] of Rec.toEntries(families)) {
            assert.strictEqual(family, '"Liberation Mono"', name);
          }

          const loaded = yield* inPage<boolean>(
            page,
            `document.fonts.ready.then(() => document.fonts.check("12px 'Liberation Mono'"))`
          );

          assert.isTrue(loaded);
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
