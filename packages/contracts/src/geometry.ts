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
export const boundsOfPoints = (points: readonly ScreenPoint[]): ScreenRect => ({
  left: Math.min(...Arr.map(points, ({ sx }) => sx)),
  top: Math.min(...Arr.map(points, ({ sy }) => sy)),
  right: Math.max(...Arr.map(points, ({ sx }) => sx)),
  bottom: Math.max(...Arr.map(points, ({ sy }) => sy)),
});

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

const edgeNormals = (polygon: readonly ScreenPoint[]) =>
  Arr.map(polygon, (point, index) => {
    const next = polygon[(index + 1) % polygon.length] ?? point;

    return { sx: next.sy - point.sy, sy: point.sx - next.sx };
  });

const extentAlong = (polygon: readonly ScreenPoint[], axis: ScreenPoint) => {
  const values = Arr.map(
    polygon,
    (point) => point.sx * axis.sx + point.sy * axis.sy
  );

  return { min: Math.min(...values), max: Math.max(...values) };
};

/**
 * Whether two convex polygons share area, by the separating axis test.
 * Polygons that only touch along an edge or at a corner don't.
 */
export const convexOverlap: {
  (b: readonly ScreenPoint[]): (a: readonly ScreenPoint[]) => boolean;
  (a: readonly ScreenPoint[], b: readonly ScreenPoint[]): boolean;
} = dual(2, (a: readonly ScreenPoint[], b: readonly ScreenPoint[]) =>
  Arr.every([...edgeNormals(a), ...edgeNormals(b)], (axis) => {
    const first = extentAlong(a, axis);
    const second = extentAlong(b, axis);
    const scale = Math.hypot(axis.sx, axis.sy) * tolerance;

    return first.min < second.max - scale && second.min < first.max - scale;
  })
);

const centreOf = (polygon: readonly ScreenPoint[]): ScreenPoint => ({
  sx: Arr.reduce(polygon, 0, (sum, point) => sum + point.sx) / polygon.length,
  sy: Arr.reduce(polygon, 0, (sum, point) => sum + point.sy) / polygon.length,
});

/**
 * One edge's limit on a segment being clipped: how far inside the edge the
 * segment's start sits, and how that changes along the segment, measured
 * towards the polygon's inside.
 */
const edgeLimit = (
  { start, end }: Segment,
  edge: Segment,
  centre: ScreenPoint
) => {
  const normal = {
    sx: edge.end.sy - edge.start.sy,
    sy: edge.start.sx - edge.end.sx,
  };

  const along = (point: ScreenPoint) =>
    normal.sx * (point.sx - edge.start.sx) +
    normal.sy * (point.sy - edge.start.sy);

  const inwards = along(centre) > 0 ? 1 : -1;
  const offset = inwards * along(start);

  return { offset, rate: inwards * along(end) - offset };
};

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
    const centre = centreOf(polygon);

    const limits = Arr.map(polygon, (start, index) =>
      edgeLimit(
        segment,
        { start, end: polygon[(index + 1) % polygon.length] ?? start },
        centre
      )
    );

    const outside = Arr.some(
      limits,
      ({ offset, rate }) => rate === 0 && offset <= 0
    );

    const from = Math.max(
      0,
      ...Arr.flatMap(limits, ({ offset, rate }) =>
        rate > 0 ? [-offset / rate] : []
      )
    );

    const to = Math.min(
      1,
      ...Arr.flatMap(limits, ({ offset, rate }) =>
        rate < 0 ? [-offset / rate] : []
      )
    );

    return !outside && from < to ? { from, to } : undefined;
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
} = dual(2, (points: readonly ScreenPoint[], point: ScreenPoint) =>
  Math.min(
    Number.POSITIVE_INFINITY,
    ...Arr.map(segmentsOf(points), ({ start, end }) => {
      const length = (end.sx - start.sx) ** 2 + (end.sy - start.sy) ** 2;

      const t =
        length === 0
          ? 0
          : Math.max(
              0,
              Math.min(
                1,
                ((point.sx - start.sx) * (end.sx - start.sx) +
                  (point.sy - start.sy) * (end.sy - start.sy)) /
                  length
              )
            );

      const near = lerp({ from: start, to: end, t });

      return Math.hypot(point.sx - near.sx, point.sy - near.sy);
    })
  )
);
