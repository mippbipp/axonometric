import { assert, describe, it } from "@effect/vitest";
import {
  Array as Arr,
  Effect,
  Option,
  Record as Rec,
  String as Str,
} from "effect";
import { vi } from "vitest";

import {
  arrowheadOf,
  arrowHalfWidth,
  arrowPolygon,
  checkLayout,
  corners,
  distanceToPolyline,
  groundProjections,
  routeRevealed,
  nameTagRect,
  nameTagText,
  project,
  views,
  sceneClashes,
  sceneOf,
  segmentCrosses,
} from "../src/index.ts";
import type {
  GridPoint,
  Layout,
  MapData,
  SceneClash,
  Placement,
  ScreenPoint,
  ScreenRect,
} from "../src/index.ts";
import { chaptersOf, everything, fixture } from "./fixture-maps.ts";
import {
  facingEdges,
  facingEdgesFull,
  outsideArea,
  routeArea,
} from "./route-geometry.ts";

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

interface Leg {
  readonly start: GridPoint;
  readonly end: GridPoint;
}

const legsOf = (points: readonly GridPoint[]): readonly Leg[] =>
  Arr.flatMap(points, (start, index) => {
    const end = points[index + 1];

    return end === undefined ? [] : [{ start, end }];
  });

/**
 * Whether a leg along x and a leg along y cross: each passes strictly
 * through the other's span. Legs that only meet at an end don't cross.
 */
const legsCross = (a: Leg, b: Leg) => {
  const [across, down] = a.start.y === a.end.y ? [a, b] : [b, a];

  if (across.start.y !== across.end.y || down.start.x !== down.end.x) {
    return false;
  }

  const {
    start: { y },
  } = across;

  const {
    start: { x },
  } = down;

  return (
    Math.min(across.start.x, across.end.x) < x &&
    x < Math.max(across.start.x, across.end.x) &&
    Math.min(down.start.y, down.end.y) < y &&
    y < Math.max(down.start.y, down.end.y)
  );
};

const routesCross = (a: readonly GridPoint[], b: readonly GridPoint[]) =>
  Arr.some(legsOf(a), (first) =>
    Arr.some(legsOf(b), (second) => legsCross(first, second))
  );

const bendsOf = (points: readonly GridPoint[]) =>
  Math.max(0, points.length - 2);

interface Span {
  readonly from: number;
  readonly to: number;
}

/** Whether two spans share more than a half unit, room for a straight leg. */
const spansShare = (a: Span, b: Span) =>
  Math.max(a.from, b.from) + 0.5 <= Math.min(a.to, b.to) - 0.5;

const apart = (a: Span, b: Span) => a.to <= b.from || b.to <= a.from;

const alongX = ({ x, w }: Placement): Span => ({ from: x, to: x + w });

const alongY = ({ y, d }: Placement): Span => ({ from: y, to: y + d });

/**
 * The fewest bends any right-angled route between two footprints needs
 * with nothing in the way: 1 when they're apart on both axes, 0 when a
 * straight leg fits between them, and 2 otherwise.
 */
const fewestBends = (a: Placement, b: Placement) => {
  const apartX = apart(alongX(a), alongX(b));
  const apartY = apart(alongY(a), alongY(b));

  if (apartX && apartY) {
    return 1;
  }

  const straight =
    (apartX && spansShare(alongY(a), alongY(b))) ||
    (apartY && spansShare(alongX(a), alongX(b)));

  return straight ? 0 : 2;
};

/** One hop routed on its own around the revealed structures. */
const alone = (
  { data, layout }: { readonly data: MapData; readonly layout: Layout },
  revealed: ReadonlySet<string>,
  id: string
): readonly GridPoint[] => {
  const routes = routeRevealed({
    data: { ...data, hops: Arr.filter(data.hops, (hop) => hop.id === id) },
    layout,
    revealed,
  });

  return routes[id]?.points ?? [];
};

/** How far a bend may sit outside its route's area, in grid units. */
const strayLimit = 3;

/**
 * Hops in chapter 1 of the pipeline map allowed to bend outside their area,
 * and why. Each entry is checked: the test fails once a route with at most
 * two bends could stay inside the area, so the exception can't outlive its
 * reason.
 *
 * - h-upstream-updater: every 2-bend route that stays inside its area runs
 *   under main or through Updater's name tag. It bends 1.18 units outside.
 * - h-main-updater: on its own it stays inside its area, but beside
 *   h-upstream-updater no pair of routes that don't cross keeps both
 *   inside. It bends 0.74 units outside.
 */
const chapterOneExceptions = new Set(["h-upstream-updater", "h-main-updater"]);

const hopOf = (data: MapData, id: string) => {
  const hop = Arr.findFirst(data.hops, (item) => item.id === id);

  assert.isTrue(Option.isSome(hop), `no hop ${id}`);

  return Option.getOrThrow(hop);
};

const shapeOf = (data: MapData, id: string) =>
  Option.getOrThrow(Arr.findFirst(data.structures, (item) => item.id === id))
    .shape;

const areaOf = (
  { data, layout }: { readonly data: MapData; readonly layout: Layout },
  hop: { readonly from: string; readonly to: string }
) =>
  routeArea(
    {
      placement: placementOf(layout, hop.from),
      shape: shapeOf(data, hop.from),
    },
    { placement: placementOf(layout, hop.to), shape: shapeOf(data, hop.to) }
  );

/** How far a route's furthest bend sits outside its area, in grid units. */
const strayOf = (
  map: { readonly data: MapData; readonly layout: Layout },
  hop: { readonly from: string; readonly to: string },
  points: readonly GridPoint[]
) => {
  const area = areaOf(map, hop);

  return Math.max(
    0,
    ...Arr.map(points.slice(1, -1), (point) =>
      outsideArea(area, project(point))
    )
  );
};

/** The points on a footprint's edges, on half units. */
const edgePointsOf = ({ x, y, w, d }: Placement): readonly GridPoint[] => [
  ...Arr.flatMap(Arr.range(0, w * 2), (step) => [
    { x: x + step / 2, y },
    { x: x + step / 2, y: y + d },
  ]),
  ...Arr.flatMap(Arr.range(0, d * 2), (step) => [
    { x, y: y + step / 2 },
    { x: x + w, y: y + step / 2 },
  ]),
];

/** Whether a leg leaves a footprint's edge outwards. */
const leaves = (point: GridPoint, next: GridPoint, box: Placement) =>
  (point.x === box.x && next.x < box.x) ||
  (point.x === box.x + box.w && next.x > box.x + box.w) ||
  (point.y === box.y && next.y < box.y) ||
  (point.y === box.y + box.d && next.y > box.y + box.d);

/** Whether a leg runs through a footprint's inside or along its edge. */
const legTouches = (leg: Leg, box: Placement) => {
  const left = Math.min(leg.start.x, leg.end.x);
  const right = Math.max(leg.start.x, leg.end.x);
  const top = Math.min(leg.start.y, leg.end.y);
  const bottom = Math.max(leg.start.y, leg.end.y);

  return (
    left <= box.x + box.w &&
    right >= box.x &&
    top <= box.y + box.d &&
    bottom >= box.y
  );
};

/** Whether a leg's line on screen runs through a name tag. */
const legCrossesTag = (leg: Leg, tag: ScreenRect) =>
  segmentCrosses({ start: project(leg.start), end: project(leg.end) }, [
    { sx: tag.left, sy: tag.top },
    { sx: tag.right, sy: tag.top },
    { sx: tag.right, sy: tag.bottom },
    { sx: tag.left, sy: tag.bottom },
  ]);

/**
 * The least stray any route with at most two bends could have: leaving its
 * source squarely, entering its target squarely, and keeping off every
 * other revealed footprint, off the ends' footprints after its first leg
 * and before its last, and off every revealed name tag. Infinity when no
 * such route exists.
 */
const clearRoutes = (
  map: { readonly data: MapData; readonly layout: Layout },
  hop: { readonly from: string; readonly to: string },
  revealed: ReadonlySet<string>
): readonly (readonly GridPoint[])[] => {
  const source = placementOf(map.layout, hop.from);
  const target = placementOf(map.layout, hop.to);

  const others = Arr.flatMap([...revealed], (id) =>
    id === hop.from || id === hop.to ? [] : [placementOf(map.layout, id)]
  );

  const tags = Arr.flatMap(map.data.structures, (structure) =>
    revealed.has(structure.id)
      ? [
          nameTagRect(
            placementOf(map.layout, structure.id),
            nameTagText(structure)
          ),
        ]
      : []
  );

  const span = Arr.range(-20, 60);

  const candidates = Arr.flatMap(edgePointsOf(source), (start) =>
    Arr.flatMap(edgePointsOf(target), (end) => [
      [start, { x: end.x, y: start.y }, end],
      [start, { x: start.x, y: end.y }, end],
      ...Arr.flatMap(span, (step) => [
        [start, { x: step / 2, y: start.y }, { x: step / 2, y: end.y }, end],
        [start, { x: start.x, y: step / 2 }, { x: end.x, y: step / 2 }, end],
      ]),
    ])
  );

  const clear = (points: readonly GridPoint[]) => {
    const legs = legsOf(points);
    const [first] = legs;
    const last = legs.at(-1);

    return (
      first !== undefined &&
      last !== undefined &&
      leaves(first.start, first.end, source) &&
      leaves(last.end, last.start, target) &&
      Arr.every(
        legs,
        (leg, index) =>
          Arr.every(others, (box) => !legTouches(leg, box)) &&
          Arr.every(tags, (tag) => !legCrossesTag(leg, tag)) &&
          (index === 0 || !legTouches(leg, source)) &&
          (index === legs.length - 1 || !legTouches(leg, target))
      )
    );
  };

  return Arr.filter(candidates, clear);
};

/**
 * The least stray any route with at most two bends could have, clear of
 * every revealed box and name tag. Infinity when no such route exists.
 */
const fewestStrayClear = (
  map: { readonly data: MapData; readonly layout: Layout },
  hop: { readonly from: string; readonly to: string },
  revealed: ReadonlySet<string>
) =>
  Math.min(
    Number.POSITIVE_INFINITY,
    ...Arr.map(clearRoutes(map, hop, revealed), (points) =>
      strayOf(map, hop, points)
    )
  );

/** Every half-unit step a route takes, as order-free keys. */
const stepKeysOf = (points: readonly GridPoint[]) =>
  new Set(
    Arr.flatMap(legsOf(points), ({ start, end }) => {
      const count = Math.abs(end.x - start.x + end.y - start.y) * 2;
      const dx = Math.sign(end.x - start.x) / 2;
      const dy = Math.sign(end.y - start.y) / 2;

      return Arr.map(Arr.range(0, count - 1), (step) => {
        const x = start.x + dx * step;
        const y = start.y + dy * step;

        return `${Math.min(x, x + dx)},${Math.min(y, y + dy)},${dx === 0 ? "y" : "x"}`;
      });
    })
  );

/** Whether two routes share a half-unit step anywhere. */
const shareStep = (a: readonly GridPoint[], b: readonly GridPoint[]) => {
  const first = stepKeysOf(a);

  return Arr.some([...stepKeysOf(b)], (step) => first.has(step));
};

/**
 * The least of the two strays that a pair of clear routes with at most two
 * bends each, neither crossing nor sharing a step with the other, could
 * have. Infinity when no such pair exists.
 */
const fewestPairStray = (
  map: { readonly data: MapData; readonly layout: Layout },
  hops: readonly [
    { readonly from: string; readonly to: string },
    { readonly from: string; readonly to: string },
  ],
  revealed: ReadonlySet<string>
) => {
  const [first, second] = hops;

  // Inside the area is all that matters, so keep the routes that are.
  const inside = (hop: (typeof hops)[number]) =>
    Arr.filter(
      clearRoutes(map, hop, revealed),
      (points) => strayOf(map, hop, points) === 0
    );

  const pairs = Arr.flatMap(inside(first), (a) =>
    Arr.filter(inside(second), (b) => !routesCross(a, b) && !shareStep(a, b))
  );

  return pairs.length > 0 ? 0 : Number.POSITIVE_INFINITY;
};

const placementOf = (layout: Layout, id: string): Placement => {
  const placement = layout.structures[id];

  assert.isDefined(placement, `${id} has no placement`);

  return placement;
};

const distance = (a: ScreenPoint, b: ScreenPoint) =>
  Math.hypot(a.sx - b.sx, a.sy - b.sy);

/** How far a point is from the segment between `a` and `b`, ends included. */
const toSegment = (point: ScreenPoint, a: ScreenPoint, b: ScreenPoint) => {
  const dx = b.sx - a.sx;
  const dy = b.sy - a.sy;
  const length = dx * dx + dy * dy;

  const along =
    length === 0
      ? 0
      : Math.min(
          1,
          Math.max(
            0,
            ((point.sx - a.sx) * dx + (point.sy - a.sy) * dy) / length
          )
        );

  return distance(point, { sx: a.sx + along * dx, sy: a.sy + along * dy });
};

/**
 * How far a line is from a rect on screen: 0 when the line runs into it.
 * A segment that misses a rect is nearest it at one of its own ends or at
 * one of the rect's corners.
 */
const rectGap = (points: readonly ScreenPoint[], rect: ScreenRect) => {
  const box = [
    { sx: rect.left, sy: rect.top },
    { sx: rect.right, sy: rect.top },
    { sx: rect.right, sy: rect.bottom },
    { sx: rect.left, sy: rect.bottom },
  ];

  const inside = ({ sx, sy }: ScreenPoint) =>
    sx >= rect.left && sx <= rect.right && sy >= rect.top && sy <= rect.bottom;

  const gaps = Arr.flatMap(points.slice(1), (b, at) => {
    const a = points[at] ?? b;

    // Sample the segment so one that passes right through counts as 0.
    const through = Arr.some(Arr.range(0, 100), (step) =>
      inside({
        sx: a.sx + ((b.sx - a.sx) * step) / 100,
        sy: a.sy + ((b.sy - a.sy) * step) / 100,
      })
    );

    return through
      ? [0]
      : [
          ...Arr.map(box, (corner) => toSegment(corner, a, b)),
          ...Arr.map([a, b], (end) =>
            Math.min(
              ...Arr.map(box, (corner, index) =>
                toSegment(end, corner, box[(index + 1) % 4] ?? corner)
              )
            )
          ),
        ];
  });

  return Math.min(...gaps);
};

/** How far a point sits from the segment between `a` and `b`. */
const offSegment = (point: ScreenPoint, a: ScreenPoint, b: ScreenPoint) => {
  const length = distance(a, b);

  const across =
    ((b.sx - a.sx) * (a.sy - point.sy) - (a.sx - point.sx) * (b.sy - a.sy)) /
    length;

  return Math.abs(across);
};

// The pipeline map routes 29 hops for each of its eight chapters, and some
// tests search every short route for comparison: a few seconds each, more
// when the browser tests run alongside.
vi.setConfig({ testTimeout: 30_000 });

const clashKey = ({ between: [first, second] }: SceneClash) =>
  `${first} × ${second}`;

/**
 * Clashes a fixture draws on purpose, by fixture and chapter. Each is
 * checked both ways: any other clash fails, and so does an allowed one
 * that's no longer drawn.
 *
 * - crowded, chapter c-all, Iso view: the north and west walls' boxes are
 *   drawn over the vault's box. The walls stand half a unit from the vault
 *   so that no route can reach it without running under one, which is what
 *   the map is for, and at that distance their iso boxes overlap the
 *   vault's on screen.
 * - shapes, Iso view: two boxes stand on the name tags in front of them.
 *   The map packs its boxes tight, and `check` warns about both tags.
 */
const allowedClashes: ReadonlyMap<string, readonly string[]> = new Map([
  ["crowded c-all iso", ["box:north × box:vault", "box:west × box:vault"]],
  ["shapes all iso", ["box:document × tag:job", "box:store × tag:cards"]],
]);

describe("scene", () => {
  for (const name of [
    "flake-pipeline",
    "review",
    "crowded",
    "shapes",
    "pipeline",
  ]) {
    it.effect(
      `draws nothing over anything in any chapter of ${name}, in either view`,
      () =>
        Effect.gen(function* () {
          const { data, layout } = yield* fixture(name);

          const chapters = Arr.isReadonlyArrayNonEmpty(data.chapters)
            ? chaptersOf(data)
            : [{ id: "all", plays: [], revealed: everything(data) }];

          for (const chapter of chapters) {
            for (const view of views) {
              const scene = sceneOf({
                data,
                layout,
                revealed: chapter.revealed,
                labelFirst: chapter.plays,
                view,
              });

              const where = `in chapter ${chapter.id}, ${view} view`;

              const allowed =
                allowedClashes.get(`${name} ${chapter.id} ${view}`) ?? [];

              const clashes = Arr.map(sceneClashes(scene), clashKey);

              assert.strictEqual(scene.view, view);
              assert.deepStrictEqual(
                Arr.filter(clashes, (clash) => !allowed.includes(clash)),
                [],
                where
              );

              // Each allowed clash must still happen, so none outlives its
              // reason.
              assert.deepStrictEqual(
                Arr.filter(allowed, (clash) => !clashes.includes(clash)),
                [],
                `allowed clashes no longer drawn ${where}`
              );
            }
          }
        })
    );
  }

  it.effect(
    "draws Plan view's boxes, routes and zones flat from the layout",
    () =>
      Effect.gen(function* () {
        const { data, layout } = yield* fixture("review");

        const scene = sceneOf({
          data,
          layout,
          revealed: everything(data),
          view: "plan",
        });

        // One scale for the whole map, read off the server's width. The
        // server is a plain box, drawn as its footprint exactly.
        const server = Arr.findFirst(
          scene.structures,
          ({ structure }) => structure.id === "server"
        ).pipe(Option.getOrThrow);

        const scale =
          ((server.outline[1]?.sx ?? 0) - (server.outline[0]?.sx ?? 0)) /
          placementOf(layout, "server").w;

        assert.isAbove(scale, 0);

        /** A ground rectangle drawn flat: its corners clockwise from the top left. */
        const flat = ({ x, y, w, d }: Placement) => [
          { sx: x * scale, sy: y * scale },
          { sx: (x + w) * scale, sy: y * scale },
          { sx: (x + w) * scale, sy: (y + d) * scale },
          { sx: x * scale, sy: (y + d) * scale },
        ];

        assert.deepStrictEqual(
          server.outline,
          flat(placementOf(layout, "server"))
        );

        // Other shapes may overhang their footprint, the same on every side.
        for (const { structure, outline } of scene.structures) {
          const { x, y, w, d } = placementOf(layout, structure.id);
          const by = x - (outline[0]?.sx ?? 0) / scale;

          const drawn = flat({
            x: x - by,
            y: y - by,
            w: w + 2 * by,
            d: d + 2 * by,
          });

          assert.isAtLeast(by, 0, structure.id);
          assert.lengthOf(outline, 4, structure.id);

          for (const [corner, want] of Arr.zip(outline, drawn)) {
            assert.closeTo(corner.sx, want.sx, 1e-9, structure.id);
            assert.closeTo(corner.sy, want.sy, 1e-9, structure.id);
          }
        }

        assert.lengthOf(scene.zones, data.groups.length);

        for (const { zone, plate } of scene.zones) {
          assert.deepStrictEqual(plate, flat(zone.box), zone.group.id);
        }

        for (const hop of scene.hops) {
          assert.deepStrictEqual(
            hop.points,
            Arr.map(hop.route.points, ({ x: gx, y: gy }) => ({
              sx: gx * scale,
              sy: gy * scale,
            })),
            hop.hop.id
          );
        }
      })
  );

  for (const view of views) {
    it.effect(
      `keeps every label within 1.5 grid units of its route in ${view === "iso" ? "the Iso view" : "Plan view"}`,
      () =>
        Effect.gen(function* () {
          const { unit } = groundProjections[view];

          for (const name of [
            "flake-pipeline",
            "review",
            "crowded",
            "shapes",
            "pipeline",
          ]) {
            const { data, layout } = yield* fixture(name);

            const chapters = Arr.isReadonlyArrayNonEmpty(data.chapters)
              ? chaptersOf(data)
              : [{ id: "all", plays: [], revealed: everything(data) }];

            for (const chapter of chapters) {
              const scene = sceneOf({
                data,
                layout,
                revealed: chapter.revealed,
                labelFirst: chapter.plays,
                view,
              });

              for (const { hop, points, label } of scene.hops) {
                if (label !== undefined) {
                  const gap = rectGap(points, label) / unit;

                  assert.isAtMost(
                    gap,
                    1.5 + 1e-9,
                    `${hop.id}'s label in ${name} ${chapter.id}`
                  );
                }
              }
            }
          }
        })
    );
  }

  it.effect(
    "puts every arrowhead's tip on its target's outline and its base on the last leg",
    () =>
      Effect.gen(function* () {
        const { data, layout } = yield* fixture("flake-pipeline");

        const scene = sceneOf({
          data,
          layout,
          revealed: new Set(Arr.map(data.structures, ({ id }) => id)),
        });

        assert.lengthOf(scene.hops, data.hops.length);

        for (const hop of scene.hops) {
          const head = arrowheadOf(hop.points);
          const before = hop.points.at(-2);

          assert.isDefined(head);
          assert.isDefined(before);

          const { back, right, front, left } = corners(
            placementOf(layout, hop.hop.to),
            0
          );

          assert.isBelow(
            distanceToPolyline([back, right, front, left, back], head.tip),
            0.5,
            `${hop.hop.id} ends off its target`
          );
          assert.isBelow(offSegment(head.base, before, head.tip), 1e-6);
          // Every arrowhead is 10 px long.
          assert.closeTo(distance(head.base, head.tip), 10, 1e-6);
        }
      })
  );

  it.effect("starts every route on its source's ground outline", () =>
    Effect.gen(function* () {
      const { data, layout } = yield* fixture("flake-pipeline");

      const scene = sceneOf({
        data,
        layout,
        revealed: new Set(Arr.map(data.structures, ({ id }) => id)),
      });

      for (const hop of scene.hops) {
        const { back, right, front, left } = corners(
          placementOf(layout, hop.hop.from),
          0
        );

        const [start] = hop.points;

        assert.isDefined(start);

        const edges = [
          [back, right],
          [right, front],
          [front, left],
          [left, back],
        ] as const;

        assert.isBelow(
          Math.min(...Arr.map(edges, ([a, b]) => offSegment(start, a, b))),
          0.5,
          `${hop.hop.id} starts off its source`
        );
      }
    })
  );

  it.effect("keeps every route inside the zones' bounds plus a margin", () =>
    Effect.gen(function* () {
      const { data, layout } = yield* fixture("flake-pipeline");

      const xs = Arr.flatMap(Rec.values(layout.structures), (p) => [
        p.x,
        p.x + p.w,
      ]);

      const ys = Arr.flatMap(Rec.values(layout.structures), (p) => [
        p.y,
        p.y + p.d,
      ]);

      // Zones reach one unit past their structures; routes may go two more.
      const margin = 3;

      for (const route of Rec.values(
        routeRevealed({ data, layout, revealed: everything(data) })
      )) {
        for (const point of route.points) {
          assert.isAtLeast(point.x, Math.min(...xs) - margin);
          assert.isAtMost(point.x, Math.max(...xs) + margin);
          assert.isAtLeast(point.y, Math.min(...ys) - margin);
          assert.isAtMost(point.y, Math.max(...ys) + margin);
        }
      }
    })
  );

  it.effect("routes chapter 1 of the pipeline with no two hops crossing", () =>
    Effect.gen(function* () {
      const { data, layout } = yield* fixture("flake-pipeline");
      const [first] = chaptersOf(data);

      assert.isDefined(first);

      const routes = Rec.toEntries(
        routeRevealed({ data, layout, revealed: first.revealed })
      );

      assert.isAtLeast(routes.length, 2);

      const crossings = Arr.flatMap(routes, ([id, route], index) =>
        Arr.flatMap(routes.slice(index + 1), ([other, next]) =>
          routesCross(route.points, next.points) ? [`${id} × ${other}`] : []
        )
      );

      assert.deepStrictEqual(crossings, []);
    })
  );

  it.effect(
    "keeps every pipeline route within its cap, or warns about it",
    () =>
      Effect.gen(function* () {
        const { data, layout } = yield* fixture("flake-pipeline");

        const warned = new Set(
          Arr.flatMap(checkLayout(data, layout), ({ path, message }) =>
            Str.includes("long way round")(message) ? [path] : []
          )
        );

        for (const chapter of chaptersOf(data)) {
          const routes = routeRevealed({
            data,
            layout,
            revealed: chapter.revealed,
          });

          for (const [id, route] of Rec.toEntries(routes)) {
            const [first] = route.points;
            const last = route.points.at(-1);

            assert.isDefined(first);
            assert.isDefined(last);

            // The cap: half as long again as the ends are apart, plus a unit.
            const ends =
              Math.abs(last.x - first.x) + Math.abs(last.y - first.y);

            const length = Arr.reduce(
              legsOf(route.points),
              0,
              (sum, { start, end }) =>
                sum + Math.abs(end.x - start.x) + Math.abs(end.y - start.y)
            );

            assert.isTrue(
              length <= 1.5 * ends + 1 || warned.has(`routes["${id}"]`),
              `${id} in ${chapter.id}: ${length} units for ends ${ends} apart`
            );
          }
        }
      })
  );

  it.effect(
    "leaves and enters every pipeline route by an edge facing the other end, unless every point on the facing edges is taken by another hop of the same box",
    () =>
      Effect.gen(function* () {
        const { data, layout } = yield* fixture("flake-pipeline");

        for (const chapter of chaptersOf(data)) {
          const routes = routeRevealed({
            data,
            layout,
            revealed: chapter.revealed,
          });

          // Every end on every box, with the edge it leaves or enters by.
          const ends = Arr.flatMap(data.hops, (hop) => {
            const route = routes[hop.id];
            const [first] = route?.points ?? [];
            const last = route?.points.at(-1);

            return route === undefined ||
              first === undefined ||
              last === undefined
              ? []
              : [
                  {
                    hop: hop.id,
                    box: hop.from,
                    other: hop.to,
                    head: false,
                    edge: edgeOf(first, route.points[1] ?? first),
                  },
                  {
                    hop: hop.id,
                    box: hop.to,
                    other: hop.from,
                    head: true,
                    edge: edgeOf(last, route.points.at(-2) ?? last),
                  },
                ];
          });

          for (const end of ends) {
            const box = placementOf(layout, end.box);
            const other = placementOf(layout, end.other);

            if (facingEdges(box, other)[end.edge] !== true) {
              const taken = Arr.filter(
                ends,
                (item) =>
                  item.box === end.box &&
                  !(item.hop === end.hop && item.head === end.head)
              );

              assert.isTrue(
                facingEdgesFull(box, other, { taken, extra: end.head }),
                `${end.hop} ${end.head ? "enters" : "leaves"} ${end.box} by an edge facing away in ${chapter.id} while a facing edge has room`
              );
            }
          }
        }
      })
  );

  it.effect(
    "routes chapter 1 with at most 2 bends a hop, each inside its area or forced out",
    () =>
      Effect.gen(function* () {
        const { data, layout } = yield* fixture("flake-pipeline");
        const [first] = chaptersOf(data);

        assert.isDefined(first);

        const routes = Rec.toEntries(
          routeRevealed({ data, layout, revealed: first.revealed })
        );

        assert.lengthOf(routes, 2);

        for (const [id, route] of routes) {
          const hop = hopOf(data, id);
          const stray = strayOf({ data, layout }, hop, route.points);

          assert.isAtMost(bendsOf(route.points), 2, id);

          if (chapterOneExceptions.has(id)) {
            // The exception holds only while nothing better exists: no
            // clear route on its own, or no non-crossing pair with the
            // other hop, stays inside.
            const others = Arr.filter(routes, ([other]) => other !== id);

            const onItsOwn = fewestStrayClear(
              { data, layout },
              hop,
              first.revealed
            );

            const together = Arr.every(
              others,
              ([other]) =>
                fewestPairStray(
                  { data, layout },
                  [hop, hopOf(data, other)],
                  first.revealed
                ) > 0
            );

            assert.isTrue(
              onItsOwn > 0 || together,
              `${id} could stay inside its area: drop its exception`
            );
          } else {
            assert.strictEqual(stray, 0, `${id} bends outside its area`);
          }
        }
      })
  );

  for (const name of ["flake-pipeline", "review", "crowded"]) {
    it.effect(
      `keeps every ${name} bend within 3 units of its area unless boxes force it`,
      () =>
        Effect.gen(function* () {
          const { data, layout } = yield* fixture(name);

          for (const chapter of chaptersOf(data)) {
            const routes = routeRevealed({
              data,
              layout,
              revealed: chapter.revealed,
            });

            for (const [id, route] of Rec.toEntries(routes)) {
              const hop = hopOf(data, id);
              const stray = strayOf({ data, layout }, hop, route.points);

              assert.isTrue(
                stray <= strayLimit ||
                  fewestStrayClear({ data, layout }, hop, chapter.revealed) >
                    strayLimit,
                `${id} in ${chapter.id} bends ${stray.toFixed(2)} units outside its area`
              );
            }
          }
        })
    );
  }

  for (const name of ["flake-pipeline", "review", "crowded"]) {
    it.effect(`bends each ${name} route at most once more than it needs`, () =>
      Effect.gen(function* () {
        const { data, layout } = yield* fixture(name);

        for (const chapter of chaptersOf(data)) {
          const routes = routeRevealed({
            data,
            layout,
            revealed: chapter.revealed,
          });

          for (const hop of data.hops) {
            const route = routes[hop.id];

            if (route !== undefined) {
              const source = placementOf(layout, hop.from);
              const target = placementOf(layout, hop.to);
              const fewest = fewestBends(source, target);
              const bends = bendsOf(route.points);

              // A revealed box in the way can force more: check that
              // the hop on its own, around the same boxes, needs them too.
              const forced = bendsOf(
                alone({ data, layout }, chapter.revealed, hop.id)
              );

              assert.isAtMost(
                bends,
                Math.max(fewest, forced) + 1,
                `${hop.id} in ${chapter.id}`
              );
            }
          }
        }
      })
    );
  }
});

/** A one-group map with 2×2 boxes at `placements` and route overrides. */
const groundMap = (
  placements: Readonly<Record<string, GridPoint>>,
  hops: readonly {
    readonly id: string;
    readonly from: string;
    readonly to: string;
  }[],
  routes: Readonly<Record<string, readonly GridPoint[]>>
) => {
  const ids = Rec.keys(placements);

  const data: MapData = {
    format: 1,
    revision: 0,
    overview: { title: "Map", summary: "A map." },
    groups: [{ id: "main", title: "Main" }],
    structures: Arr.map(ids, (id) => ({
      id,
      code: "S",
      name: id,
      shape: "box" as const,
      group: "main",
      status: "live" as const,
      oneLiner: "One line.",
      whatItDoes: "Does.",
      howItsBuilt: "Built.",
    })),
    hops: Arr.map(hops, (hop) => ({ ...hop, label: "x" })),
    flows: [],
    chapters: [],
  };

  const layout: Layout = {
    format: 1,
    revision: 0,
    structures: Rec.map(placements, ({ x, y }) => ({ x, y, w: 2, d: 2 })),
    routes,
  };

  return { data, layout, revealed: new Set(ids) };
};

/** The ground clashes of a map's scene in each view, as `a × b` keys. */
const groundClashesOf = (map: ReturnType<typeof groundMap>) =>
  Arr.map(views, (view) => {
    const clashes = sceneClashes(sceneOf({ ...map, view }));

    return Arr.filter(
      Arr.map(clashes, clashKey),
      (key) => !Str.includes("tag:")(key) && !Str.includes("label:")(key)
    );
  });

/** What `check` warns about a map, by message. */
const warningsOf = (map: ReturnType<typeof groundMap>) =>
  Arr.map(checkLayout(map.data, map.layout), ({ message }) => message);

/** The warning `check` gives in each view for a clash between two things. */
const drawnOver = (first: string, second: string) =>
  Arr.map(
    ["", " in Plan view"],
    (where) =>
      `${first} is drawn over ${second}${where}. Move the structures apart, so the drawing has room.`
  );

describe("ground clashes", () => {
  it.effect("reports a route that touches another box's corner", () =>
    Effect.sync(() => {
      // The route turns on m's corner at (4, 0) without running along or
      // under m, so only the outline check sees it.
      const map = groundMap(
        { a: { x: 0, y: 0 }, m: { x: 4, y: 0 }, b: { x: 8, y: 0 } },
        [{ id: "h", from: "a", to: "b" }],
        {
          h: [
            { x: 2, y: 0.5 },
            { x: 3.5, y: 0.5 },
            { x: 3.5, y: 0 },
            { x: 4, y: 0 },
            { x: 4, y: -0.5 },
            { x: 7, y: -0.5 },
            { x: 7, y: 0.5 },
            { x: 8, y: 0.5 },
          ],
        }
      );

      assert.includeMembers(
        warningsOf(map),
        drawnOver('the route of hop "h"', 'the box of "m"')
      );
    })
  );

  it.effect("reports a route that ends on its box's corner", () =>
    Effect.sync(() => {
      const map = groundMap(
        { a: { x: 0, y: 0 }, b: { x: 6, y: 0 } },
        [{ id: "h", from: "a", to: "b" }],
        {
          h: [
            { x: 2, y: 2 },
            { x: 3, y: 2 },
            { x: 3, y: 3 },
            { x: 5, y: 3 },
            { x: 5, y: 1 },
            { x: 6, y: 1 },
          ],
        }
      );

      assert.includeMembers(
        warningsOf(map),
        drawnOver('the route of hop "h"', 'a corner of "a"')
      );
    })
  );

  it.effect("reports a route that lies along a zone's outline", () =>
    Effect.sync(() => {
      // The zone reaches one unit past the boxes, to y = -1.
      const map = groundMap(
        { a: { x: 0, y: 0 }, b: { x: 6, y: 0 } },
        [{ id: "h", from: "a", to: "b" }],
        {
          h: [
            { x: 1, y: 0 },
            { x: 1, y: -1 },
            { x: 7, y: -1 },
            { x: 7, y: 0 },
          ],
        }
      );

      assert.includeMembers(
        warningsOf(map),
        drawnOver('the route of hop "h"', 'the outline of zone "main"')
      );
    })
  );

  it.effect(
    "draws two hops' overrides that share a stretch in lanes of their own",
    () =>
      Effect.sync(() => {
        // Two hops between different pairs share a stretch at y = 5.
        // Overrides keep their points, so the scene draws them as they are.
        const map = groundMap(
          {
            a: { x: 0, y: 0 },
            b: { x: 10, y: 8 },
            c: { x: 4, y: 0 },
            d: { x: 14, y: 8 },
          },
          [
            { id: "one", from: "a", to: "b" },
            { id: "two", from: "c", to: "d" },
          ],
          {
            one: [
              { x: 1, y: 2 },
              { x: 1, y: 5 },
              { x: 11, y: 5 },
              { x: 11, y: 8 },
            ],
            two: [
              { x: 5, y: 2 },
              { x: 5, y: 5 },
              { x: 15, y: 5 },
              { x: 15, y: 8 },
            ],
          }
        );

        const lanes = Arr.map(views, (view) =>
          Arr.map(sceneOf({ ...map, view }).hops, ({ points }) => points)
        );

        // The scene gives each its own lane, so the lines don't coincide.
        for (const clashes of groundClashesOf(map)) {
          assert.notInclude(clashes, "route:one × route:two");
        }

        // Two's first bend, at (5, 5), and one's second, at (11, 5), each lie
        // on the other's line on the ground. Drawn, they sit off it.
        for (const [one, two] of lanes) {
          assert.isDefined(one);
          assert.isDefined(two);
          assert.isAbove(
            distanceToPolyline(one, two[1] ?? project({ x: 0, y: 0 })),
            1
          );
          assert.isAbove(
            distanceToPolyline(two, one[2] ?? project({ x: 0, y: 0 })),
            1
          );
        }
      })
  );

  it.effect("is quiet for two hops that cross at a right angle", () =>
    Effect.sync(() => {
      const map = groundMap(
        {
          a: { x: 0, y: 4 },
          b: { x: 10, y: 4 },
          c: { x: 5, y: 0 },
          d: { x: 5, y: 10 },
        },
        [
          { id: "across", from: "a", to: "b" },
          { id: "down", from: "c", to: "d" },
        ],
        {
          across: [
            { x: 2, y: 5 },
            { x: 10, y: 5 },
          ],
          down: [
            { x: 6, y: 2 },
            { x: 6, y: 10 },
          ],
        }
      );

      for (const clashes of groundClashesOf(map)) {
        assert.deepStrictEqual(clashes, []);
      }
    })
  );

  it.effect(
    "draws main → Updater and Upstream → Updater as two lines that end on Updater's edge",
    () =>
      Effect.gen(function* () {
        const { data, layout } = yield* fixture("flake-pipeline");
        const updater = placementOf(layout, "updater");

        for (const view of views) {
          const { hops } = sceneOf({
            data,
            layout,
            revealed: everything(data),
            view,
          });

          const lineOf = (id: string) =>
            Option.getOrThrow(Arr.findFirst(hops, ({ hop }) => hop.id === id))
              .points;

          const main = lineOf("h-main-updater");
          const upstream = lineOf("h-upstream-updater");
          const tips = [main.at(-1), upstream.at(-1)];
          const { toScreen } = groundProjections[view];

          const edge = [
            toScreen({ x: updater.x, y: updater.y + updater.d }),
            toScreen({ x: updater.x + updater.w, y: updater.y + updater.d }),
            toScreen({ x: updater.x + updater.w, y: updater.y }),
          ];

          for (const tip of tips) {
            assert.isDefined(tip);
            assert.isBelow(distanceToPolyline(edge, tip), 1e-6, view);
          }

          // The lines keep apart wherever they run side by side: each of
          // one's corners sits off the other's line, except where they cross.
          for (const [line, other] of [
            [main, upstream],
            [upstream, main],
          ] as const) {
            for (const point of line) {
              assert.isAbove(
                distanceToPolyline(other, point),
                1,
                `the two lines meet in ${view}`
              );
            }
          }
        }
      })
  );
});

/** Whether a point is inside a convex polygon, edges excluded. */
const insidePolygon = (polygon: readonly ScreenPoint[], point: ScreenPoint) => {
  const signs = Arr.map(polygon, (corner, index) => {
    const next = polygon[(index + 1) % polygon.length] ?? corner;

    return Math.sign(
      (next.sx - corner.sx) * (point.sy - corner.sy) -
        (next.sy - corner.sy) * (point.sx - corner.sx)
    );
  });

  return (
    Arr.every(signs, (sign) => sign > 0) || Arr.every(signs, (sign) => sign < 0)
  );
};

/** One arrowhead: its tip, the way it points, and the edge it is on. */
interface Head {
  readonly tip: ScreenPoint;
  readonly along: ScreenPoint;
}

/**
 * How far apart two heads' tips are across the direction the first points,
 * the part of the gap square to it.
 */
const acrossGap = (first: Head, second: Head) =>
  Math.abs(
    (second.tip.sx - first.tip.sx) * first.along.sy -
      (second.tip.sy - first.tip.sy) * first.along.sx
  ) / Math.max(Math.hypot(first.along.sx, first.along.sy), 1e-9);

describe("arrowheads", () => {
  it.effect(
    "keep a head width plus 3 px apart across their direction on one edge, on every fixture, in the Iso view",
    () =>
      Effect.gen(function* () {
        // The zoom that fits chapter 8 in a 1780×1020 window is 0.76; 0.4 is
        // the least a map is shown at, so heads must clear each other there.
        const fit = 0.4;
        const need = 2 * arrowHalfWidth * fit + 3;
        const closest: { readonly gap: number; readonly where: string }[] = [];

        for (const name of [
          "flake-pipeline",
          "review",
          "crowded",
          "shapes",
          "pipeline",
        ]) {
          const { data, layout } = yield* fixture(name);

          const chapters = Arr.isReadonlyArrayNonEmpty(data.chapters)
            ? chaptersOf(data)
            : [{ id: "all", plays: [], revealed: everything(data) }];

          for (const chapter of chapters) {
            const { hops } = sceneOf({
              data,
              layout,
              revealed: chapter.revealed,
              view: "iso",
            });

            // Each head: its tip, its direction, and the edge it is on.
            const heads = Arr.flatMap(hops, ({ hop, route, points }) => {
              const tip = points.at(-1);
              const before = points.at(-2);
              const last = route.points.at(-1);
              const back = route.points.at(-2);

              return tip === undefined ||
                before === undefined ||
                last === undefined ||
                back === undefined
                ? []
                : [
                    {
                      id: hop.id,
                      edge: `${hop.to}:${edgeOf(last, back)}`,
                      tip,
                      along: {
                        sx: tip.sx - before.sx,
                        sy: tip.sy - before.sy,
                      },
                    },
                  ];
            });

            closest.push(
              ...Arr.flatMap(heads, (first, index) =>
                Arr.flatMap(heads.slice(index + 1), (second) =>
                  first.edge === second.edge
                    ? [
                        {
                          gap: acrossGap(first, second) * fit,
                          where: `${name} ${chapter.id}: ${first.id} and ${second.id} on ${first.edge}`,
                        },
                      ]
                    : []
                )
              )
            );
          }
        }

        assert.isNotEmpty(closest);

        for (const { gap, where } of closest) {
          assert.isAtLeast(gap + 1e-6, need, where);
        }
      })
  );

  it.effect(
    "show exactly one head for each hop, solid or faint, on every fixture in either view",
    () =>
      Effect.gen(function* () {
        for (const name of [
          "flake-pipeline",
          "review",
          "crowded",
          "shapes",
          "pipeline",
        ]) {
          const { data, layout } = yield* fixture(name);

          const chapters = Arr.isReadonlyArrayNonEmpty(data.chapters)
            ? chaptersOf(data)
            : [{ id: "all", plays: [], revealed: everything(data) }];

          for (const chapter of chapters) {
            for (const view of views) {
              const scene = sceneOf({
                data,
                layout,
                revealed: chapter.revealed,
                view,
              });

              const outlines = Arr.map(
                scene.structures,
                ({ outline }) => outline
              );

              // A solid head is drawn under every box, so it shows only
              // where no box's outline covers its middle. The faint heads
              // are the hidden stretches that reach the end.
              const wrong = Arr.flatMap(scene.hops, (hop) => {
                const head = arrowheadOf(hop.points);

                const covered =
                  head !== undefined &&
                  Arr.some(outlines, (outline) =>
                    insidePolygon(outline, {
                      sx: (head.tip.sx + head.base.sx) / 2,
                      sy: (head.tip.sy + head.base.sy) / 2,
                    })
                  );

                const faint = Arr.filter(
                  hop.hidden,
                  ({ reachesEnd }) => reachesEnd
                );

                const heads = (covered ? 0 : 1) + faint.length;

                return heads === 1 ? [] : [`${hop.hop.id}: ${heads} heads`];
              });

              assert.deepStrictEqual(
                wrong,
                [],
                `in ${name} ${chapter.id}, ${view}`
              );
            }
          }
        }
      })
  );

  it.effect("reports two arrowheads that overlap", () =>
    Effect.sync(() => {
      const map = groundMap(
        { a: { x: 0, y: 0 }, b: { x: 6, y: 0 }, c: { x: 0, y: 4 } },
        [
          { id: "one", from: "a", to: "b" },
          { id: "two", from: "c", to: "b" },
        ],
        {}
      );

      for (const view of views) {
        const scene = sceneOf({ ...map, view });
        const [one, two] = scene.hops;

        assert.isDefined(one);
        assert.isDefined(two);

        // The router keeps the heads apart, so move the second hop's last
        // leg 2 px from the first's, where the heads overlap.
        const [tip, before] = [one.points.at(-1), one.points.at(-2)];

        assert.isDefined(tip);
        assert.isDefined(before);

        const moved = {
          ...scene,
          hops: [
            one,
            {
              ...two,
              points: [
                ...two.points.slice(0, -2),
                { sx: before.sx + 2, sy: before.sy + 2 },
                { sx: tip.sx + 2, sy: tip.sy + 2 },
              ],
            },
          ],
        };

        assert.include(
          Arr.map(sceneClashes(moved), clashKey),
          "arrow:one × arrow:two",
          view
        );
        assert.notInclude(
          Arr.map(sceneClashes(scene), clashKey),
          "arrow:one × arrow:two",
          view
        );
      }
    })
  );

  it.effect(
    "keep 3 px apart at fit where main → Updater and Upstream → Updater meet",
    () =>
      Effect.gen(function* () {
        const { data, layout } = yield* fixture("flake-pipeline");

        // The scale that fits chapter 8 in a 1780×1020 window.
        const fit = { iso: 0.76, plan: 0.5 };

        for (const view of views) {
          const { hops } = sceneOf({
            data,
            layout,
            revealed: everything(data),
            view,
          });

          const heads = Arr.flatMap(hops, ({ hop, points }) => {
            const polygon = arrowPolygon(points);

            return polygon === undefined ? [] : [{ id: hop.id, polygon }];
          });

          const gaps = Arr.flatMap(heads, (first, index) =>
            Arr.map(heads.slice(index + 1), (second) =>
              Math.min(
                ...Arr.map(first.polygon, (point) =>
                  distanceToPolyline(
                    [...second.polygon, second.polygon[0] ?? point],
                    point
                  )
                ),
                ...Arr.map(second.polygon, (point) =>
                  distanceToPolyline(
                    [...first.polygon, first.polygon[0] ?? point],
                    point
                  )
                )
              )
            )
          );

          assert.isAtLeast(Math.min(...gaps) * fit[view], 3, view);
        }
      })
  );
});
