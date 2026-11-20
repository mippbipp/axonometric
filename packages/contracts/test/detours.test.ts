import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect, Option, String as Str } from "effect";

import { detourOf, isDetour, routeRevealed, zonesOf } from "../src/index.ts";
import type { Layout, MapData, Placement } from "../src/index.ts";
import { chaptersOf, placedFixture } from "./fixture-maps.ts";

/** Every hop whose Plan route is a detour, as `chapter hop` lines. */
const detoursIn = (data: MapData, layout: Layout) =>
  Arr.flatMap(chaptersOf(data), (chapter) => {
    const routes = routeRevealed({ data, layout, revealed: chapter.revealed });

    return Arr.flatMap(data.hops, ({ id }) => {
      const route = routes[id];

      return route !== undefined && isDetour(route.points)
        ? [`${chapter.id} ${id}`]
        : [];
    });
  });

const spans = (a: Placement, b: Placement, axis: "x" | "y") => {
  const size = axis === "x" ? "w" : "d";

  return a[axis] < b[axis] + b[size] && b[axis] < a[axis] + a[size];
};

/** The ground between two boxes that share a row or a column of ground. */
const between = (a: Placement, b: Placement): Option.Option<Placement> => {
  if (spans(a, b, "y")) {
    const [left, right] = a.x < b.x ? [a, b] : [b, a];
    const top = Math.max(a.y, b.y);

    return Option.some({
      d: Math.min(a.y + a.d, b.y + b.d) - top,
      w: right.x - left.x - left.w,
      x: left.x + left.w,
      y: top,
    });
  }

  if (spans(a, b, "x")) {
    const [upper, lower] = a.y < b.y ? [a, b] : [b, a];
    const left = Math.max(a.x, b.x);

    return Option.some({
      d: lower.y - upper.y - upper.d,
      w: Math.min(a.x + a.w, b.x + b.w) - left,
      x: left,
      y: upper.y + upper.d,
    });
  }

  return Option.none();
};

const overlap = (a: Placement, b: Placement) =>
  spans(a, b, "x") && spans(a, b, "y");

/**
 * Pairs of groups whose zones are neighbours: they share a row or a column
 * of ground, and no other zone lies in the ground between them.
 */
const neighbourZones = (data: MapData, layout: Layout) => {
  const zones = zonesOf({ data, layout });

  return new Set(
    Arr.flatMap(zones, (a, index) =>
      Arr.flatMap(zones.slice(index + 1), (b) =>
        Option.match(between(a.box, b.box), {
          onNone: () => [],
          onSome: (gap) =>
            Arr.some(
              zones,
              (other) => other !== a && other !== b && overlap(other.box, gap)
            )
              ? []
              : [`${a.group.id} ${b.group.id}`, `${b.group.id} ${a.group.id}`],
        })
      )
    )
  );
};

describe("detours", () => {
  it.effect(
    "measure how far a route runs outside the ground between its ends",
    () =>
      Effect.sync(() => {
        const inside = [
          { x: 0, y: 0 },
          { x: 4, y: 0 },
          { x: 4, y: 3 },
        ];

        const edge = [
          { x: 0, y: 0 },
          { x: 0, y: -2 },
          { x: 6, y: -2 },
          { x: 6, y: 0 },
        ];

        const loop = [
          { x: 0, y: 0 },
          { x: 0, y: -2.5 },
          { x: 6, y: -2.5 },
          { x: 6, y: 1 },
        ];

        assert.deepStrictEqual(
          Arr.map([inside, edge, loop], (points) => [
            detourOf(points),
            isDetour(points),
          ]),
          [
            [0, false],
            [2, false],
            [2.5, true],
          ]
        );
      })
  );

  it.effect(
    "are none in any chapter of the update pipeline, placed by build",
    () =>
      Effect.gen(function* () {
        const { data, layout } = yield* placedFixture("update-pipeline");

        assert.deepStrictEqual(detoursIn(data, layout), []);
      }),
    60_000
  );

  it.effect(
    "never join structures in neighbouring zones of the update pipeline",
    () =>
      Effect.gen(function* () {
        const { data, layout } = yield* placedFixture("update-pipeline");
        const neighbours = neighbourZones(data, layout);

        const groupOf = new Map(
          Arr.map(data.structures, (s) => [s.id, s.group])
        );

        const across = Arr.filter(detoursIn(data, layout), (line) => {
          const [, id] = Str.split(" ")(line);
          const hop = Arr.findFirst(data.hops, (item) => item.id === id);

          return Option.match(hop, {
            onNone: () => false,
            onSome: ({ from, to }) =>
              neighbours.has(`${groupOf.get(from)} ${groupOf.get(to)}`),
          });
        });

        assert.deepStrictEqual(across, []);
      }),
    60_000
  );
});
