import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect, Option, Order } from "effect";
import { vi } from "vitest";

import {
  gapAt,
  gapBetween,
  groundProjections,
  placeNoteMarkers,
  sceneOf,
} from "../src/index.ts";
import type {
  NoteMarkerSpot,
  Scene,
  ScreenPoint,
  ScreenRect,
} from "../src/index.ts";
import { chaptersOf, fixture } from "./fixture-maps.ts";

vi.setConfig({ testTimeout: 15_000 });

// The sizes the page draws, written out here rather than taken from the
// placer, so a change there can't move the check with it. A ring is 5 units
// across its radius with a stroke 2 wide. A box's outline is stroked 1.2
// wide, a hop's line 1.4, and the edges of tags, chips, labels and zone
// titles 1. At full size a ring keeps 1.5 units between the edges of the
// strokes, and at any zoom at least 3 screen pixels.
const ringRadius = 5;

const ringStroke = 2;

const boxStroke = 1.2;

const lineStroke = 1.4;

const edgeStroke = 1;

const fullSizeGap = 1.5;

const screenGap = 3;

/** The gap a ring keeps in a scene drawn for `zoom`, by the rule above. */
const gapFor = (zoom: number) => Math.max(fullSizeGap, screenGap / zoom);

const corners = (rect: ScreenRect): readonly ScreenPoint[] => [
  { sx: rect.left, sy: rect.top },
  { sx: rect.right, sy: rect.top },
  { sx: rect.right, sy: rect.bottom },
  { sx: rect.left, sy: rect.bottom },
];

const square = ({ sx, sy }: NoteMarkerSpot) =>
  corners({
    left: sx - ringRadius,
    top: sy - ringRadius,
    right: sx + ringRadius,
    bottom: sy + ringRadius,
  });

/** The lowest and highest of `polygon` projected onto the axis `ax, ay`. */
const projected = (polygon: readonly ScreenPoint[], ax: number, ay: number) => {
  const along = Arr.map(polygon, ({ sx, sy }) => sx * ax + sy * ay);

  return { low: Math.min(...along), high: Math.max(...along) };
};

/**
 * Whether two convex polygons share area: no edge normal of either one
 * separates them. Polygons that only touch don't.
 */
const overlap = (a: readonly ScreenPoint[], b: readonly ScreenPoint[]) =>
  Arr.every([a, b], (polygon) =>
    Arr.every(polygon, (from, index) => {
      const to = polygon[(index + 1) % polygon.length] ?? from;
      const ax = to.sy - from.sy;
      const ay = from.sx - to.sx;
      const slack = Math.hypot(ax, ay) * 1e-6;
      const one = projected(a, ax, ay);
      const two = projected(b, ax, ay);

      return one.low < two.high - slack && two.low < one.high - slack;
    })
  );

/** How far `point` is from the segment `from` to `to`. */
const segmentDistance = (
  point: ScreenPoint,
  from: ScreenPoint,
  to: ScreenPoint
) => {
  const dx = to.sx - from.sx;
  const dy = to.sy - from.sy;
  const length = dx * dx + dy * dy;

  const t =
    length === 0
      ? 0
      : Math.min(
          1,
          Math.max(
            0,
            ((point.sx - from.sx) * dx + (point.sy - from.sy) * dy) / length
          )
        );

  return Math.hypot(point.sx - from.sx - dx * t, point.sy - from.sy - dy * t);
};

/** How far `point` is from the polyline `points`. */
const lineDistance = (points: readonly ScreenPoint[], point: ScreenPoint) => {
  const legs = Arr.zip(points, Arr.drop(points, 1));

  return Math.min(
    ...Arr.map(legs, ([from, to]) => segmentDistance(point, from, to))
  );
};

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
    polygon: corners(tag),
    stroke: edgeStroke,
  })),
  ...Arr.flatMap(scene.structures, ({ structure, chip }) =>
    chip === undefined
      ? []
      : [
          {
            name: `chip ${structure.id}`,
            polygon: corners(chip),
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
            polygon: corners(label),
            stroke: edgeStroke,
          },
        ]
  ),
];

/**
 * How far apart a ring's stroke and another stroke show: from the ring's
 * centre, less its radius and half of each stroke's width.
 */
const visibleGapBetween = (distance: number, strokes: readonly number[]) =>
  distance -
  ringRadius -
  Arr.reduce(strokes, 0, (sum, width) => sum + width / 2);

const edgeDistance = (polygon: readonly ScreenPoint[], spot: NoteMarkerSpot) =>
  lineDistance([...polygon, ...Arr.take(polygon, 1)], spot);

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
                    overlap(square(spot), solid.polygon),
                    `${who} covers ${solid.name} in ${chapter.id}`
                  );
                  assert.isAtLeast(
                    visibleGapBetween(edgeDistance(solid.polygon, spot), [
                      ringStroke,
                      solid.stroke,
                    ]) + 1e-6,
                    gapFor(scene.zoom),
                    `${who} is too close to ${solid.name} in ${chapter.id}`
                  );
                }

                for (const { hop, points } of scene.hops) {
                  assert.isAtLeast(
                    visibleGapBetween(lineDistance(points, spot), [
                      ringStroke,
                      lineStroke,
                    ]) + 1e-6,
                    gapFor(scene.zoom),
                    `${who} hugs the line of hop ${hop.id} in ${chapter.id}`
                  );
                }
              }

              for (const [a, one] of markers) {
                for (const [b, two] of markers) {
                  assert.isFalse(
                    a !== b && overlap(square(one), square(two)),
                    `${a} and ${b} touch in ${chapter.id}`
                  );
                }
              }
            }
          })
      );
    }
  }

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

          assert.isBelow(nearest, ringRadius + 6, `${id} floats in ${view}`);
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

      // The ring's centre needs 5 + 1 + 0.7 + 3 = 9.7 units from the line's
      // centre at full size. Within 18 it still reads as beside the line.
      assert.isDefined(spot);
      assert.isBelow(
        lineDistance(route.points, spot ?? { sx: 1e9, sy: 1e9 }),
        18,
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
          assert.isFalse(overlap(square(marker), solid.polygon), solid.name);
        }
      })
  );
});

describe("note markers at a zoomed-out view", () => {
  /** The zooms a view settles at, from full size down to a crowded map's fit. */
  const zooms = [1, 0.5, 0.3, 0.2] as const;

  for (const view of views) {
    it.effect(
      `keep 3 screen pixels from every hop's line in ${view}, at the scale the view shows them`,
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
                  visibleGapBetween(lineDistance(points, spot), [
                    ringStroke,
                    lineStroke,
                  ]) * zoom;

                assert.isAtLeast(
                  pixels + 1e-6,
                  screenGap,
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
