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

/**
 * How many pixels of the segment from `start` to `end` lie inside the convex
 * polygon. Each edge keeps the part of the segment on the polygon's side of
 * it, the side its centre is on.
 */
const lengthInside = (
  start: ScreenPoint,
  end: ScreenPoint,
  polygon: readonly ScreenPoint[]
) => {
  const count = Math.max(polygon.length, 1);

  const centre = {
    sx: Arr.reduce(polygon, 0, (sum, { sx }) => sum + sx) / count,
    sy: Arr.reduce(polygon, 0, (sum, { sy }) => sum + sy) / count,
  };

  let from = 0;
  let to = 1;

  for (const [index, corner] of polygon.entries()) {
    const next = polygon[(index + 1) % polygon.length] ?? corner;

    // How far a point is inside this edge, along its normal.
    const inside = ({ sx, sy }: ScreenPoint) => {
      const side =
        (next.sx - corner.sx) * (sy - corner.sy) -
        (next.sy - corner.sy) * (sx - corner.sx);

      const centreSide =
        (next.sx - corner.sx) * (centre.sy - corner.sy) -
        (next.sy - corner.sy) * (centre.sx - corner.sx);

      return centreSide < 0 ? -side : side;
    };

    const atStart = inside(start);
    const atEnd = inside(end);

    if (atStart <= 0 && atEnd <= 0) {
      return 0;
    }

    if (atStart < 0) {
      from = Math.max(from, atStart / (atStart - atEnd));
    } else if (atEnd < 0) {
      to = Math.min(to, atStart / (atStart - atEnd));
    }
  }

  return (
    Math.max(to - from, 0) * Math.hypot(end.sx - start.sx, end.sy - start.sy)
  );
};

/**
 * Whether the segment from `start` to `end` runs through a convex polygon for
 * more than half a pixel, rather than just touching it.
 */
export const crossesPolygon = (
  { start, end }: { readonly start: ScreenPoint; readonly end: ScreenPoint },
  polygon: readonly ScreenPoint[]
) => lengthInside(start, end, polygon) > 0.5;

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
