import { assert, describe, it } from "@effect/vitest";
import {
  Array as Arr,
  Effect,
  Option,
  Record as Rec,
  Schema,
  String as Str,
} from "effect";

import {
  arrowheadOf,
  arrowLength,
  checkLayout,
  corners,
  endsOnTarget,
  facingEdges,
  Layout,
  MapData,
  routeCap,
  routeLength,
  routeRevealed,
  nameTagRect,
  nameTagText,
  outsideArea,
  project,
  routeArea,
  sceneClashes,
  sceneOf,
  segmentCrosses,
} from "../src/index.ts";
import type {
  GridPoint,
  Placement,
  ScreenPoint,
  ScreenRect,
} from "../src/index.ts";

/** A fixture map from the CLI's test fixtures, decoded. */
const fixture = (name: string) =>
  Effect.gen(function* () {
    const folder = new URL(
      `../../cli/test/fixtures/${name}/map/`,
      import.meta.url
    );

    const module: unknown = yield* Effect.promise(
      () => import(new URL("data.mjs", folder).href)
    );

    const layoutModule: unknown = yield* Effect.promise(
      () =>
        import(new URL("layout.json", folder).href, { with: { type: "json" } })
    );

    const data = yield* Schema.decodeUnknownEffect(
      Schema.Struct({ default: MapData })
    )(module);

    const layout: Layout = yield* Schema.decodeUnknownEffect(
      Schema.Struct({ default: Layout })
    )(layoutModule).pipe(Effect.map(({ default: value }) => value));

    return { data: data.default, layout };
  }).pipe(Effect.orDie);

/** What each chapter shows: its reveals and every earlier chapter's. */
const chaptersOf = (data: MapData) =>
  Arr.map(data.chapters, (chapter, index) => ({
    id: chapter.id,
    plays: chapter.plays,
    revealed: new Set(
      Arr.flatMap(data.chapters.slice(0, index + 1), ({ reveals }) => reveals)
    ),
  }));

const everything = (data: MapData) =>
  new Set(Arr.map(data.structures, ({ id }) => id));

/** Which edge of a footprint a point sits on: +x, +y, -x or -y. */
const edgeOf = (point: GridPoint, box: Placement) => {
  if (point.x === box.x + box.w) {
    return 0;
  }

  if (point.y === box.y + box.d) {
    return 1;
  }

  return point.x === box.x ? 2 : 3;
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
 * - h-upstream-updater: Updater's name tag hangs under its front corner, so
 *   the hop comes in at Updater's +x face, and main sits on every way down
 *   Upstream's -x face that would keep the bends inside. The route bends
 *   2.08 units outside its area.
 */
const chapterOneExceptions = new Set(["h-upstream-updater"]);

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
const fewestStrayClear = (
  map: { readonly data: MapData; readonly layout: Layout },
  hop: { readonly from: string; readonly to: string },
  revealed: ReadonlySet<string>
) => {
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

  return Math.min(
    Number.POSITIVE_INFINITY,
    ...Arr.flatMap(candidates, (points) =>
      clear(points) ? [strayOf(map, hop, points)] : []
    )
  );
};

const placementOf = (layout: Layout, id: string): Placement => {
  const placement = layout.structures[id];

  assert.isDefined(placement, `${id} has no placement`);

  return placement;
};

const distance = (a: ScreenPoint, b: ScreenPoint) =>
  Math.hypot(a.sx - b.sx, a.sy - b.sy);

/** How far a point sits from the segment between `a` and `b`. */
const offSegment = (point: ScreenPoint, a: ScreenPoint, b: ScreenPoint) => {
  const length = distance(a, b);

  const across =
    ((b.sx - a.sx) * (a.sy - point.sy) - (a.sx - point.sx) * (b.sy - a.sy)) /
    length;

  return Math.abs(across);
};

describe("scene", () => {
  for (const name of ["flake-pipeline", "review", "crowded"]) {
    it.effect(`draws nothing over anything in any chapter of ${name}`, () =>
      Effect.gen(function* () {
        const { data, layout } = yield* fixture(name);

        for (const chapter of chaptersOf(data)) {
          const scene = sceneOf({
            data,
            layout,
            revealed: chapter.revealed,
            labelFirst: chapter.plays,
          });

          // The crowded map walls the vault in on purpose, so its only
          // allowed clashes are the walls' boxes over the vault's.
          const clashes = Arr.filter(
            sceneClashes(scene),
            ({ between }) => !(name === "crowded" && between[1] === "box:vault")
          );

          assert.deepStrictEqual(clashes, [], `in chapter ${chapter.id}`);
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
          assert.isTrue(
            endsOnTarget(hop, placementOf(layout, hop.hop.to)),
            `${hop.hop.id} ends off its target`
          );
          assert.isBelow(offSegment(head.base, before, head.tip), 1e-6);
          assert.closeTo(distance(head.base, head.tip), arrowLength, 1e-6);
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
            const measured = routeLength(route.points);

            assert.isTrue(
              measured.length <= routeCap(measured.distance) ||
                warned.has(`routes["${id}"]`),
              `${id} in ${chapter.id}: ${measured.length} units for ends ${measured.distance} apart`
            );
          }
        }
      })
  );

  it.effect(
    "leaves and enters every pipeline route by the edges facing the other end",
    () =>
      Effect.gen(function* () {
        const { data, layout } = yield* fixture("flake-pipeline");

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
              const [first] = route.points;
              const last = route.points.at(-1);

              assert.isDefined(first);
              assert.isDefined(last);
              assert.isTrue(
                facingEdges(source, target)[edgeOf(first, source)],
                `${hop.id} leaves by an edge facing away in ${chapter.id}`
              );
              assert.isTrue(
                facingEdges(target, source)[edgeOf(last, target)],
                `${hop.id} enters by an edge facing away in ${chapter.id}`
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
            // The exception holds only while nothing better exists.
            assert.isAbove(
              fewestStrayClear({ data, layout }, hop, first.revealed),
              0,
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
