import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Path } from "effect";
import type { Page } from "playwright";

import { click, openPage } from "./browser.ts";
import { crowdedMap, pipelineMap } from "./fixtures.ts";
import { makeHome, runCli, mapIn } from "./harness.ts";
import { decodePng } from "./png.ts";

// Seam 1: `export --format svg` writes the SVG the page's Export menu saves.
// Both call `svgFileOf`, so they should be byte-equal, and a difference is a
// bug. What can differ is what each feeds it: the page's embedded state and
// the files on disk, the theme and the chapter. The flake pipeline has every
// kind of part, so its first and last chapters, and one that fades what it
// doesn't play, in both views stand for the rest. The drawing itself is tested in shapes, pipeline-drawing and
// routes-drawn. The tests open the built page in Chromium.

const decoder = new TextDecoder();

/** Opens the Export menu, picks `item`, and returns the file it saved. */
const exportFile = Effect.fnUntraced(function* (page: Page, item: string) {
  yield* click(page, '[data-control="export"]');

  const [download] = yield* Effect.promise(() =>
    Promise.all([
      page.waitForEvent("download"),
      page.locator(`[data-export-item="${item}"]`).click(),
    ])
  );

  const file = yield* Effect.promise(() => download.path());
  const fs = yield* FileSystem.FileSystem;

  return yield* fs.readFile(file);
});

/** The flake pipeline's chapters to compare, with their numbers from 1. */
const chapters: ReadonlyArray<readonly [id: string, number: number]> = [
  ["c-monday", 1],
  // Plays one of the two hops it draws, so the other one fades.
  ["c-pr", 2],
  ["c-all", 8],
];

/** The size in pixels an SVG file says it is. */
const sizeOf = (text: string) => {
  const header =
    /<svg[^>]* width="(?<width>\d+)" height="(?<height>\d+)"/u.exec(
      text
    )?.groups;

  return { height: Number(header?.height), width: Number(header?.width) };
};

describe("export --format svg", () => {
  it.live(
    "equals the page's SVG for the flake pipeline, in both views and three of its chapters",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const path = yield* Path.Path;
          const fs = yield* FileSystem.FileSystem;
          const pipelineMapFiles = yield* pipelineMap;
          const home = yield* makeHome(pipelineMapFiles);
          const map = mapIn(home, "flake-pipeline").home;
          const built = yield* runCli(home, ["build", map]);

          assert.strictEqual(built.exitCode, 0, built.stderr);

          const { page } = yield* openPage(
            mapIn(home, "flake-pipeline").pageFile
          );

          yield* Effect.promise(() =>
            page.setViewportSize({ height: 800, width: 1280 })
          );

          for (const view of ["iso", "plan"] as const) {
            yield* click(page, `[data-view-toggle] [data-view="${view}"]`);

            for (const [id, number] of chapters) {
              yield* click(
                page,
                `[data-chapter-rail] button[data-chapter="${id}"]`
              );
              yield* Effect.promise(() =>
                page
                  .locator(
                    `[data-walkthrough][data-chapter="${id}"][data-view="${view}"]`
                  )
                  .waitFor()
              );

              const target = path.join(home, "out", `${view}-${number}.svg`);

              const exported = yield* runCli(home, [
                "export",
                map,
                "--format",
                "svg",
                "--view",
                view,
                "--chapter",
                String(number),
                "--output",
                target,
              ]);

              assert.strictEqual(exported.exitCode, 0, exported.stderr);

              const exportedSvg = yield* exportFile(page, "svg");
              const fromPage = decoder.decode(exportedSvg);
              const fromCli = yield* fs.readFileString(target);

              assert.isTrue(
                fromPage === fromCli,
                `${view} chapter ${number}: the CLI's SVG differs from the page's`
              );
              assert.include(
                fromCli,
                `flake-pipeline-${view}-chapter-${number}-title`
              );
            }
          }
        }).pipe(Effect.provide(NodeServices.layer))
      ),
    120_000
  );

  it.live(
    "marks the hops and structures a chapter fades",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const path = yield* Path.Path;
          const fs = yield* FileSystem.FileSystem;
          const pipelineMapFiles = yield* pipelineMap;
          const home = yield* makeHome(pipelineMapFiles);
          const map = mapIn(home, "flake-pipeline").home;

          const target = path.join(home, "faded.svg");

          const exported = yield* runCli(home, [
            "export",
            map,
            "--chapter",
            "c-pr",
            "-o",
            target,
          ]);

          assert.strictEqual(exported.exitCode, 0, exported.stderr);

          const fromCli = yield* fs.readFileString(target);
          const prefix = "flake-pipeline-iso-chapter-2";

          // Chapter 2 reveals updater, main, upstream and pr, and plays
          // h-updater-pr. h-main-updater and h-upstream-updater are drawn
          // but not played.
          const partOf = (kind: string, id: string) => {
            const tag = new RegExp(
              `<g id="${prefix}-${kind}-${id}"[^>]*>`,
              "u"
            ).exec(fromCli)?.[0];

            return {
              faded: /data-faded="(?<value>[^"]*)"/u.exec(tag ?? "")?.groups
                ?.value,
              opacity: /\sopacity="(?<value>[^"]*)"/u.exec(tag ?? "")?.groups
                ?.value,
            };
          };

          assert.deepInclude(partOf("hop", "h-updater-pr"), {
            faded: "false",
            opacity: undefined,
          });

          for (const hop of ["h-main-updater", "h-upstream-updater"]) {
            assert.deepInclude(partOf("hop", hop), {
              faded: "true",
              opacity: "0.25",
            });
          }

          for (const id of ["updater", "pr"]) {
            assert.deepInclude(partOf("structure", id), {
              faded: "false",
              opacity: undefined,
            });
          }

          for (const id of ["main", "upstream"]) {
            assert.deepInclude(partOf("structure", id), {
              faded: "true",
              opacity: "0.5",
            });
          }
        }).pipe(Effect.provide(NodeServices.layer))
      ),
    120_000
  );

  it.live(
    "the CLI's SVG is the page's on white too",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const path = yield* Path.Path;
          const fs = yield* FileSystem.FileSystem;
          const crowdedMapFiles = yield* crowdedMap;
          const home = yield* makeHome(crowdedMapFiles);
          const map = mapIn(home, "crowded").home;

          assert.strictEqual((yield* runCli(home, ["build", map])).exitCode, 0);

          const { page } = yield* openPage(mapIn(home, "crowded").pageFile);

          yield* click(page, '[data-control="export"]');
          yield* click(page, '[data-export-item="background"]');
          yield* Effect.promise(() => page.keyboard.press("Escape"));

          const target = path.join(home, "white.svg");

          yield* runCli(home, [
            "export",
            map,
            "--format",
            "svg",
            "--chapter",
            "2",
            "--background",
            "white",
            "-o",
            target,
          ]);

          const firstChapterSvg = yield* exportFile(page, "svg");
          const fromPage = decoder.decode(firstChapterSvg);

          // The page opens on chapter 1, so compare the same chapter.
          yield* click(
            page,
            '[data-chapter-rail] button[data-chapter="c-all"]'
          );

          const lastChapterSvg = yield* exportFile(page, "svg");
          const lastFromPage = decoder.decode(lastChapterSvg);
          const fromCli = yield* fs.readFileString(target);

          assert.isFalse(fromPage === fromCli);
          assert.isTrue(lastFromPage === fromCli);
          assert.include(fromCli, 'fill="#ffffff"');
        }).pipe(Effect.provide(NodeServices.layer))
      ),
    120_000
  );
});

/**
 * The share of pixels that differ by more than a few levels in any channel,
 * between two PNGs of the same size.
 */
const differingShare = (
  a: { readonly pixels: Uint8Array },
  b: { readonly pixels: Uint8Array }
) => {
  let differing = 0;

  for (let at = 0; at < a.pixels.length; at += 4) {
    const gap = Math.max(
      Math.abs((a.pixels[at] ?? 0) - (b.pixels[at] ?? 0)),
      Math.abs((a.pixels[at + 1] ?? 0) - (b.pixels[at + 1] ?? 0)),
      Math.abs((a.pixels[at + 2] ?? 0) - (b.pixels[at + 2] ?? 0))
    );

    if (gap > 48) {
      differing += 1;
    }
  }

  return differing / (a.pixels.length / 4);
};

describe("export --format png", () => {
  it.live(
    "is near-identical to the page's PNG for the pipeline map's Iso chapter 1",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const path = yield* Path.Path;
          const fs = yield* FileSystem.FileSystem;
          const pipelineMapFiles = yield* pipelineMap;
          const home = yield* makeHome(pipelineMapFiles);
          const map = mapIn(home, "flake-pipeline").home;

          assert.strictEqual((yield* runCli(home, ["build", map])).exitCode, 0);

          const { page } = yield* openPage(
            mapIn(home, "flake-pipeline").pageFile
          );

          yield* Effect.promise(() =>
            page.setViewportSize({ height: 800, width: 1280 })
          );

          const target = path.join(home, "cli.png");

          const exported = yield* runCli(home, [
            "export",
            map,
            "--format",
            "png",
            "--chapter",
            "1",
            "-o",
            target,
          ]);

          assert.strictEqual(exported.exitCode, 0, exported.stderr);

          const exportedPng = yield* exportFile(page, "png");
          // The page's PNG is the browser drawing the same SVG, with the
          // embedded font; the CLI's is resvg drawing it with the TTF.
          const fromPage = yield* decodePng(exportedPng);
          const cliBytes = yield* fs.readFile(target);
          const fromCli = yield* decodePng(cliBytes);

          assert.deepStrictEqual(
            { height: fromPage.height, width: fromPage.width },
            { height: fromCli.height, width: fromCli.width }
          );

          const share = differingShare(fromPage, fromCli);

          assert.isBelow(
            share,
            0.01,
            `${(share * 100).toFixed(3)}% of pixels differ`
          );
        }).pipe(Effect.provide(NodeServices.layer))
      ),
    120_000
  );

  it.effect(
    "is twice the SVG's size, on paper or on white",
    () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const fs = yield* FileSystem.FileSystem;
        const crowdedMapFiles = yield* crowdedMap;
        const home = yield* makeHome(crowdedMapFiles);
        const map = mapIn(home, "crowded").home;

        const corner = Effect.fnUntraced(function* (background: string) {
          const svg = path.join(home, `${background}.svg`);
          const png = path.join(home, `${background}.png`);

          const args = [
            "export",
            map,
            "--view",
            "plan",
            "--background",
            background,
          ];

          const drawn = yield* runCli(home, [
            ...args,
            "--format",
            "svg",
            "-o",
            svg,
          ]);

          const rasterised = yield* runCli(home, [
            ...args,
            "--format",
            "png",
            "-o",
            png,
          ]);

          assert.strictEqual(drawn.exitCode, 0, drawn.stderr);
          assert.strictEqual(rasterised.exitCode, 0, rasterised.stderr);

          const svgText = yield* fs.readFileString(svg);
          const size = sizeOf(svgText);
          const pngBytes = yield* fs.readFile(png);
          const image = yield* decodePng(pngBytes);

          assert.deepStrictEqual(
            { height: image.height, width: image.width },
            { height: size.height * 2, width: size.width * 2 }
          );

          return image.pixel(2, 2);
        });

        const paperCorner = yield* corner("paper");
        assert.deepStrictEqual(paperCorner, [230, 223, 190, 255]);
        const whiteCorner = yield* corner("white");
        assert.deepStrictEqual(whiteCorner, [255, 255, 255, 255]);
      }).pipe(Effect.provide(NodeServices.layer)),
    120_000
  );
});
