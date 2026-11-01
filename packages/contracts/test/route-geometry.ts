import { Array as Arr } from "effect";

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
