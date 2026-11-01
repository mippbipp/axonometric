import type { Placement } from "@axonometric/contracts";
import { Array as Arr } from "effect";
import { dual } from "effect/Function";

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
export const tileWidth = 72;

export const tileHeight = 36;

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

/** A footprint's corners on screen, named by where they sit in the iso view. */
export interface Corners {
  readonly back: ScreenPoint;
  readonly right: ScreenPoint;
  readonly front: ScreenPoint;
  readonly left: ScreenPoint;
}

/** The four corners of a footprint, raised to height `z`. */
export const corners: {
  (z: number): (placement: Placement) => Corners;
  (placement: Placement, z: number): Corners;
} = dual(2, ({ x, y, w, d }: Placement, z: number): Corners => ({
  back: project({ x, y, z }),
  right: project({ x: x + w, y, z }),
  front: project({ x: x + w, y: y + d, z }),
  left: project({ x, y: y + d, z }),
}));

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
