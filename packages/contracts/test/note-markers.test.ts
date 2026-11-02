import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect, Option, Order } from "effect";
import { vi } from "vitest";

import {
  boxStroke,
  centreClearance,
  convexOverlap,
  distanceToPolyline,
  edgeStroke,
  gapAt,
  gapBetween,
  groundProjections,
  hopStroke,
  minScreenGap,
  noteMarkerRadius,
  noteMarkerStroke,
  placeNoteMarkers,
  rectPolygon,
  sceneOf,
  visibleGap,
} from "../src/index.ts";
import type { NoteMarkerSpot, Scene, ScreenPoint } from "../src/index.ts";
import { chaptersOf, fixture } from "./fixture-maps.ts";

vi.setConfig({ testTimeout: 15_000 });

const square = ({ sx, sy }: NoteMarkerSpot) =>
  rectPolygon({
    left: sx - noteMarkerRadius,
    top: sy - noteMarkerRadius,
    right: sx + noteMarkerRadius,
    bottom: sy + noteMarkerRadius,
  });

/** Something a ring must stay clear of, with how wide its edge is drawn. */
interface Solid {
  readonly name: string;
  readonly polygon: readonly ScreenPoint[];
  readonly stroke: number;
}

/** Everything a marker must stay clear of. */
const solids = (scene: Scene): readonly Solid[] => [
  ...Arr.map(scene.structures, ({ structure, outline }) => ({
    name: `box ${structure.id}`,
    polygon: outline,
    stroke: boxStroke,
  })),
  ...Arr.map(scene.structures, ({ structure, tag }) => ({
    name: `tag ${structure.id}`,
    polygon: rectPolygon(tag),
    stroke: edgeStroke,
  })),
  ...Arr.flatMap(scene.structures, ({ structure, chip }) =>
    chip === undefined
      ? []
      : [
          {
            name: `chip ${structure.id}`,
            polygon: rectPolygon(chip),
            stroke: edgeStroke,
          },
        ]
  ),
  ...Arr.flatMap(scene.zones, ({ zone, title }) =>
    title === undefined
      ? []
      : [{ name: `title ${zone.group.id}`, polygon: title, stroke: edgeStroke }]
  ),
  ...Arr.flatMap(scene.hops, ({ hop, label }) =>
    label === undefined
      ? []
      : [
          {
            name: `label ${hop.id}`,
            polygon: rectPolygon(label),
            stroke: edgeStroke,
          },
        ]
  ),
];

/** How far apart the edges of two strokes show, centre to centre less both half widths. */
const visibleGapBetween = (distance: number, strokes: readonly number[]) =>
  distance - Arr.reduce(strokes, 0, (sum, width) => sum + width / 2);

const edgeDistance = (polygon: readonly ScreenPoint[], spot: NoteMarkerSpot) =>
  distanceToPolyline([...polygon, ...Arr.take(polygon, 1)], spot);

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

const views = ["iso", "plan"] as const;

const maps = ["flake-pipeline", "review", "crowded"] as const;

describe("note markers", () => {
  for (const name of maps) {
    for (const view of views) {
      it.effect(
        `keep the visible gap from boxes, tags, chips, zone titles, labels and every hop's line in every chapter of ${name} in ${view}`,
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

              const placed = placeNoteMarkers(scene, {
                structures: new Set(
                  Arr.map(scene.structures, ({ structure }) => structure.id)
                ),
                hops: new Set(Arr.map(scene.hops, ({ hop }) => hop.id)),
                spots: gridSpots,
                ground: groundProjections[view],
              });

              const markers = [
                ...placed.structures.entries(),
                ...placed.hops.entries(),
                ...Arr.map(
                  placed.spots,
                  ({ spot, marker }): [string, NoteMarkerSpot] => [
                    `spot ${spot.x},${spot.y}`,
                    marker,
                  ]
                ),
              ];

              for (const [who, spot] of markers) {
                for (const solid of solids(scene)) {
                  assert.isFalse(
                    convexOverlap(square(spot), solid.polygon),
                    `${who} covers ${solid.name} in ${chapter.id}`
                  );
                  assert.isAtLeast(
                    visibleGapBetween(edgeDistance(solid.polygon, spot), [
                      noteMarkerStroke,
                      solid.stroke,
                    ]) + 1e-6,
                    visibleGap,
                    `${who} is too close to ${solid.name} in ${chapter.id}`
                  );
                }

                for (const { hop, points } of scene.hops) {
                  assert.isAtLeast(
                    visibleGapBetween(distanceToPolyline(points, spot), [
                      noteMarkerStroke,
                      hopStroke,
                    ]) + 1e-6,
                    visibleGap,
                    `${who} hugs the line of hop ${hop.id} in ${chapter.id}`
                  );
                }
              }

              for (const [a, one] of markers) {
                for (const [b, two] of markers) {
                  assert.isFalse(
                    a !== b && convexOverlap(square(one), square(two)),
                    `${a} and ${b} touch in ${chapter.id}`
                  );
                }
              }
            }
          })
      );
    }
  }

  it("counts both strokes in the clearance a line asks for", () => {
    assert.strictEqual(
      centreClearance(hopStroke, 1),
      noteMarkerRadius + noteMarkerStroke / 2 + hopStroke / 2 + gapAt(1)
    );
    assert.strictEqual(
      centreClearance(hopStroke, 100),
      noteMarkerRadius + noteMarkerStroke / 2 + hopStroke / 2 + visibleGap
    );
    assert.isAbove(
      centreClearance(boxStroke, 1),
      noteMarkerRadius + visibleGap
    );
  });

  it.effect("rests a structure's ring against it, not floating off it", () =>
    Effect.gen(function* () {
      const { data, layout } = yield* fixture("review");

      for (const view of views) {
        const scene = sceneOf({
          data,
          layout,
          revealed: new Set(Arr.map(data.structures, ({ id }) => id)),
          view,
        });

        const placed = placeNoteMarkers(scene, {
          structures: new Set(["server", "page"]),
          hops: new Set(),
          spots: [],
        });

        assert.deepStrictEqual(
          Arr.sort([...placed.structures.keys()], Order.String),
          ["page", "server"]
        );

        for (const [id, spot] of placed.structures) {
          const { outline, tag } = Option.getOrThrow(
            Arr.findFirst(
              scene.structures,
              ({ structure }) => structure.id === id
            )
          );

          const nearest = Math.min(
            edgeDistance(outline, spot),
            gapBetween(tag, [spot])
          );

          assert.isBelow(
            nearest,
            noteMarkerRadius + 6,
            `${id} floats in ${view}`
          );
        }
      }
    })
  );

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
      });

      const spot = placed.hops.get("h-save");

      const route = Option.getOrThrow(
        Arr.findFirst(scene.hops, ({ hop }) => hop.id === "h-save")
      );

      assert.isDefined(spot);
      assert.isBelow(
        distanceToPolyline(route.points, spot ?? { sx: 1e9, sy: 1e9 }),
        centreClearance(hopStroke, 1) + 8,
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

      assert.deepStrictEqual(placed.spots, [
        { spot: free, marker: groundProjections.plan.toScreen(free) },
      ]);
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

        const onBox = { x: 5, y: 1 };

        const [found] = placeNoteMarkers(scene, {
          structures: new Set(),
          hops: new Set(),
          spots: [onBox],
          ground: groundProjections.plan,
        }).spots;

        assert.isDefined(found);

        const marker = found?.marker ?? { sx: 0, sy: 0 };

        assert.notDeepEqual(marker, groundProjections.plan.toScreen(onBox));

        for (const solid of solids(scene)) {
          assert.isFalse(
            convexOverlap(square(marker), solid.polygon),
            solid.name
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
        ...Arr.map(placed.spots, ({ marker }) => marker),
      ];

      assert.strictEqual(all.length, 5);

      for (const [index, one] of all.entries()) {
        for (const two of all.slice(index + 1)) {
          assert.isFalse(convexOverlap(square(one), square(two)));
        }
      }
    })
  );
});

describe("note markers at a zoomed-out view", () => {
  /** The zooms a view settles at, from full size down to a crowded map's fit. */
  const zooms = [1, 0.5, 0.3, 0.2] as const;

  for (const view of views) {
    it.effect(
      `keep ${minScreenGap} screen pixels from every hop's line in ${view}, at the scale the view shows them`,
      () =>
        Effect.gen(function* () {
          const { data, layout } = yield* fixture("review");
          let placedHops = 0;

          for (const zoom of zooms) {
            const scene = sceneOf({
              data,
              layout,
              revealed: new Set(Arr.map(data.structures, ({ id }) => id)),
              view,
              zoom,
            });

            const placed = placeNoteMarkers(scene, {
              structures: new Set(),
              hops: new Set(Arr.map(scene.hops, ({ hop }) => hop.id)),
              spots: [],
            });

            placedHops += placed.hops.size;

            for (const [id, spot] of placed.hops) {
              for (const { hop, points } of scene.hops) {
                // The view never shows the scene smaller than its zoom, so
                // the pixels measured at `zoom` are the fewest there can be.
                const pixels =
                  visibleGapBetween(distanceToPolyline(points, spot), [
                    noteMarkerStroke,
                    hopStroke,
                  ]) * zoom;

                assert.isAtLeast(
                  pixels + 1e-6,
                  minScreenGap,
                  `the ring of ${id} is ${pixels.toFixed(2)} px from hop ${hop.id} at zoom ${zoom} in ${view}`
                );
              }
            }
          }

          assert.isAbove(placedHops, 0);
        })
    );
  }

  it("grows the gap as the view zooms out, and keeps the drawn one at full size", () => {
    assert.strictEqual(gapAt(1), 3);
    assert.strictEqual(gapAt(0.5), 6);
    assert.isAtLeast(gapAt(10), 1.5);
    assert.strictEqual(gapAt(100), 1.5);
  });
});
