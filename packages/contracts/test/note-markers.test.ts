import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect } from "effect";
import { vi } from "vitest";

import {
  convexOverlap,
  noteMarkerRadius,
  noteMarkerSpots,
  rectPolygon,
  sceneOf,
} from "../src/index.ts";
import type { Scene } from "../src/index.ts";
import { chaptersOf, fixture } from "./fixture-maps.ts";

vi.setConfig({ testTimeout: 15_000 });

const square = ({ sx, sy }: { readonly sx: number; readonly sy: number }) =>
  rectPolygon({
    left: sx - noteMarkerRadius,
    top: sy - noteMarkerRadius,
    right: sx + noteMarkerRadius,
    bottom: sy + noteMarkerRadius,
  });

/** Everything a marker must stay clear of. */
const solids = (scene: Scene) => [
  ...Arr.map(scene.structures, ({ outline }) => outline),
  ...Arr.map(scene.structures, ({ tag }) => rectPolygon(tag)),
  ...Arr.flatMap(scene.structures, ({ chip }) =>
    chip === undefined ? [] : [rectPolygon(chip)]
  ),
  ...Arr.flatMap(scene.zones, ({ title }) =>
    title === undefined ? [] : [title]
  ),
  ...Arr.flatMap(scene.hops, ({ label }) =>
    label === undefined ? [] : [rectPolygon(label)]
  ),
];

describe("note markers", () => {
  for (const name of ["flake-pipeline", "review", "crowded"]) {
    for (const view of ["iso", "plan"] as const) {
      it.effect(
        `sit clear of boxes, name tags, chips, zone titles and labels in every chapter of ${name} in ${view}`,
        () =>
          Effect.gen(function* () {
            const { data, layout } = yield* fixture(name);

            for (const chapter of chaptersOf(data)) {
              const scene = sceneOf({
                data,
                layout,
                revealed: chapter.revealed,
                labelFirst: chapter.plays,
                view,
              });

              const ids = new Set(
                Arr.map(scene.structures, ({ structure }) => structure.id)
              );

              const spots = noteMarkerSpots(scene, ids);
              const others = solids(scene);

              for (const [id, spot] of spots) {
                assert.isFalse(
                  Arr.some(others, (other) =>
                    convexOverlap(square(spot), other)
                  ),
                  `marker of ${id} covers something in ${chapter.id}`
                );
              }
            }
          })
      );
    }
  }

  it.effect("places only the structures it is asked for, and none twice", () =>
    Effect.gen(function* () {
      const { data, layout } = yield* fixture("review");

      const scene = sceneOf({
        data,
        layout,
        revealed: new Set(Arr.map(data.structures, ({ id }) => id)),
      });

      const spots = noteMarkerSpots(scene, new Set(["server"]));

      assert.deepStrictEqual([...spots.keys()], ["server"]);
    })
  );
});
