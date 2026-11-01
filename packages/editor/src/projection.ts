import {
  groundProjections,
  laneRoutes,
  laneWidths,
  routeRevealed,
} from "@axonometric/contracts";
import type {
  GridPoint,
  GridPosition,
  GroundProjection,
  HopRoute,
  Layout,
  MapData,
  Placement,
  ScreenPoint,
  View,
} from "@axonometric/contracts";
import { Array as Arr, Order } from "effect";
import { dual } from "effect/Function";

export {
  corners,
  project,
  tileHeight,
  tileWidth,
} from "@axonometric/contracts";

export type { Corners, ScreenPoint } from "@axonometric/contracts";

/** Formats screen points for an SVG `points` attribute. */
export const toPoints = (points: readonly ScreenPoint[]) =>
  Arr.join(
    Arr.map(points, (point) => `${point.sx},${point.sy}`),
    " "
  );

/**
 * A footprint's ground outline on screen in one view, from its corner at
 * the smallest x and y round to the opposite corner.
 */
export const groundOutline: {
  (ground: GroundProjection): (placement: Placement) => readonly ScreenPoint[];
  (placement: Placement, ground: GroundProjection): readonly ScreenPoint[];
} = dual(
  2,
  (
    { x, y, w, d }: Placement,
    ground: GroundProjection
  ): readonly ScreenPoint[] => [
    ground.toScreen({ x, y }),
    ground.toScreen({ x: x + w, y }),
    ground.toScreen({ x: x + w, y: y + d }),
    ground.toScreen({ x, y: y + d }),
  ]
);

const centre = (placement: Placement): GridPoint => ({
  x: placement.x + placement.w / 2,
  y: placement.y + placement.d / 2,
});

const contains = (placement: Placement, point: GridPoint) =>
  point.x >= placement.x &&
  point.x <= placement.x + placement.w &&
  point.y >= placement.y &&
  point.y <= placement.y + placement.d;

/**
 * Moves `from`, the centre of `placement`, along the axis-aligned segment
 * towards `towards` until it reaches the footprint's edge. Leaves it at the
 * centre when `towards` is inside the footprint too.
 */
const toEdge = (
  from: GridPoint,
  towards: GridPoint,
  placement: Placement
): GridPoint => {
  if (contains(placement, towards)) {
    return from;
  }

  if (from.x === towards.x) {
    return {
      x: from.x,
      y: towards.y > from.y ? placement.y + placement.d : placement.y,
    };
  }

  return {
    x: towards.x > from.x ? placement.x + placement.w : placement.x,
    y: from.y,
  };
};

const samePoint = (a: GridPoint, b: GridPoint) => a.x === b.x && a.y === b.y;

/** The two footprints a link in the inside view runs between. */
export interface HopEnds {
  readonly from: Placement;
  readonly to: Placement;
}

/**
 * Routes a link between two steps of the inside view along the ground with
 * at most one bend, from the edge of one
 * footprint to the edge of the other. Of the two bends it takes the one whose
 * last leg reaches the target's front edge (its +x or +y side), where the
 * target's box can't hide the arrowhead. When neither or both do, it bends x
 * first.
 */
export const routeHop = ({ from, to }: HopEnds): readonly GridPoint[] => {
  const start = centre(from);
  const end = centre(to);
  const yFirstArrivesInFront = start.x > end.x && start.y <= end.y;

  const bend = yFirstArrivesInFront
    ? { x: start.x, y: end.y }
    : { x: end.x, y: start.y };

  if (samePoint(bend, start) || samePoint(bend, end)) {
    return [toEdge(start, end, from), toEdge(end, start, to)];
  }

  return [toEdge(start, bend, from), bend, toEdge(end, bend, to)];
};

const routeCache = new WeakMap<
  MapData,
  WeakMap<Layout, Map<string, Readonly<Record<string, HopRoute>>>>
>();

const keyOf = (revealed: ReadonlySet<string>) =>
  Arr.join(Arr.sort([...revealed], Order.String), "\n");

/**
 * Every revealed hop's route on the ground, routed around the revealed
 * structures only, from the contracts router. Routing the same data, layout
 * and set again returns the same object, so the Iso view and the packets
 * share one routing pass.
 */
export const routesOf = ({
  data,
  layout,
  revealed,
}: {
  readonly data: MapData;
  readonly layout: Layout;
  readonly revealed: ReadonlySet<string>;
}): Readonly<Record<string, HopRoute>> => {
  const byLayout =
    routeCache.get(data) ??
    new WeakMap<Layout, Map<string, Readonly<Record<string, HopRoute>>>>();

  const bySet =
    byLayout.get(layout) ??
    new Map<string, Readonly<Record<string, HopRoute>>>();

  const key = keyOf(revealed);
  const cached = bySet.get(key);

  if (cached !== undefined) {
    return cached;
  }

  const routes = routeRevealed({ data, layout, revealed });

  bySet.set(key, routes);
  byLayout.set(layout, bySet);
  routeCache.set(data, byLayout);

  return routes;
};

const laneCache = new WeakMap<
  Readonly<Record<string, HopRoute>>,
  Map<View, Readonly<Record<string, readonly GridPosition[]>>>
>();

/** Each routed hop's own line on the ground in `view`, as the scene draws it. */
const lanesOf = (
  routes: Readonly<Record<string, HopRoute>>,
  view: View
): Readonly<Record<string, readonly GridPosition[]>> => {
  const byView =
    laneCache.get(routes) ??
    new Map<View, Readonly<Record<string, readonly GridPosition[]>>>();

  const cached = byView.get(view);

  if (cached !== undefined) {
    return cached;
  }

  const lanes = laneRoutes(routes, laneWidths[view]);

  byView.set(view, lanes);
  laneCache.set(routes, byView);

  return lanes;
};

/**
 * A hop's line on screen in `view`, its own lane of its route as the scene
 * draws it, or `undefined` when it has none, such as when either end isn't
 * revealed. Packets walk along these points.
 */
export const screenRouteOf = ({
  data,
  layout,
  revealed,
  hop,
  view,
}: {
  readonly data: MapData;
  readonly layout: Layout;
  readonly revealed: ReadonlySet<string>;
  readonly hop: { readonly id: string };
  readonly view: View;
}): readonly ScreenPoint[] | undefined => {
  const line = lanesOf(routesOf({ data, layout, revealed }), view)[hop.id];

  return line === undefined
    ? undefined
    : Arr.map(line, groundProjections[view].toScreen);
};

/**
 * The point a share `t` of the way along a polyline, by length. `t` runs from
 * 0 at the first point to 1 at the last.
 */
export const pointAlong = ({
  points,
  t,
}: {
  readonly points: readonly ScreenPoint[];
  readonly t: number;
}): ScreenPoint => {
  const legs = Arr.flatMap(points, (point, index) => {
    const next = points[index + 1];

    return next === undefined
      ? []
      : [
          {
            start: point,
            end: next,
            length: Math.hypot(next.sx - point.sx, next.sy - point.sy),
          },
        ];
  });

  const total = Arr.reduce(legs, 0, (sum, leg) => sum + leg.length);
  let left = Math.max(0, Math.min(1, t)) * total;

  for (const leg of legs) {
    if (left <= leg.length && leg.length > 0) {
      const share = left / leg.length;

      return {
        sx: leg.start.sx + (leg.end.sx - leg.start.sx) * share,
        sy: leg.start.sy + (leg.end.sy - leg.start.sy) * share,
      };
    }

    left -= leg.length;
  }

  return points.at(-1) ?? { sx: 0, sy: 0 };
};
