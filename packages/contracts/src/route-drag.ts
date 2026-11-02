import { Array as Arr, Option, Order } from "effect";

import { endRange } from "./ends.ts";
import { routeCorners } from "./lanes.ts";
import { onOutline } from "./layout-checks.ts";
import type { GridPoint, Placement } from "./layout.ts";

/**
 * A route's ends and bends, in grid units: repeated points and points in a
 * straight line are dropped. A segment of a route is the stretch between two
 * neighbouring vertices, and `dragSegment` counts segments this way.
 */
export const routeVertices = (
  points: readonly GridPoint[]
): readonly GridPoint[] =>
  Arr.map(routeCorners(points), ({ x, y }) => ({ x: x / 2, y: y / 2 }));

type Axis = "x" | "y";

const crossAxis = (axis: Axis): Axis => (axis === "x" ? "y" : "x");

/** The axis a leg between two points runs along. */
const axisOf = (a: GridPoint, b: GridPoint): Axis => (a.y === b.y ? "x" : "y");

const startOf = (box: Placement, axis: Axis) => (axis === "x" ? box.x : box.y);

const sizeOf = (box: Placement, axis: Axis) => (axis === "x" ? box.w : box.d);

/** The point at `along` on `axis` and `across` on the other axis. */
const pointAt = (axis: Axis, along: number, across: number): GridPoint =>
  axis === "x" ? { x: along, y: across } : { x: across, y: along };

/** `point` with its `axis` coordinate set to `value`. */
const withCoordinate = (
  point: GridPoint,
  axis: Axis,
  value: number
): GridPoint =>
  axis === "x" ? { ...point, x: value } : { ...point, y: value };

/** How far a route runs straight out of or into a footprint, at least. */
const stubLength = 0.5;

/** Rounds to the nearest half unit, the same way either side of zero. */
const snapHalf = (value: number) =>
  Math.sign(value) * (Math.round(Math.abs(value) * 2) / 2);

interface Lateral {
  readonly low: number;
  readonly high: number;
}

/** Where a leg along an axis meets a footprint. */
interface Meeting {
  /** The edge's coordinate on the leg's axis. */
  readonly edge: number;
  /** Which way is out of the footprint there, along the leg's axis. */
  readonly out: 1 | -1;
  /** The stretch of the edge an end may take, clear of the corners. */
  readonly lateral: Lateral;
}

/**
 * The edge of `box` that a leg along `axis` meets, at `coordinate` on that
 * axis: the nearer of the footprint's two edges across the axis.
 */
const meetingOf = (box: Placement, axis: Axis, coordinate: number): Meeting => {
  const low = startOf(box, axis);
  const high = low + sizeOf(box, axis);
  const across = crossAxis(axis);
  const range = endRange(sizeOf(box, across));
  const near = Math.abs(coordinate - low) <= Math.abs(coordinate - high);

  return {
    edge: near ? low : high,
    out: near ? -1 : 1,
    lateral: {
      low: startOf(box, across) + range.low,
      high: startOf(box, across) + range.high,
    },
  };
};

const unbounded: Lateral = { low: -Infinity, high: Infinity };

const clamp = (value: number, { low, high }: Lateral) =>
  Math.min(Math.max(value, low), high);

const outside = (value: number, { low, high }: Lateral) =>
  value < low || value > high;

/** `value`, or the nearest value a stub's length out of the footprint at `meeting`. */
const pushedOut = (value: number, { edge, out }: Meeting) =>
  out > 0
    ? Math.max(value, edge + stubLength)
    : Math.min(value, edge - stubLength);

/** The two footprints a route runs between. */
export interface RouteEnds {
  readonly from: Placement;
  readonly to: Placement;
}

/** The first two and last two vertices of a route, which its end legs run between. */
interface EndLegs {
  readonly first: GridPoint;
  readonly second: GridPoint;
  readonly before: GridPoint;
  readonly last: GridPoint;
}

/** The end legs of `vertices`, or nothing when it has fewer than two points. */
const endLegsOf = (vertices: readonly GridPoint[]): EndLegs | undefined => {
  const [first, second] = vertices;
  const last = vertices.at(-1);
  const before = vertices.at(-2);

  return first === undefined ||
    second === undefined ||
    last === undefined ||
    before === undefined
    ? undefined
    : { first, second, before, last };
};

/** What a route must keep, as `check` requires, to be drawn between two footprints. */
interface Keeping {
  readonly ends: RouteEnds;
  readonly startAxis: Axis;
  readonly endAxis: Axis;
  readonly exit: Meeting;
  readonly entry: Meeting;
}

/**
 * Whether `vertices` has each end on its footprint's outline, with the first
 * leg running at least a stub straight out of the source and the last leg at
 * least a stub straight into the target.
 */
const keeps = (
  vertices: readonly GridPoint[],
  { ends, startAxis, endAxis, exit, entry }: Keeping
) => {
  const legs = endLegsOf(vertices);

  if (legs === undefined) {
    return false;
  }

  const { first, second, before, last } = legs;

  return (
    onOutline(first, ends.from) &&
    onOutline(last, ends.to) &&
    second[crossAxis(startAxis)] === first[crossAxis(startAxis)] &&
    (second[startAxis] - first[startAxis]) * exit.out >= stubLength &&
    before[crossAxis(endAxis)] === last[crossAxis(endAxis)] &&
    (before[endAxis] - last[endAxis]) * entry.out >= stubLength
  );
};

/** The ends of a route and the legs next to them. */
interface Anatomy {
  readonly vertices: readonly GridPoint[];
  readonly startAxis: Axis;
  readonly endAxis: Axis;
  readonly exit: Meeting;
  readonly entry: Meeting;
}

const anatomyOf = (
  vertices: readonly GridPoint[],
  ends: RouteEnds
): Anatomy | undefined => {
  const legs = endLegsOf(vertices);

  if (legs === undefined) {
    return undefined;
  }

  const { first, second, before, last } = legs;
  const startAxis = axisOf(first, second);
  const endAxis = axisOf(before, last);

  return {
    vertices,
    startAxis,
    endAxis,
    exit: meetingOf(ends.from, startAxis, first[startAxis]),
    entry: meetingOf(ends.to, endAxis, last[endAxis]),
  };
};

/** `vertices` with segment `segment` moved to `line` across its own axis. */
const withSegmentAt = ({
  vertices,
  segment,
  moves,
  line,
}: {
  readonly vertices: readonly GridPoint[];
  readonly segment: number;
  readonly moves: Axis;
  readonly line: number;
}) =>
  Arr.map(vertices, (vertex, index) =>
    index === segment || index === segment + 1
      ? withCoordinate(vertex, moves, line)
      : vertex
  );

/**
 * The route with its first end jogged: out of the footprint half a unit at
 * the nearest point of the edge range, then across to `line`, where the
 * dragged segment is. The same goes for the last end, mirrored.
 */
const jogged = ({
  moved,
  line,
  anatomy,
  jogs,
}: {
  readonly moved: readonly GridPoint[];
  readonly line: number;
  readonly anatomy: Anatomy;
  readonly jogs: { readonly start: boolean; readonly end: boolean };
}) =>
  Arr.flatMap(moved, (vertex, index) => {
    const { startAxis, endAxis, exit, entry } = anatomy;

    if (index === 0 && jogs.start) {
      const along = exit.edge + exit.out * stubLength;
      const held = clamp(line, exit.lateral);

      return [
        pointAt(startAxis, exit.edge, held),
        pointAt(startAxis, along, held),
        pointAt(startAxis, along, line),
      ];
    }

    if (index === moved.length - 1 && jogs.end) {
      const along = entry.edge + entry.out * stubLength;
      const held = clamp(line, entry.lateral);

      return [
        pointAt(endAxis, along, line),
        pointAt(endAxis, along, held),
        pointAt(endAxis, entry.edge, held),
      ];
    }

    return [vertex];
  });

/**
 * The route after dragging one segment of it by `offset` on the ground,
 * square to the segment. `segment` counts along `routeVertices(points)`. The
 * offset snaps to half units. The segments either side stretch to stay joined
 * to it, and a segment dragged in line with its neighbours merges with them.
 *
 * Both ends stay on their footprints, as `check` requires:
 *
 * - The leg that leaves the source and the leg that enters the target keep
 *   at least half a unit straight out of or into the footprint, so a bend
 *   can't be pulled back through the box. A segment next to one stops there.
 * - Dragging the first or last segment slides its end along the footprint's
 *   edge, clear of the corners. Dragged further, the end stays at the limit
 *   and the route jogs half a unit out and across to the segment.
 * - Where the two footprints leave no room for that jog, the segment stops
 *   at the limit.
 *
 * Returns the route unchanged when nothing can be dragged: a segment that
 * isn't there, an offset that snaps to nothing, or a route that doesn't
 * start and end on the footprints to begin with.
 */
export const dragSegment = ({
  points,
  segment,
  offset,
  ends,
}: {
  readonly points: readonly GridPoint[];
  readonly segment: number;
  readonly offset: number;
  readonly ends: RouteEnds;
}): readonly GridPoint[] => {
  const vertices = routeVertices(points);
  const delta = snapHalf(offset);
  const anatomy = anatomyOf(vertices, ends);
  const start = vertices[segment];
  const finish = vertices[segment + 1];

  if (
    delta === 0 ||
    !Number.isInteger(segment) ||
    anatomy === undefined ||
    start === undefined ||
    finish === undefined
  ) {
    return vertices;
  }

  const { startAxis, endAxis, exit, entry } = anatomy;
  const legs = vertices.length - 1;
  const moves = crossAxis(axisOf(start, finish));

  const pushed = [
    ...(segment === 1 ? [exit] : []),
    ...(segment === legs - 2 ? [entry] : []),
  ];

  const line = Arr.reduce(pushed, start[moves] + delta, pushedOut);
  const moved = withSegmentAt({ vertices, segment, moves, line });
  const slidesStart = segment === 0;
  const slidesEnd = segment === legs - 1;

  const jogs = {
    start: slidesStart && outside(line, exit.lateral),
    end: slidesEnd && outside(line, entry.lateral),
  };

  // A straight route that jogs needs room for both stubs.
  const room =
    legs > 1 || (entry.edge - exit.edge) * exit.out >= 2 * stubLength;

  // Where jogging isn't possible, the segment stops at the edge range.
  const stoppedAt = clamp(
    clamp(line, slidesEnd ? entry.lateral : unbounded),
    slidesStart ? exit.lateral : unbounded
  );

  const stopped = withSegmentAt({
    vertices,
    segment,
    moves,
    line: stoppedAt,
  });

  const candidates =
    (jogs.start || jogs.end) && room
      ? [jogged({ moved, line, anatomy, jogs }), stopped]
      : [stopped];

  const keeping: Keeping = { ends, startAxis, endAxis, exit, entry };

  return (
    Arr.findFirst(Arr.map(candidates, routeVertices), (next) =>
      keeps(next, keeping)
    ).pipe(Option.getOrUndefined) ?? vertices
  );
};

/** Where one segment of a route is drawn, and the axis it runs along. */
export interface SegmentGuide {
  readonly from: GridPoint;
  readonly to: GridPoint;
  readonly axis: Axis;
}

/** How far a drawn line may sit from its route, in grid units: a lane or a jog. */
const laneReach = 1;

const alongOf = (guide: SegmentGuide) => {
  const a = guide.from[guide.axis];
  const b = guide.to[guide.axis];

  return { low: Math.min(a, b), high: Math.max(a, b) };
};

const overlapOf = (a: SegmentGuide, b: SegmentGuide) => {
  const first = alongOf(a);
  const second = alongOf(b);

  return Math.min(first.high, second.high) - Math.max(first.low, second.low);
};

const guideAcross = (guide: SegmentGuide) => guide.from[crossAxis(guide.axis)];

/**
 * For each segment of `route`, in `routeVertices` order, the stretch of
 * `drawn` that draws it. A view draws a route moved sideways into a lane
 * where it shares a grid line with another, so the line to point at is the
 * drawn leg that runs the same way, overlaps the segment most and lies
 * within a lane of it. A segment with no such leg is drawn where the route
 * is.
 */
export const segmentGuides = ({
  route,
  drawn,
}: {
  readonly route: readonly GridPoint[];
  readonly drawn: readonly GridPoint[];
}): readonly SegmentGuide[] => {
  const vertices = routeVertices(route);

  const legs = Arr.flatMap(drawn, (from, index): readonly SegmentGuide[] => {
    const to = drawn[index + 1];

    return to === undefined || (from.x === to.x && from.y === to.y)
      ? []
      : [{ from, to, axis: axisOf(from, to) }];
  });

  return Arr.flatMap(vertices, (from, index): readonly SegmentGuide[] => {
    const to = vertices[index + 1];

    if (to === undefined) {
      return [];
    }

    const own: SegmentGuide = { from, to, axis: axisOf(from, to) };

    const near = Arr.filter(
      legs,
      (leg) =>
        leg.axis === own.axis &&
        overlapOf(leg, own) > 0 &&
        Math.abs(guideAcross(leg) - guideAcross(own)) <= laneReach
    );

    const best = Arr.sort(
      near,
      Order.combine(
        Order.mapInput(
          Order.Number,
          (leg: SegmentGuide) => -overlapOf(leg, own)
        ),
        Order.mapInput(Order.Number, (leg: SegmentGuide) =>
          Math.abs(guideAcross(leg) - guideAcross(own))
        )
      )
    );

    return [best[0] ?? own];
  });
};
