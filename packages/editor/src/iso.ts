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

/** How far a label's nearest edge may sit from its leg, in screen units. */
const labelGaps = [3, 7, 12] as const;

/** Where along a leg a label may sit, most preferred first. */
const labelShares = [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8] as const;

const rectsOverlap = (a: ScreenRect, b: ScreenRect) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

const rectPolygon = (rect: ScreenRect): readonly ScreenPoint[] => [
  { sx: rect.left, sy: rect.top },
  { sx: rect.right, sy: rect.top },
  { sx: rect.right, sy: rect.bottom },
  { sx: rect.left, sy: rect.bottom },
];

interface Leg extends Segment {
  readonly index: number;
  readonly length: number;
}

/**
 * The spots a label of `width` may take beside a leg, nearest first: its
 * centre on the leg's perpendicular through a point `share` of the way
 * along, on either side, with its nearest edge `gap` from the leg.
 */
const spotsBeside = (leg: Leg, share: number, width: number) => {
  const at = lerp(leg.start, leg.end, share);
  const unit = Math.max(leg.length, 1e-9);

  const normal = {
    sx: -(leg.end.sy - leg.start.sy) / unit,
    sy: (leg.end.sx - leg.start.sx) / unit,
  };

  // How far the label's box reaches along the normal from its centre.
  const reach =
    (Math.abs(normal.sx) * width) / 2 + (Math.abs(normal.sy) * labelHeight) / 2;

  return Arr.flatMap(labelGaps, (gap) =>
    Arr.map([-1, 1] as const, (side) => {
      const centre = {
        sx: at.sx + side * normal.sx * (reach + gap),
        sy: at.sy + side * normal.sy * (reach + gap),
      };

      return {
        left: centre.sx - width / 2,
        right: centre.sx + width / 2,
        top: centre.sy - labelHeight / 2,
        bottom: centre.sy + labelHeight / 2,
      };
    })
  );
};

/**
 * How far along itself a label of `width` reaches, so a leg at least this
 * long has room for it.
 */
const roomNeeded = (leg: Leg, width: number) =>
  (Math.abs(leg.end.sx - leg.start.sx) * width +
    Math.abs(leg.end.sy - leg.start.sy) * labelHeight) /
  Math.max(leg.length, 1e-9);

/** The width of a hop label's box for `text`, in screen units. */
export const labelWidth = (text: string) =>
  text.length * tagCharWidth + 2 * labelPadding;

/** What a hop label keeps clear of. */
export interface LabelObstacles {
  /** Convex outlines: boxes, zone titles and the like. */
  readonly outlines: readonly (readonly ScreenPoint[])[];
  /** Rects: name tags and labels placed already. */
  readonly rects: readonly ScreenRect[];
  /** Lines: every hop's route, its own included. */
  readonly routes: readonly (readonly ScreenPoint[])[];
}

/**
 * Where a hop's label goes, as its box on screen. It sits beside one of the
 * route's legs, centred on the leg's perpendicular. Legs long enough for it
 * come first, longest first, then the rest; on each it tries the middle
 * first and spots further along after, close to the leg first. It takes the
 * first spot clear of every obstacle, or else the one that touches the
 * fewest.
 */
export const labelSpot = ({
  points,
  text,
  avoid,
}: {
  readonly points: readonly ScreenPoint[];
  readonly text: string;
  readonly avoid: LabelObstacles;
}): ScreenRect | undefined => {
  const width = labelWidth(text);

  const legs: readonly Leg[] = Arr.map(segmentsOf(points), (segment) => ({
    ...segment,
    length: lengthOf(segment),
  }));

  const order = Order.combine(
    Order.mapInput(Order.Number, (leg: Leg) =>
      leg.length >= roomNeeded(leg, width) ? 0 : 1
    ),
    Order.combine(
      Order.mapInput(Order.Number, (leg: Leg) => -leg.length),
      Order.mapInput(Order.Number, (leg: Leg) => leg.index)
    )
  );

  const candidates = Arr.flatMap(Arr.sort(legs, order), (leg: Leg) =>
    Arr.flatMap(labelShares, (share) => spotsBeside(leg, share, width))
  );

  const lines = Arr.flatMap(avoid.routes, segmentsOf);

  const clashes = (rect: ScreenRect) => {
    const box = rectPolygon(rect);

    return (
      Arr.filter(avoid.outlines, (outline) => tagCoversBox(rect, outline))
        .length +
      Arr.filter(avoid.rects, (other) => rectsOverlap(rect, other)).length +
      Arr.filter(lines, (line) => clipToConvex(line, box) !== undefined).length
    );
  };

  const clear = Arr.findFirst(candidates, (rect) => clashes(rect) === 0);

  return Option.getOrElse(clear, () =>
    Arr.isReadonlyArrayNonEmpty(candidates)
      ? Arr.min(
          candidates,
          Order.mapInput(Order.Number, (rect: ScreenRect) => clashes(rect))
        )
      : undefined
  );
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
