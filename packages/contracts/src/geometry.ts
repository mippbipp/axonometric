import { Array as Arr } from "effect";
import { dual } from "effect/Function";

import type { ScreenPoint, ScreenRect } from "./iso.ts";

/** A straight piece of a line on screen. */
export interface Segment {
  readonly start: ScreenPoint;
  readonly end: ScreenPoint;
}

/** A share of a segment, from 0 at its start to 1 at its end. */
export interface Interval {
  readonly from: number;
  readonly to: number;
}

/** Overlaps thinner than this, in screen units, don't count. */
const tolerance = 1e-6;

/** A rect's corners, clockwise from the top left. */
export const rectPolygon = (rect: ScreenRect): readonly ScreenPoint[] => [
  { sx: rect.left, sy: rect.top },
  { sx: rect.right, sy: rect.top },
  { sx: rect.right, sy: rect.bottom },
  { sx: rect.left, sy: rect.bottom },
];

/** The smallest rect holding every point. */
export const boundsOfPoints = (points: readonly ScreenPoint[]): ScreenRect => {
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;

  for (const { sx, sy } of points) {
    left = Math.min(left, sx);
    top = Math.min(top, sy);
    right = Math.max(right, sx);
    bottom = Math.max(bottom, sy);
  }

  return { left, top, right, bottom };
};

/** A rect grown by `by` on every side. */
export const growRect: {
  (by: number): (rect: ScreenRect) => ScreenRect;
  (rect: ScreenRect, by: number): ScreenRect;
} = dual(2, (rect: ScreenRect, by: number): ScreenRect => ({
  left: rect.left - by,
  top: rect.top - by,
  right: rect.right + by,
  bottom: rect.bottom + by,
}));

const origin: ScreenPoint = { sx: 0, sy: 0 };

// The overlap test runs for every candidate spot of every piece of text, so
// it loops by hand instead of building arrays.

/**
 * Whether some edge normal of `edges` separates `a` from `b`: their
 * projections onto it are apart, or only touch.
 */
const separatedByEdgeOf = (
  edges: readonly ScreenPoint[],
  a: readonly ScreenPoint[],
  b: readonly ScreenPoint[]
) => {
  for (let index = 0; index < edges.length; index += 1) {
    const point = edges[index] ?? origin;
    const next = edges[(index + 1) % edges.length] ?? point;
    const ax = next.sy - point.sy;
    const ay = point.sx - next.sx;
    const slack = Math.hypot(ax, ay) * tolerance;
    let aMin = Number.POSITIVE_INFINITY;
    let aMax = Number.NEGATIVE_INFINITY;
    let bMin = Number.POSITIVE_INFINITY;
    let bMax = Number.NEGATIVE_INFINITY;

    for (const { sx, sy } of a) {
      const along = sx * ax + sy * ay;

      aMin = Math.min(aMin, along);
      aMax = Math.max(aMax, along);
    }

    for (const { sx, sy } of b) {
      const along = sx * ax + sy * ay;

      bMin = Math.min(bMin, along);
      bMax = Math.max(bMax, along);
    }

    if (!(aMin < bMax - slack && bMin < aMax - slack)) {
      return true;
    }
  }

  return false;
};

/**
 * Whether two convex polygons share area, by the separating axis test.
 * Polygons that only touch along an edge or at a corner don't.
 */
export const convexOverlap: {
  (b: readonly ScreenPoint[]): (a: readonly ScreenPoint[]) => boolean;
  (a: readonly ScreenPoint[], b: readonly ScreenPoint[]): boolean;
} = dual(
  2,
  (a: readonly ScreenPoint[], b: readonly ScreenPoint[]) =>
    !separatedByEdgeOf(a, a, b) && !separatedByEdgeOf(b, a, b)
);

/**
 * The share of a segment inside a convex polygon, by Cyrus-Beck clipping, or
 * `undefined` when none of it is.
 */
export const clipToConvex: {
  (polygon: readonly ScreenPoint[]): (segment: Segment) => Interval | undefined;
  (segment: Segment, polygon: readonly ScreenPoint[]): Interval | undefined;
} = dual(
  2,
  (segment: Segment, polygon: readonly ScreenPoint[]): Interval | undefined => {
    let cx = 0;
    let cy = 0;

    for (const { sx, sy } of polygon) {
      cx += sx;
      cy += sy;
    }

    cx /= polygon.length;
    cy /= polygon.length;

    let from = 0;
    let to = 1;

    // Each edge limits the segment: how far inside the edge its start sits,
    // and how that changes along it, measured towards the inside.
    for (let index = 0; index < polygon.length; index += 1) {
      const start = polygon[index] ?? origin;
      const end = polygon[(index + 1) % polygon.length] ?? start;
      const nx = end.sy - start.sy;
      const ny = start.sx - end.sx;

      const along = (sx: number, sy: number) =>
        nx * (sx - start.sx) + ny * (sy - start.sy);

      const inwards = along(cx, cy) > 0 ? 1 : -1;
      const offset = inwards * along(segment.start.sx, segment.start.sy);
      const rate = inwards * along(segment.end.sx, segment.end.sy) - offset;

      if (rate === 0) {
        if (offset <= 0) {
          return undefined;
        }
      } else if (rate > 0) {
        from = Math.max(from, -offset / rate);
      } else {
        to = Math.min(to, -offset / rate);
      }
    }

    return from < to ? { from, to } : undefined;
  }
);

export const segmentLength = ({ start, end }: Segment) =>
  Math.hypot(end.sx - start.sx, end.sy - start.sy);

/** The straight pieces of a polyline, in order. */
export const segmentsOf = (
  points: readonly ScreenPoint[]
): readonly (Segment & { readonly index: number })[] =>
  Arr.flatMap(points, (start, index) => {
    const end = points[index + 1];

    return end === undefined ? [] : [{ start, end, index }];
  });

/**
 * Whether a segment runs through a convex polygon for more than a sliver,
 * rather than just touching it.
 */
export const segmentCrosses: {
  (polygon: readonly ScreenPoint[]): (segment: Segment) => boolean;
  (segment: Segment, polygon: readonly ScreenPoint[]): boolean;
} = dual(2, (segment: Segment, polygon: readonly ScreenPoint[]) => {
  const inside = clipToConvex(segment, polygon);

  return (
    inside !== undefined &&
    (inside.to - inside.from) * segmentLength(segment) > 0.5
  );
});

/** The point a share `t` of the way from `from` to `to`. */
export const lerp = ({
  from,
  to,
  t,
}: {
  readonly from: ScreenPoint;
  readonly to: ScreenPoint;
  readonly t: number;
}): ScreenPoint => ({
  sx: from.sx + (to.sx - from.sx) * t,
  sy: from.sy + (to.sy - from.sy) * t,
});

/** How far a point sits from a polyline. */
export const distanceToPolyline: {
  (point: ScreenPoint): (points: readonly ScreenPoint[]) => number;
  (points: readonly ScreenPoint[], point: ScreenPoint): number;
} = dual(2, (points: readonly ScreenPoint[], point: ScreenPoint) => {
  let best = Number.POSITIVE_INFINITY;

  for (let index = 0; index + 1 < points.length; index += 1) {
    const start = points[index] ?? origin;
    const end = points[index + 1] ?? start;
    const dx = end.sx - start.sx;
    const dy = end.sy - start.sy;
    const length = dx * dx + dy * dy;

    const t =
      length === 0
        ? 0
        : Math.max(
            0,
            Math.min(
              1,
              ((point.sx - start.sx) * dx + (point.sy - start.sy) * dy) / length
            )
          );

    best = Math.min(
      best,
      Math.hypot(point.sx - (start.sx + dx * t), point.sy - (start.sy + dy * t))
    );
  }

  return best;
});
