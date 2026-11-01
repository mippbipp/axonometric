import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect, Record as Rec, String as Str } from "effect";

import { checkLayout, routeCap, routeHops, routeLength } from "../src/index.ts";
import type {
  GridPoint,
  Hop,
  HopRoute,
  Layout,
  MapData,
  Placement,
  Structure,
} from "../src/index.ts";
import { facingEdges } from "./route-geometry.ts";

const structure = (id: string): Structure => ({
  id,
  code: "S",
  name: id,
  shape: "box",
  group: "main",
  status: "live",
  oneLiner: "One line.",
  whatItDoes: "Does.",
  howItsBuilt: "Built.",
});

const hop = (from: string, to: string, id = `${from}-${to}`): Hop => ({
  id,
  from,
  to,
  label: "calls",
});

const at = (x: number, y: number): Placement => ({ x, y, w: 2, d: 2 });

const sized = (x: number, y: number, size: { w: number; d: number }) => ({
  x,
  y,
  ...size,
});

interface RoutedMap {
  readonly data: MapData;
  readonly layout: Layout;
}

const mapOf = (
  placements: Readonly<Record<string, Placement>>,
  hops: readonly Hop[],
  routes: NonNullable<Layout["routes"]> = {}
): RoutedMap => ({
  data: {
    format: 1,
    revision: 0,
    overview: { title: "Map", summary: "A map." },
    groups: [{ id: "main", title: "Main" }],
    structures: Arr.map(Rec.keys(placements), structure),
    hops,
    flows: [],
    chapters: [],
  },
  layout: {
    format: 1,
    revision: 0,
    structures: placements,
    routes,
  },
});

const routeOf = (
  routes: Readonly<Record<string, HopRoute>>,
  id: string
): HopRoute => {
  const route = routes[id];

  assert.isDefined(route, `${id} has no route`);

  return route;
};

const legsOf = (points: readonly GridPoint[]) =>
  Arr.flatMap(points, (start, index) => {
    const end = points[index + 1];

    return end === undefined ? [] : [{ start, end }];
  });

/** Every half-unit step a route takes, as an order-free key. */
const stepsOf = (points: readonly GridPoint[]) =>
  Arr.flatMap(legsOf(points), ({ start, end }) => {
    const count = Math.abs(end.x - start.x + end.y - start.y) * 2;
    const dx = Math.sign(end.x - start.x) / 2;
    const dy = Math.sign(end.y - start.y) / 2;

    return Arr.map(Arr.range(0, count - 1), (step) => {
      const a = { x: start.x + dx * step, y: start.y + dy * step };
      const b = { x: a.x + dx, y: a.y + dy };
      const low = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) };
      const high = { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y) };

      return `${low.x},${low.y}-${high.x},${high.y}`;
    });
  });

/** Whether a leg runs through the inside of a footprint. */
const legCrosses = (
  { start, end }: { readonly start: GridPoint; readonly end: GridPoint },
  box: Placement
) => {
  const left = Math.min(start.x, end.x);
  const right = Math.max(start.x, end.x);
  const top = Math.min(start.y, end.y);
  const bottom = Math.max(start.y, end.y);

  return start.y === end.y
    ? start.y > box.y &&
        start.y < box.y + box.d &&
        left < box.x + box.w &&
        right > box.x
    : start.x > box.x &&
        start.x < box.x + box.w &&
        top < box.y + box.d &&
        bottom > box.y;
};

const onEdge = (point: GridPoint, box: Placement) => {
  const insideX = point.x >= box.x && point.x <= box.x + box.w;
  const insideY = point.y >= box.y && point.y <= box.y + box.d;
  const onX = point.x === box.x || point.x === box.x + box.w;
  const onY = point.y === box.y || point.y === box.y + box.d;

  return (onX && insideY) || (onY && insideX);
};

/** Which edge of a footprint a point sits on: +x, +y, -x or -y. */
/**
 * Which edge of a footprint a route's end leaves by, from the end and the
 * next point along the route: +x, +y, -x or -y. A route may leave a corner,
 * which sits on two edges, so the leg's direction decides.
 */
const edgeOf = (point: GridPoint, next: GridPoint) => {
  if (next.x !== point.x) {
    return next.x > point.x ? 0 : 2;
  }

  return next.y > point.y ? 1 : 3;
};

/** A between two connected structures, with M in the way. */
const blocked = mapOf({ a: at(0, 0), m: at(4, 0), b: at(8, 0) }, [
  hop("a", "b"),
]);

describe("routing", () => {
  it.effect("goes around a footprint in the way", () =>
    Effect.sync(() => {
      const route = routeOf(routeHops(blocked.data, blocked.layout), "a-b");

      for (const leg of legsOf(route.points)) {
        assert.isFalse(legCrosses(leg, at(4, 0)), "runs under m");
      }

      assert.deepStrictEqual(route.crosses, []);
    })
  );

  it.effect("starts and ends on the footprints' edges", () =>
    Effect.sync(() => {
      const route = routeOf(routeHops(blocked.data, blocked.layout), "a-b");
      const [first] = route.points;
      const last = route.points.at(-1);

      assert.isDefined(first);
      assert.isDefined(last);
      assert.isTrue(onEdge(first, at(0, 0)), "doesn't start on a's edge");
      assert.isTrue(onEdge(last, at(8, 0)), "doesn't end on b's edge");
    })
  );

  it.effect("runs every leg along x or y, on half units", () =>
    Effect.sync(() => {
      const { data, layout } = mapOf(
        { a: at(0, 0), b: at(7.5, 5.5), c: at(-6, 9) },
        [hop("a", "b"), hop("b", "c"), hop("c", "a")]
      );

      for (const route of Rec.values(routeHops(data, layout))) {
        for (const { start, end } of legsOf(route.points)) {
          assert.isTrue(start.x === end.x || start.y === end.y, "diagonal leg");
        }

        for (const point of route.points) {
          assert.isTrue(Number.isInteger(point.x * 2), "off the half grid");
          assert.isTrue(Number.isInteger(point.y * 2), "off the half grid");
        }
      }
    })
  );

  it.effect(
    "runs hops between the same pair side by side, in either direction",
    () =>
      Effect.sync(() => {
        const { data, layout } = mapOf({ a: at(0, 0), b: at(6, 3) }, [
          hop("a", "b", "request"),
          hop("b", "a", "reply"),
          hop("a", "b", "again"),
        ]);

        const routes = routeHops(data, layout);
        const request = stepsOf(routeOf(routes, "request").points);
        const reply = stepsOf(routeOf(routes, "reply").points);
        const again = stepsOf(routeOf(routes, "again").points);

        assert.deepStrictEqual(Arr.intersection(request, reply), []);
        assert.deepStrictEqual(Arr.intersection(request, again), []);
        assert.deepStrictEqual(Arr.intersection(reply, again), []);
      })
  );

  it.effect(
    "bends at least once between structures apart along both axes",
    () =>
      Effect.sync(() => {
        const { data, layout } = mapOf(
          { a: at(0, 0), b: at(6, 4), c: at(-5, 7), d: at(4, -6) },
          [hop("a", "b"), hop("b", "c"), hop("a", "c"), hop("d", "a")]
        );

        for (const [id, route] of Rec.toEntries(routeHops(data, layout))) {
          assert.isAtLeast(route.points.length, 3, `${id} has no bend`);
        }
      })
  );

  it.effect("leaves and enters by the edges facing the other end", () =>
    Effect.sync(() => {
      // b is down-right of a on the grid, c down-left, d straight ahead.
      const placements = {
        a: at(0, 0),
        b: at(6, 5),
        c: at(-6, 6),
        d: at(7, 0),
      };

      const { data, layout } = mapOf(placements, [
        hop("a", "b"),
        hop("c", "a"),
        hop("a", "d"),
      ]);

      const routes = routeHops(data, layout);

      for (const { id, from, to } of data.hops) {
        const route = routeOf(routes, id);
        const source = layout.structures[from];
        const target = layout.structures[to];
        const [first] = route.points;
        const last = route.points.at(-1);

        assert.isDefined(source);
        assert.isDefined(target);
        assert.isDefined(first);
        assert.isDefined(last);
        assert.isTrue(
          facingEdges(source, target)[edgeOf(first, route.points[1] ?? first)],
          `${id} leaves by an edge facing away`
        );
        assert.isTrue(
          facingEdges(target, source)[
            edgeOf(last, route.points.at(-2) ?? last)
          ],
          `${id} enters by an edge facing away`
        );
      }
    })
  );

  it.effect("keeps each route within its cap when nothing blocks it", () =>
    Effect.sync(() => {
      const { data, layout } = mapOf(
        { a: at(0, 0), b: at(9, 7), c: at(-4, 12), d: at(12, -3) },
        [hop("a", "b"), hop("b", "c"), hop("c", "d"), hop("d", "a")]
      );

      for (const [id, route] of Rec.toEntries(routeHops(data, layout))) {
        const { length, distance } = routeLength(route.points);

        assert.isAtMost(length, routeCap(distance), `${id} is too long`);
        assert.isFalse(route.tooLong);
      }
    })
  );

  it.effect("keeps out of other groups' zones when it can", () =>
    Effect.sync(() => {
      // z sits between a and b in its own group, so its zone, one unit past
      // its footprint, blocks the straight route.
      const base = mapOf({ a: at(0, 0), z: at(4, 0), b: at(8, 0) }, [
        hop("a", "b"),
      ]);

      const data: MapData = {
        ...base.data,
        groups: [...base.data.groups, { id: "other", title: "Other" }],
        structures: Arr.map(base.data.structures, (item) =>
          item.id === "z" ? { ...item, group: "other" } : item
        ),
      };

      const route = routeOf(routeHops(data, base.layout), "a-b");
      const zone = { x: 3, y: -1, w: 4, d: 4 };

      for (const leg of legsOf(route.points)) {
        assert.isFalse(legCrosses(leg, zone), "runs through z's zone");
      }
    })
  );

  it.effect("gives the same routes for the same layout", () =>
    Effect.sync(() => {
      const { data, layout } = mapOf(
        { a: at(0, 0), m: at(4, 0), b: at(8, 0), c: at(4, 5) },
        [hop("a", "b"), hop("b", "a"), hop("c", "a"), hop("b", "c")]
      );

      assert.deepStrictEqual(routeHops(data, layout), routeHops(data, layout));
    })
  );

  it.effect("follows a route override", () =>
    Effect.sync(() => {
      const override = [
        { x: 2, y: 1 },
        { x: 3, y: 1 },
        { x: 3, y: -2 },
        { x: 9, y: -2 },
        { x: 9, y: 0 },
      ];

      const { data, layout } = mapOf(
        { a: at(0, 0), m: at(4, 0), b: at(8, 0) },
        [hop("a", "b")],
        { "a-b": override }
      );

      const route = routeOf(routeHops(data, layout), "a-b");

      assert.deepStrictEqual(route.points, override);
      assert.isTrue(route.overridden);
      assert.deepStrictEqual(route.crosses, []);
    })
  );

  it.effect("names the structures an override runs under", () =>
    Effect.sync(() => {
      const { data, layout } = mapOf(
        { a: at(0, 0), m: at(4, 0), b: at(8, 0) },
        [hop("a", "b")],
        {
          "a-b": [
            { x: 2, y: 1 },
            { x: 8, y: 1 },
          ],
        }
      );

      assert.deepStrictEqual(routeOf(routeHops(data, layout), "a-b").crosses, [
        "m",
      ]);
    })
  );

  it.effect(
    "runs under as few structures as it can when there's no clear route",
    () =>
      Effect.sync(() => {
        // t is walled in on every side, half a unit away.
        const { data, layout } = mapOf(
          {
            s: at(-6, 2),
            t: at(2, 2),
            n: sized(1.5, -0.5, { w: 3, d: 2 }),
            w: sized(-0.5, 1.5, { w: 2, d: 3 }),
            e: sized(4.5, 1.5, { w: 2, d: 3 }),
            south: sized(1.5, 4.5, { w: 3, d: 2 }),
          },
          [hop("s", "t")]
        );

        const { crosses } = routeOf(routeHops(data, layout), "s-t");

        assert.lengthOf(crosses, 1);
        assert.include(["n", "w", "e", "south"], crosses[0]);
      })
  );

  it.effect("is fast enough for 40 structures and 60 hops", () =>
    Effect.sync(() => {
      const ids = Arr.map(Arr.range(0, 39), (index) => `s${index}`);

      const placements = Rec.fromEntries(
        Arr.map(ids, (id, index) => [
          id,
          at((index % 8) * 4, Math.floor(index / 8) * 4),
        ])
      );

      const hops = Arr.map(Arr.range(0, 59), (index) =>
        hop(`s${(index * 7) % 40}`, `s${(index * 13 + 5) % 40}`, `h${index}`)
      );

      const { data, layout } = mapOf(placements, hops);
      const started = performance.now();
      const routes = routeHops(data, layout);

      assert.isBelow(performance.now() - started, 2000);
      assert.lengthOf(Rec.keys(routes), 60);
    })
  );
});

describe("route checks", () => {
  it.effect("warns about a hop that can't avoid a box, naming it", () =>
    Effect.sync(() => {
      const { data, layout } = mapOf(
        {
          s: at(-6, 2),
          t: at(2, 2),
          n: sized(1.5, -0.5, { w: 3, d: 2 }),
          w: sized(-0.5, 1.5, { w: 2, d: 3 }),
          e: sized(4.5, 1.5, { w: 2, d: 3 }),
          south: sized(1.5, 4.5, { w: 3, d: 2 }),
        },
        [hop("s", "t")]
      );

      const warnings = Arr.filter(checkLayout(data, layout), ({ message }) =>
        Str.includes("runs under")(message)
      );

      assert.lengthOf(warnings, 1);
      assert.strictEqual(warnings[0]?.file, "layout.json");
      assert.strictEqual(warnings[0]?.path, 'routes["s-t"]');
      assert.match(
        warnings[0]?.message ?? "",
        /^hop "s-t" from "s" to "t" runs under "(?:n|w|e|south)": no clear route goes around it\. Move the structures apart to open a gap, or write a route override\.$/u
      );
    })
  );

  it.effect("gives an override that runs through a box the same warning", () =>
    Effect.sync(() => {
      const { data, layout } = mapOf(
        { a: at(0, 0), m: at(4, 0), b: at(8, 0) },
        [hop("a", "b")],
        {
          "a-b": [
            { x: 2, y: 1 },
            { x: 8, y: 1 },
          ],
        }
      );

      assert.deepStrictEqual(
        Arr.map(checkLayout(data, layout), ({ file, path, message }) => ({
          file,
          path,
          message,
        })),
        [
          {
            file: "layout.json",
            path: 'routes["a-b"]',
            message:
              'hop "a-b" from "a" to "b" runs under "m": its route override passes through that box. Change the override\'s points so it goes around, or delete it so the hop routes itself.',
          },
        ]
      );
    })
  );

  it.effect("warns about an override for a hop that no longer exists", () =>
    Effect.sync(() => {
      const { data, layout } = mapOf({ a: at(0, 0), b: at(4, 0) }, [], {
        gone: [
          { x: 2, y: 1 },
          { x: 4, y: 1 },
        ],
      });

      assert.deepStrictEqual(
        Arr.map(checkLayout(data, layout), ({ path, message }) => ({
          path,
          message,
        })),
        [
          {
            path: "routes.gone",
            message:
              'no hop in data.mjs has the id "gone". build removes this route override.',
          },
        ]
      );
    })
  );

  it.effect("is quiet when every route is clear", () =>
    Effect.sync(() => {
      assert.deepStrictEqual(checkLayout(blocked.data, blocked.layout), []);
    })
  );
});
