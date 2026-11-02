import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect, Option } from "effect";
import { vi } from "vitest";

import {
  convexOverlap,
  distanceToPolyline,
  gapBetween,
  noteMarkerRadius,
  noteMarkerSpots,
  placeNoteMarkers,
  rectPolygon,
  sceneOf,
  spotKey,
  groundProjections,
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

                for (const { hop, points } of scene.hops) {
                  assert.isAbove(
                    distanceToPolyline(points, spot),
                    noteMarkerRadius,
                    `marker of ${id} sits on the line of hop ${hop.id} in ${chapter.id}`
                  );
                }

                // Next to its structure: close to the outline or the tag.
                const owner = Arr.findFirst(
                  scene.structures,
                  ({ structure }) => structure.id === id
                );

                const { outline, tag } = Option.getOrThrow(owner);

                const nearest = Math.min(
                  distanceToPolyline(
                    [...outline, ...Arr.take(outline, 1)],
                    spot
                  ),
                  gapBetween(tag, [spot])
                );

                assert.isBelow(
                  nearest,
                  noteMarkerRadius + 4,
                  `marker of ${id} floats ${nearest.toFixed(1)} from its structure in ${chapter.id}`
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

/** Spots over the whole ground the maps use, empty or not. */
const gridSpots = (() => {
  const found: { x: number; y: number }[] = [];

  for (let x = -2; x <= 22; x += 2.5) {
    for (let y = -2; y <= 10; y += 2) {
      found.push({ x, y });
    }
  }

  return found;
})();

describe("markers for hops and spots", () => {
  for (const name of ["flake-pipeline", "review", "crowded"]) {
    for (const view of ["iso", "plan"] as const) {
      it.effect(
        `sit clear of boxes, text and every line in every chapter of ${name} in ${view}`,
        () =>
          Effect.gen(function* () {
            const { data, layout } = yield* fixture(name);

            let hopsPlaced = 0;
            let hopsAsked = 0;
            let spotsPlaced = 0;

            for (const chapter of chaptersOf(data)) {
              const scene = sceneOf({
                data,
                layout,
                revealed: chapter.revealed,
                labelFirst: chapter.plays,
                view,
              });

              const placed = placeNoteMarkers(scene, {
                structures: new Set(),
                hops: new Set(Arr.map(scene.hops, ({ hop }) => hop.id)),
                spots: gridSpots,
                ground: groundProjections[view],
              });

              hopsAsked += scene.hops.length;
              hopsPlaced += placed.hops.size;
              spotsPlaced += placed.spots.size;

              const others = solids(scene);
              const all = [...placed.hops.entries(), ...placed.spots.entries()];

              for (const [key, spot] of all) {
                assert.isFalse(
                  Arr.some(others, (other) =>
                    convexOverlap(square(spot), other)
                  ),
                  `marker ${key} covers something in ${chapter.id}`
                );

                const own = Arr.findFirst(
                  scene.hops,
                  ({ hop }) => hop.id === key
                );

                for (const { hop, points } of scene.hops) {
                  const mine =
                    Option.isSome(own) && own.value.hop.id === hop.id;

                  assert.isAbove(
                    distanceToPolyline(points, spot),
                    noteMarkerRadius + (mine ? 0 : 1),
                    `marker ${key} sits on the line of hop ${hop.id} in ${chapter.id}`
                  );
                }
              }

              // No two markers touch.
              for (const [a, one] of all) {
                for (const [b, two] of all) {
                  if (a !== b) {
                    assert.isFalse(
                      convexOverlap(square(one), square(two)),
                      `markers ${a} and ${b} touch in ${chapter.id}`
                    );
                  }
                }
              }
            }

            // Not vacuous: most hops and some spots get a marker.
            assert.isAbove(hopsPlaced, hopsAsked * 0.6);
            assert.isAbove(spotsPlaced, 0);
          })
      );
    }
  }

  it.effect("puts a hop's marker beside that hop's own line", () =>
    Effect.gen(function* () {
      const { data, layout } = yield* fixture("review");

      const scene = sceneOf({
        data,
        layout,
        revealed: new Set(Arr.map(data.structures, ({ id }) => id)),
      });

      const placed = placeNoteMarkers(scene, {
        structures: new Set(),
        hops: new Set(["h-save"]),
        spots: [],
        ground: groundProjections.iso,
      });

      const spot = Option.getOrThrow(
        Option.fromNullishOr(placed.hops.get("h-save"))
      );

      const route = Option.getOrThrow(
        Arr.findFirst(scene.hops, ({ hop }) => hop.id === "h-save")
      );

      assert.isBelow(
        distanceToPolyline(route.points, spot),
        noteMarkerRadius + 8,
        "the marker floats away from its hop"
      );
    })
  );

  it.effect("keeps an empty spot's marker on the spot when it is free", () =>
    Effect.gen(function* () {
      const { data, layout } = yield* fixture("review");

      const scene = sceneOf({
        data,
        layout,
        revealed: new Set(Arr.map(data.structures, ({ id }) => id)),
        view: "plan",
      });

      const free = { x: 14, y: 3 };

      const placed = placeNoteMarkers(scene, {
        structures: new Set(),
        hops: new Set(),
        spots: [free],
        ground: groundProjections.plan,
      });

      const key = spotKey(free);

      assert.deepStrictEqual(
        placed.spots.get(key),
        groundProjections.plan.toScreen(free)
      );
    })
  );

  it.effect(
    "moves a spot's marker off a box it would cover, and never onto it",
    () =>
      Effect.gen(function* () {
        const { data, layout } = yield* fixture("review");

        const scene = sceneOf({
          data,
          layout,
          revealed: new Set(Arr.map(data.structures, ({ id }) => id)),
          view: "plan",
        });

        // The middle of the page structure.
        const onBox = { x: 5, y: 1 };

        const placed = placeNoteMarkers(scene, {
          structures: new Set(),
          hops: new Set(),
          spots: [onBox],
          ground: groundProjections.plan,
        });

        const spot = placed.spots.get(spotKey(onBox));

        if (spot !== undefined) {
          assert.isFalse(
            Arr.some(solids(scene), (other) =>
              convexOverlap(square(spot), other)
            )
          );
        }
      })
  );

  it.effect("places structures, hops and spots together without touching", () =>
    Effect.gen(function* () {
      const { data, layout } = yield* fixture("review");

      const scene = sceneOf({
        data,
        layout,
        revealed: new Set(Arr.map(data.structures, ({ id }) => id)),
      });

      const placed = placeNoteMarkers(scene, {
        structures: new Set(["server", "page"]),
        hops: new Set(["h-save", "h-store"]),
        spots: [{ x: 6, y: 4 }],
        ground: groundProjections.iso,
      });

      const all = [
        ...placed.structures.values(),
        ...placed.hops.values(),
        ...placed.spots.values(),
      ];

      assert.strictEqual(all.length, 5);

      for (const [index, one] of all.entries()) {
        for (const two of all.slice(index + 1)) {
          assert.isFalse(convexOverlap(square(one), square(two)));
        }
      }
    })
  );

  it.effect("agrees with noteMarkerSpots for structures alone", () =>
    Effect.gen(function* () {
      const { data, layout } = yield* fixture("review");

      const scene = sceneOf({
        data,
        layout,
        revealed: new Set(Arr.map(data.structures, ({ id }) => id)),
      });

      const ids = new Set(["server", "page"]);

      assert.deepStrictEqual(
        placeNoteMarkers(scene, {
          structures: ids,
          hops: new Set(),
          spots: [],
          ground: groundProjections.iso,
        }).structures,
        noteMarkerSpots(scene, ids)
      );
    })
  );
});
