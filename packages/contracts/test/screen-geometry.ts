import { Array as Arr } from "effect";

import type { ScreenPoint, ScreenRect } from "../src/index.ts";

// Distances on screen the tests measure drawings with, written out here
// rather than taken from the geometry the scene places things with, so a
// change there can't move the checks with it.

/** A rect's corners, clockwise from the top left. */
export const rectCorners = (rect: ScreenRect): readonly ScreenPoint[] => [
  { sx: rect.left, sy: rect.top },
  { sx: rect.right, sy: rect.top },
  { sx: rect.right, sy: rect.bottom },
  { sx: rect.left, sy: rect.bottom },
];

/** How far `point` is from the segment `from` to `to`, ends included. */
export const segmentDistance = (
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
export const lineDistance = (
  points: readonly ScreenPoint[],
  point: ScreenPoint
) => {
  const legs = Arr.zip(points, Arr.drop(points, 1));

  return Math.min(
    ...Arr.map(legs, ([from, to]) => segmentDistance(point, from, to))
  );
};
