import {
  chapterStopsOf,
  defaultFlowChoice,
  svgRequestOf,
} from "@axonometric/contracts";
import type { View } from "@axonometric/contracts";
import { svgFileOf } from "@axonometric/drawing";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Path } from "effect";

import { svgRequestOfExport } from "../src/export.ts";
import { pipelineMap } from "./fixtures.ts";
import { makeHome, mapIn, pageState, runCli } from "./harness.ts";

// The page and `export` share svgRequestOf, so only the inputs each fills in can drift apart. This runs in Node, where a browser export per case was slow.

describe("the SVG export request", () => {
  it.live(
    "is the same from the page and from export for the pipeline map's last chapter, in both views",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const path = yield* Path.Path;
          const fs = yield* FileSystem.FileSystem;
          const files = yield* pipelineMap;
          const home = yield* makeHome(files);
          const { home: map, pageFile } = mapIn(home, "flake-pipeline");
          const built = yield* runCli(home, ["build", map]);

          assert.strictEqual(built.exitCode, 0, built.stderr);

          const page = yield* fs.readFileString(pageFile);
          const state = yield* pageState(page);
          const stops = chapterStopsOf(state);
          const index = stops.length - 1;
          const stop = stops[index] ?? stops[0];

          const choice = defaultFlowChoice({
            data: state.data,
            isLast: true,
            stop,
          });

          for (const view of [
            "iso",
            "plan",
          ] as const satisfies ReadonlyArray<View>) {
            const fromPage = svgRequestOf({
              background: "paper",
              chapter: index,
              choice,
              hovered: null,
              pinned: null,
              state,
              theme: "light",
              view,
            });

            const fromExport = svgRequestOfExport({
              background: "paper",
              chapter: index,
              choice,
              state,
              view,
            });

            assert.deepStrictEqual(fromExport, fromPage, `${view} request`);

            const target = path.join(home, `${view}.svg`);

            const exported = yield* runCli(home, [
              "export",
              map,
              "--view",
              view,
              "--output",
              target,
            ]);

            assert.strictEqual(exported.exitCode, 0, exported.stderr);
            assert.isTrue(
              svgFileOf(fromPage).text === (yield* fs.readFileString(target)),
              `${view}: the CLI's SVG differs from the page's`
            );
          }
        }).pipe(Effect.provide(NodeServices.layer))
      ),
    60_000
  );
});
