import {
  project,
  routeHops,
  tagCharWidth,
  tagCoversBox,
} from "@axonometric/contracts";
import type {
  HopRoute,
  Layout,
  MapData,
  ScreenPoint,
  ScreenRect,
} from "@axonometric/contracts";
import { Array as Arr, Option, Order } from "effect";

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

const routeCache = new WeakMap<
  MapData,
  WeakMap<Layout, Readonly<Record<string, HopRoute>>>
>();

/**
 * Every hop's route on the ground, from the contracts router. Routing the
 * same data and layout again returns the same object, so the iso view and
 * the packets share one routing pass.
 */
export const routesOf = ({
  data,
  layout,
}: {
  readonly data: MapData;
  readonly layout: Layout;
}): Readonly<Record<string, HopRoute>> => {
  const byLayout =
    routeCache.get(data) ??
    new WeakMap<Layout, Readonly<Record<string, HopRoute>>>();

  const cached = byLayout.get(layout);

  if (cached !== undefined) {
    return cached;
  }

  const routes = routeHops(data, layout);

  byLayout.set(layout, routes);
  routeCache.set(data, byLayout);

  return routes;
};

/**
 * A hop's route on screen, or `undefined` when it has none, such as when
 * either end has no placement. Packets walk along these points.
 */
export const screenRouteOf = ({
  data,
  layout,
  hop,
}: {
  readonly data: MapData;
  readonly layout: Layout;
  readonly hop: { readonly id: string };
}): readonly ScreenPoint[] | undefined => {
  const route = routesOf({ data, layout })[hop.id];

  return route === undefined ? undefined : Arr.map(route.points, project);
};

interface Interval {
  readonly from: number;
  readonly to: number;
}

interface Segment {
  readonly start: ScreenPoint;
  readonly end: ScreenPoint;
}

const centreOf = (polygon: readonly ScreenPoint[]): ScreenPoint => ({
  sx: Arr.reduce(polygon, 0, (sum, point) => sum + point.sx) / polygon.length,
  sy: Arr.reduce(polygon, 0, (sum, point) => sum + point.sy) / polygon.length,
});

/**
 * One edge's limit on a segment being clipped: how far inside the edge the
 * segment's start sits, and how fast that changes along the segment, both
 * measured towards the polygon's inside.
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
const clipToConvex = (
  segment: Segment,
  polygon: readonly ScreenPoint[]
): Interval | undefined => {
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
    ({ offset, rate }) => rate === 0 && offset < 0
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
};

const byStart = Order.mapInput(Order.Number, ({ from }: Interval) => from);

/** Merges overlapping intervals, in order. */
const merge = (intervals: readonly Interval[]): readonly Interval[] =>
  Arr.reduce(
    Arr.sort(intervals, byStart),
    Arr.empty<Interval>(),
    (merged, interval) => {
      const last = merged.at(-1);

      return last !== undefined && interval.from <= last.to
        ? [
            ...merged.slice(0, -1),
            { from: last.from, to: Math.max(last.to, interval.to) },
          ]
        : [...merged, interval];
    }
  );

const lerp = (a: ScreenPoint, b: ScreenPoint, t: number): ScreenPoint => ({
  sx: a.sx + (b.sx - a.sx) * t,
  sy: a.sy + (b.sy - a.sy) * t,
});

const lengthOf = ({ start, end }: Segment) =>
  Math.hypot(end.sx - start.sx, end.sy - start.sy);

const segmentsOf = (points: readonly ScreenPoint[]) =>
  Arr.flatMap(points, (start, index) => {
    const end = points[index + 1];

    return end === undefined ? [] : [{ start, end, index }];
  });

/** Stretches shorter than this, in screen units, aren't worth redrawing. */
const shortestStretch = 1;

/** A stretch of a route that a box is drawn over. */
export interface HiddenStretch {
  readonly points: readonly ScreenPoint[];
  /** Whether the stretch runs to the route's end, so it needs the arrowhead. */
  readonly reachesEnd: boolean;
}

interface Piece {
  readonly leg: number;
  readonly from: number;
  readonly to: number;
  readonly a: ScreenPoint;
  readonly b: ScreenPoint;
}

interface Stretch {
  readonly points: readonly ScreenPoint[];
  readonly last: Piece;
}

/** Joins pieces that meet at a bend into one stretch. */
const joinPieces = (pieces: readonly Piece[]) =>
  Arr.reduce(pieces, Arr.empty<Stretch>(), (stretches, piece) => {
    const last = stretches.at(-1);

    const continues =
      last !== undefined &&
      last.last.leg === piece.leg - 1 &&
      last.last.to === 1 &&
      piece.from === 0;

    return continues
      ? [
          ...stretches.slice(0, -1),
          { points: [...last.points, piece.b], last: piece },
        ]
      : [...stretches, { points: [piece.a, piece.b], last: piece }];
  });

/**
 * The stretches of a route on the ground that boxes are drawn over: the
 * parts of its polyline inside a box's outline. Routes are drawn on the
 * ground before every box, so in the painter's order any box whose outline
 * reaches over a stretch hides it, whichever structure the box belongs to.
 * `outlines` must be convex, as `boxOutline` gives.
 */
export const hiddenStretches = ({
  points,
  outlines,
}: {
  readonly points: readonly ScreenPoint[];
  readonly outlines: readonly (readonly ScreenPoint[])[];
}): readonly HiddenStretch[] => {
  const pieces = Arr.flatMap(segmentsOf(points), (segment) => {
    const length = lengthOf(segment);

    const inside = merge(
      Arr.flatMap(outlines, (outline) =>
        Option.toArray(Option.fromNullishOr(clipToConvex(segment, outline)))
      )
    );

    return Arr.flatMap(inside, ({ from, to }) =>
      (to - from) * length < shortestStretch
        ? []
        : [
            {
              leg: segment.index,
              from,
              to,
              a: lerp(segment.start, segment.end, from),
              b: lerp(segment.start, segment.end, to),
            },
          ]
    );
  });

  const lastLeg = points.length - 2;

  return Arr.map(joinPieces(pieces), (stretch) => ({
    points: stretch.points,
    reachesEnd: stretch.last.leg === lastLeg && stretch.last.to === 1,
  }));
};

/** How tall a hop label's box is, in screen units. */
export const labelHeight = 15;

/** Room left either side of a label's text, in screen units. */
const labelPadding = 3;

/** How far a label sits from its leg, in screen units. */
const labelGap = 3;

/** Where along a leg a label may sit, most preferred first. */
const labelShares = [0.5, 0.35, 0.65, 0.2, 0.8] as const;

const rectsOverlap = (a: ScreenRect, b: ScreenRect) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

interface Leg {
  readonly index: number;
  readonly length: number;
}

const longestFirst = Order.combine(
  Order.mapInput(Order.Number, ({ length }: Leg) => -length),
  Order.mapInput(Order.Number, ({ index }: Leg) => index)
);

/**
 * The spots beside a point on a leg a label may take. A label sits on the
 * side the leg runs away from, so the line passes its corner and never
 * crosses the text.
 */
const spotsBeside = (segment: Segment, share: number, width: number) => {
  const at = lerp(segment.start, segment.end, share);

  const fallsRight =
    (segment.end.sx - segment.start.sx) * (segment.end.sy - segment.start.sy) >
    0;

  const above = {
    top: at.sy - labelGap - labelHeight,
    bottom: at.sy - labelGap,
  };

  const below = {
    top: at.sy + labelGap,
    bottom: at.sy + labelGap + labelHeight,
  };

  const right = { left: at.sx + labelGap, right: at.sx + labelGap + width };
  const left = { left: at.sx - labelGap - width, right: at.sx - labelGap };

  return fallsRight
    ? [
        { ...above, ...right },
        { ...below, ...left },
      ]
    : [
        { ...above, ...left },
        { ...below, ...right },
      ];
};

/** The width of a hop label's box for `text`, in screen units. */
export const labelWidth = (text: string) =>
  text.length * tagCharWidth + 2 * labelPadding;

/**
 * Where a hop's label goes, as its box on screen. It tries the longest leg
 * first, then the others, longest first, at a few spots along each, and
 * takes the first spot clear of every box outline and of every rect in
 * `taken`, such as name tags and labels placed already. When no spot is
 * clear it takes the middle of the longest leg.
 */
export const labelSpot = ({
  points,
  text,
  outlines,
  taken,
}: {
  readonly points: readonly ScreenPoint[];
  readonly text: string;
  readonly outlines: readonly (readonly ScreenPoint[])[];
  readonly taken: readonly ScreenRect[];
}): ScreenRect | undefined => {
  const width = labelWidth(text);

  const legs = Arr.sort(
    Arr.map(segmentsOf(points), (segment) => ({
      ...segment,
      length: lengthOf(segment),
    })),
    longestFirst
  );

  const candidates = Arr.flatMap(legs, (leg) =>
    Arr.flatMap(labelShares, (share) => spotsBeside(leg, share, width))
  );

  const clear = Arr.findFirst(
    candidates,
    (rect) =>
      Arr.every(outlines, (outline) => !tagCoversBox(rect, outline)) &&
      Arr.every(taken, (other) => !rectsOverlap(rect, other))
  );

  return Option.getOrElse(clear, () => candidates[0]);
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
