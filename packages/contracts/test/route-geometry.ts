import { Array as Arr, Order } from "effect";

import { boxOutline, gridOnScreen } from "../src/index.ts";
import type {
  Placement,
  ScreenPoint,
  ScreenRect,
  Shape,
} from "../src/index.ts";

// The routing rules the tests check routes against, written out from the
// spec rather than taken from the router, so a router change can't move
// the goalposts with it.

/**
 * Whether `other` lies beyond each edge of `box`, in edge order +x, +y,
 * -x, -y: an edge faces the other end when the other footprint starts past
 * it.
 */
export const facingEdges = (
  box: Placement,
  other: Placement
): readonly boolean[] => [
  other.x >= box.x + box.w,
  other.y >= box.y + box.d,
  other.x + other.w <= box.x,
  other.y + other.d <= box.y,
];

/** One end of a hop: where it stands and what it's drawn as. */
export interface AreaEnd {
  readonly placement: Placement;
  readonly shape: Shape;
}

/** How far past its two boxes' silhouettes a route's area reaches. */
const areaMargin = 1.5;

/**
 * The screen area a route should stay within: the bounding box of its two
 * structures' silhouettes, widened by 1.5 grid units on each side.
 */
export const routeArea = (from: AreaEnd, to: AreaEnd): ScreenRect => {
  const points = [
    ...boxOutline(from.placement, from.shape),
    ...boxOutline(to.placement, to.shape),
  ];

  const margin = areaMargin * gridOnScreen;

  return {
    left: Math.min(...Arr.map(points, ({ sx }) => sx)) - margin,
    top: Math.min(...Arr.map(points, ({ sy }) => sy)) - margin,
    right: Math.max(...Arr.map(points, ({ sx }) => sx)) + margin,
    bottom: Math.max(...Arr.map(points, ({ sy }) => sy)) + margin,
  };
};

/** How far a screen point sits outside an area, in grid units. */
export const outsideArea = (area: ScreenRect, point: ScreenPoint) =>
  (Math.max(area.left - point.sx, 0, point.sx - area.right) +
    Math.max(area.top - point.sy, 0, point.sy - area.bottom)) /
  gridOnScreen;

/** One end of a route on a box: which edge, and whether it has a head. */
export interface EndOn {
  readonly edge: number;
  readonly head: boolean;
}

// Widths along an edge, in grid units, at the zoom of 0.4 the spacing is
// sized for: a head is 8 + 3 / 0.4 = 15.5 drawing units across, which on an
// iso face (32.2 units across per grid unit along the edge) is 0.49. A line
// with no head is much narrower.
const headWidth = 0.49;

const startWidth = 0.14;

const cornerMargin = 0.5;

/**
 * Whether the ends in `ends` and one more, `extra`, fit on one edge of
 * `length`: spaced half the sum of their neighbours' widths apart, at least
 * half a unit from each corner on an edge a unit long.
 */
const fitsOnEdge = (
  length: number,
  ends: readonly boolean[],
  extra: boolean
) => {
  const widths = Arr.sort(
    Arr.map([...ends, extra], (head) => (head ? headWidth : startWidth)),
    Order.Number
  );

  const [narrowest = 0, next = 0] = widths;

  const room =
    widths.length < 2
      ? 0
      : Arr.reduce(widths, 0, (sum, width) => sum + width) -
        (narrowest + next) / 2;

  const span = length < 1 ? length : length - 2 * cornerMargin;

  return room <= span + 1e-9;
};

/**
 * Whether every place on the edges of `box` that face `other` is taken by
 * another hop's end: no end of the kind `extra` fits on any of them. Only
 * then may a hop leave or enter `box` by a side or back edge.
 */
export const facingEdgesFull = (
  box: Placement,
  other: Placement,
  {
    taken,
    extra,
  }: { readonly taken: readonly EndOn[]; readonly extra: boolean }
) =>
  Arr.every(
    Arr.map(facingEdges(box, other), (faces, edge) => ({ faces, edge })),
    ({ faces, edge }) => {
      const length = edge % 2 === 0 ? box.d : box.w;

      const heads = Arr.map(
        Arr.filter(taken, (end) => end.edge === edge),
        ({ head }) => head
      );

      return !faces || !fitsOnEdge(length, heads, extra);
    }
  );
