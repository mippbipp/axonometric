import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect } from "effect";
import type { Page } from "playwright";

import { crosses, drawingReport, overlap } from "./drawing-report.ts";
import type { DrawingReport } from "./drawing-report.ts";
import { pipelineMap } from "./fixtures.ts";
import { buildAndOpen, makeHome, runCli } from "./harness.ts";

/** Chapters 1, 2 and 8 of the pipeline map. */
const chapters = ["c-monday", "c-pr", "c-all"] as const;

const sizes = [
  { width: 1280, height: 800 },
  { width: 1780, height: 1020 },
] as const;

const openChapter = Effect.fnUntraced(function* (page: Page, id: string) {
  yield* Effect.promise(() =>
    page.locator(`[data-chapter-rail] button[data-chapter="${id}"]`).click()
  );
  yield* Effect.promise(() =>
    page.locator(`[data-walkthrough][data-chapter="${id}"]`).waitFor()
  );
  // Pause, so a packet's selection doesn't bring a hidden label in.
  yield* Effect.promise(() =>
    page.locator('[data-playback-controls] [data-control="pause"]').click()
  );
});

describe("the pipeline map's drawing", () => {
  it.live(
    "keeps text clear of text and boxes, and first legs off their own tags",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { page } = yield* buildAndOpen(
            yield* pipelineMap,
            "flake-pipeline"
          );

          for (const size of sizes) {
            yield* Effect.promise(() => page.setViewportSize(size));

            for (const chapter of chapters) {
              yield* openChapter(page, chapter);

              const report = yield* Effect.promise((): Promise<DrawingReport> =>
                page.evaluate(drawingReport)
              );

              const where = `${chapter} at ${size.width}×${size.height}`;

              const textClashes = Arr.flatMap(report.text, (first, index) =>
                Arr.flatMap(report.text.slice(index + 1), (second) =>
                  overlap(first.polygon, second.polygon)
                    ? [`${first.id} × ${second.id}`]
                    : []
                )
              );

              const underBoxes = Arr.flatMap(report.text, (text) =>
                Arr.flatMap(report.structures, (box) =>
                  overlap(text.polygon, box.polygon)
                    ? [`${text.id} × ${box.id}`]
                    : []
                )
              );

              const throughOwnTag = Arr.flatMap(
                report.firstLegs,
                ({ hop, from, leg }) =>
                  Arr.some(
                    report.text,
                    (tag) =>
                      tag.id === `tag:${from}` && crosses(leg, tag.polygon)
                  )
                    ? [hop]
                    : []
              );

              assert.isNotEmpty(report.text, where);
              assert.deepStrictEqual(
                textClashes,
                [],
                `text over text in ${where}`
              );
              assert.deepStrictEqual(
                underBoxes,
                [],
                `text under boxes in ${where}`
              );
              assert.deepStrictEqual(
                throughOwnTag,
                [],
                `first legs through their own tag in ${where}`
              );
            }
          }
        })
      ),
    60_000
  );
});

describe("check on the pipeline map", () => {
  it.effect(
    "reports no warnings",
    () =>
      Effect.gen(function* () {
        const home = yield* makeHome(yield* pipelineMap);

        const result = yield* runCli(home, [
          "check",
          `${home}/flake-pipeline/map`,
        ]);

        assert.strictEqual(result.exitCode, 0, result.stdout + result.stderr);
        assert.include(result.stdout, ": 0 errors, 0 warnings.");
      }),
    // check routes and lays out every chapter of a 29-hop map.
    30_000
  );
});
