import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect } from "effect";

import {
  chapterStopsOf,
  fitPadding,
  fittedViewOf,
  maxFitZoom,
  sceneClashes,
  sceneOf,
  textSizes,
  textZoomOf,
} from "../src/index.ts";
import type { CanvasSize, ChapterStop, Scene, View } from "../src/index.ts";
import { fixture } from "./fixture-maps.ts";

const canvas: CanvasSize = { height: 800, width: 1280 };

const stopsOf = (name: string) =>
  Effect.gen(function* () {
    const { data, layout } = yield* fixture(name);
    const state = { data, layout, system: name };

    return { state, stops: chapterStopsOf(state) };
  });

/** The clashes that put text over text or over a box. */
const textClashes = (scene: Scene) =>
  Arr.map(
    Arr.filter(
      sceneClashes(scene),
      ({ parts }) => !Arr.some(parts, ({ kind }) => kind === "route")
    ),
    ({ between }) => Arr.join(between, " × ")
  );

const last = (stops: Arr.NonEmptyReadonlyArray<ChapterStop>) =>
  Arr.lastNonEmpty(stops);

describe("zoom to fit on the pipeline map at 1280×800", () => {
  for (const view of ["iso", "plan"] as const satisfies ReadonlyArray<View>) {
    it.effect(`draws readable text at fit in the ${view} view`, () =>
      Effect.gen(function* () {
        const { state, stops } = yield* stopsOf("flake-pipeline");

        const { camera, scene } = fittedViewOf({
          chapter: last(stops),
          size: canvas,
          state,
          view,
        });

        assert.lengthOf(scene.structures, last(stops).revealed.size);

        // Text draws at its font size times the growth, through the camera.
        assert.isAtLeast(
          textSizes.tag.font * scene.growth.tag * camera.zoom,
          textSizes.tag.least - 0.05
        );

        const labels = Arr.filter(
          scene.hops,
          ({ label }) => label !== undefined
        );

        assert.isNotEmpty(labels);
        // At fit the pipeline map has more hops than readable labels.
        assert.isBelow(labels.length, scene.hops.length);

        for (const _ of labels) {
          assert.isAtLeast(
            textSizes.label.font * scene.growth.label * camera.zoom,
            textSizes.label.least - 0.05
          );
        }

        for (const { chip } of scene.structures) {
          if (chip !== undefined) {
            assert.isAtLeast(
              textSizes.chip.font * scene.growth.chip * camera.zoom,
              textSizes.chip.least - 0.05
            );
          }
        }
      })
    );

    it.effect(`keeps text clear of text and boxes in the ${view} view`, () =>
      Effect.gen(function* () {
        const { state, stops } = yield* stopsOf("flake-pipeline");

        for (const stop of stops) {
          const { scene, textZoom } = fittedViewOf({
            chapter: stop,
            size: canvas,
            state,
            view,
          });

          assert.deepStrictEqual(textClashes(scene), [], `${stop.id} at fit`);
          assert.strictEqual(scene.zoom, textZoom);

          const atBaseSize = sceneOf({
            data: state.data,
            labelFirst: stop.plays,
            layout: state.layout,
            revealed: stop.revealed,
            view,
          });

          assert.deepStrictEqual(
            textClashes(atBaseSize),
            [],
            `${stop.id} at base size`
          );
        }
      })
    );

    it.effect(`keeps everything inside the canvas in the ${view} view`, () =>
      Effect.gen(function* () {
        const { state, stops } = yield* stopsOf("flake-pipeline");

        const { camera, scene } = fittedViewOf({
          chapter: last(stops),
          size: canvas,
          state,
          view,
        });

        const boxes = [
          ...Arr.map(scene.structures, ({ bounds }) => bounds),
          ...Arr.map(scene.structures, ({ tag }) => tag),
          ...Arr.map(scene.zones, ({ bounds }) => bounds),
          ...Arr.flatMap(scene.hops, ({ label }) =>
            label === undefined ? [] : [label]
          ),
        ];

        for (const box of boxes) {
          assert.isAtLeast(box.left * camera.zoom + camera.x, -0.5);
          assert.isAtLeast(box.top * camera.zoom + camera.y, -0.5);
          assert.isAtMost(
            box.right * camera.zoom + camera.x,
            canvas.width + 0.5
          );
          assert.isAtMost(
            box.bottom * camera.zoom + camera.y,
            canvas.height + 0.5
          );
        }
      })
    );
  }

  it.effect(
    "zooms no further in than the cap on a chapter of one structure",
    () =>
      Effect.gen(function* () {
        const { state, stops } = yield* stopsOf("flake-pipeline");
        const ids = [...last(stops).revealed];

        const { camera, textZoom } = fittedViewOf({
          chapter: { plays: [], revealed: new Set(ids.slice(0, 1)) },
          size: canvas,
          state,
          view: "iso",
        });

        assert.strictEqual(camera.zoom, maxFitZoom);
        assert.strictEqual(textZoom, textZoomOf(camera.zoom));
        assert.isAtLeast(camera.x, fitPadding);
      })
  );

  it.effect(
    "fits only the structures in fitTo, and the hops between them",
    () =>
      Effect.gen(function* () {
        const { state, stops } = yield* stopsOf("flake-pipeline");
        const chapter = last(stops);
        const pair = [...chapter.revealed].slice(0, 2);

        const everything = fittedViewOf({
          chapter,
          size: canvas,
          state,
          view: "iso",
        });

        const some = fittedViewOf({
          chapter,
          fitTo: new Set(pair),
          size: canvas,
          state,
          view: "iso",
        });

        assert.isAbove(some.camera.zoom, everything.camera.zoom);
      })
  );

  it.effect("fits nothing when fitTo is empty", () =>
    Effect.gen(function* () {
      const { state, stops } = yield* stopsOf("flake-pipeline");

      const { camera } = fittedViewOf({
        chapter: last(stops),
        fitTo: new Set(),
        size: canvas,
        state,
        view: "iso",
      });

      assert.strictEqual(camera.zoom, maxFitZoom);
    })
  );
});
