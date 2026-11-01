import type { Layout, Placement } from "@axonometric/contracts";
import { Array as Arr } from "effect";

/** A point on the ground grid, in grid units. */
export interface GridPoint {
  readonly x: number;
  readonly y: number;
}

/** A point on screen, in SVG user units. */
export interface ScreenPoint {
  readonly sx: number;
  readonly sy: number;
}

/** One grid unit is a 72 × 36 tile. */
const tileWidth = 72;

const tileHeight = 36;

/**
 * Projects a grid point onto the screen. `z` is a height above the ground in
 * screen units; it defaults to the ground.
 */
export const project = ({
  x,
  y,
  z = 0,
}: GridPoint & { readonly z?: number }): ScreenPoint => ({
  sx: ((x - y) * tileWidth) / 2,
  sy: ((x + y) * tileHeight) / 2 - z,
});

/** Formats screen points for an SVG `points` attribute. */
export const toPoints = (points: readonly ScreenPoint[]) =>
  Arr.join(
    Arr.map(points, (point) => `${point.sx},${point.sy}`),
    " "
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

/** The two footprints a hop runs between. */
export interface HopEnds {
  readonly from: Placement;
  readonly to: Placement;
}

/**
 * Routes a hop along the ground with at most one bend, from the edge of one
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

/**
 * A hop's route on screen, or `undefined` when either end has no placement.
 * Packets walk along these points.
 */
export const screenRouteOf = (
  layout: Layout,
  hop: { readonly from: string; readonly to: string }
): readonly ScreenPoint[] | undefined => {
  const from = layout.structures[hop.from];
  const to = layout.structures[hop.to];

  return from === undefined || to === undefined
    ? undefined
    : Arr.map(routeHop({ from, to }), project);
};

/**
 * The point a share `t` of the way along a polyline, by length. `t` runs from
 * 0 at the first point to 1 at the last.
 */
export const pointAlong = (
  points: readonly ScreenPoint[],
  t: number
): ScreenPoint => {
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
