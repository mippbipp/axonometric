import { Array as Arr, Option, Order, Record as Rec } from "effect";

import { arrowLength, endGap, endRange, endWidths } from "./ends.ts";
import { gridOnScreen } from "./iso.ts";
import type { GridPosition } from "./iso.ts";
import { laneRoutes, laneWidths } from "./lanes.ts";
import type { Placement } from "./layout.ts";
import { planUnit } from "./plan.ts";
import type { View } from "./plan.ts";
import type { HopRoute } from "./routing.ts";

// A bundle's lines run 4 px apart, too close for their arrowheads. Where
// several hops end on one structure's edge, their ends are spread along it
// to the spacing in `endWidths`. Each line jogs sideways to its end just
// before the edge, square to the line, so the jog stays right-angled. Ends
// keep the order of their lines, so no two of a bundle cross.

/** A hop the views draw, with the structures at its ends. */
export interface DrawnHop {
  readonly id: string;
  readonly from: string;
  readonly to: string;
}

/** How long a grid unit is on screen along an axis, in each view. */
const unitOnScreen: Readonly<Record<View, number>> = {
  iso: gridOnScreen,
  plan: planUnit,
};

/** Room between an arrowhead's base and its line's jog, in screen units. */
const headRoom = 4;

/** How much deeper one jog sits than the one it passes, in screen units. */
const jogStep = 8;

/** The least a line's start moves along the edge, in screen units. */
const nudge = 6;

/** How close a jog may pass another line, in screen units. */
const lineGap = 4;

/** How far from the edge a line that starts there jogs, in grid units. */
const startJog = 0.25;

/** The least room kept between a jog and the end of its leg, in grid units. */
const legMargin = 0.05;

/** One line's end on a structure's edge. */
interface End {
  readonly hop: number;
  readonly first: boolean;
  /** Where the line meets the edge, along the edge. */
  readonly at: number;
  /** How wide the end is along the edge, for spacing. */
  readonly width: number;
  /** Where the edge is across, and which way the line leaves it. */
  readonly edge: number;
  readonly inward: 1 | -1;
  /** Whether the edge runs along x, so the line's end leg runs along y. */
  readonly alongX: boolean;
  /** How much of the end leg a jog may use, in grid units. */
  readonly room: number;
  /**
   * The other hops' lines that run parallel to the edge: how far from it,
   * and the stretch along it they cover. A jog that moves along the edge
   * passes those that cover any of its stretch.
   */
  readonly crossings: readonly Crossing[];
  /**
   * Where other hops' lines run square to the edge close to it, along the
   * edge, not counting ends on the edge itself. An end keeps a line gap from
   * them, or its last leg would run on top of one.
   */
  readonly beside: readonly number[];
  /** The range along the edge the end may take. */
  readonly low: number;
  readonly high: number;
}

/** A line parallel to an edge: how far from it, and what it covers along it. */
interface Crossing {
  readonly depth: number;
  readonly low: number;
  readonly high: number;
}

/** How far from an edge a line square to it counts as beside an end's leg. */
const besideReach = 0.6;

/** Where other lines run square to an edge, close to it but not on it. */
const besideOf = ({
  others,
  leg,
}: {
  readonly others: readonly (readonly GridPosition[])[];
  readonly leg: {
    readonly alongX: boolean;
    readonly edge: number;
    readonly inward: 1 | -1;
  };
}) =>
  Arr.flatMap(others, (line) =>
    Arr.flatMap(line.slice(1), (end, index) => {
      const start = line[index];

      if (start === undefined) {
        return [];
      }

      const square = leg.alongX ? start.x === end.x : start.y === end.y;
      const along = leg.alongX ? start.x : start.y;
      const [one, two] = leg.alongX ? [start.y, end.y] : [start.x, end.x];

      const near = Math.min(
        (one - leg.edge) * leg.inward,
        (two - leg.edge) * leg.inward
      );

      const far = Math.max(
        (one - leg.edge) * leg.inward,
        (two - leg.edge) * leg.inward
      );

      return square && near > 0.05 && near < besideReach && far > near
        ? [along]
        : [];
    })
  );

/** The other lines parallel to the edge, on the inner side of an end's leg. */
const crossingsOf = ({
  others,
  leg,
}: {
  readonly others: readonly (readonly GridPosition[])[];
  readonly leg: {
    readonly alongX: boolean;
    readonly at: number;
    readonly edge: number;
    readonly inward: 1 | -1;
  };
}) =>
  Arr.flatMap(others, (line) =>
    Arr.flatMap(line.slice(1), (end, index) => {
      const start = line[index];

      if (start === undefined) {
        return [];
      }

      // A segment parallel to the edge: constant across, spanning along.
      const [across, from, to] = leg.alongX
        ? [start.y, start.x, end.x]
        : [start.x, start.y, end.y];

      const flat = leg.alongX ? start.y === end.y : start.x === end.x;
      const depth = (across - leg.edge) * leg.inward;

      return flat && depth > 0
        ? [{ depth, low: Math.min(from, to), high: Math.max(from, to) }]
        : [];
    })
  );

const endOf = ({
  hop,
  line,
  first,
  placement,
  view,
  others,
}: {
  readonly hop: number;
  readonly line: readonly GridPosition[];
  readonly first: boolean;
  readonly placement: Placement | undefined;
  readonly view: View;
  readonly others: readonly (readonly GridPosition[])[];
}): End | undefined => {
  const point = first ? line[0] : line.at(-1);
  const next = first ? line[1] : line.at(-2);

  if (point === undefined || next === undefined || placement === undefined) {
    return undefined;
  }

  const alongX = point.x === next.x;
  const at = alongX ? point.x : point.y;
  const edge = alongX ? point.y : point.x;
  const origin = alongX ? placement.x : placement.y;
  const length = alongX ? placement.w : placement.d;
  const across = alongX ? next.y - point.y : next.x - point.x;
  const near = alongX ? placement.y : placement.x;
  const far = near + (alongX ? placement.d : placement.w);

  if (point.x !== next.x && point.y !== next.y) {
    return undefined;
  }

  if (Math.abs(edge - near) > 1e-9 && Math.abs(edge - far) > 1e-9) {
    return undefined;
  }

  const { low, high } = endRange(length);
  const widths = endWidths[view];
  // A line of one leg jogs at both its ends.
  const share = line.length === 2 ? 2 : 1;

  const inward = across < 0 ? -1 : 1;

  return {
    hop,
    first,
    at,
    width: first ? widths.start : widths.head,
    edge,
    inward,
    alongX,
    crossings: crossingsOf({ others, leg: { alongX, at, edge, inward } }),
    beside: besideOf({ others, leg: { alongX, edge, inward } }),
    room: Math.max(0, Math.abs(across) - legMargin) / share,
    low: origin + low,
    high: origin + high,
  };
};

/** Where a row of ends sits: the first at `start`, the rest after it. */
const offsetsOf = (members: readonly End[]) =>
  Arr.reduce(members, Arr.empty<number>(), (done, member, index) => {
    const before = members[index - 1];
    const last = done.at(-1);

    return before === undefined || last === undefined
      ? [0]
      : [...done, last + endGap(before.width, member.width)];
  });

/** A row of ends moved together, in order along the edge. */
interface Cluster {
  readonly members: readonly End[];
  readonly targets: readonly number[];
}

/**
 * Places a row of ends as near as it can to where their lines are, no
 * nearer to each other than their widths ask, and inside the edge's range.
 */
const clusterOf = (members: readonly End[]): Cluster => {
  const offsets = offsetsOf(members);
  const [first] = members;
  const span = offsets.at(-1) ?? 0;

  if (first === undefined) {
    return { members, targets: [] };
  }

  const mean =
    Arr.reduce(
      members,
      0,
      (sum, end, index) => sum + end.at - (offsets[index] ?? 0)
    ) / members.length;

  const start = Math.max(first.low, Math.min(mean, first.high - span));

  return { members, targets: Arr.map(offsets, (offset) => start + offset) };
};

const crowds = (a: Cluster, b: Cluster) => {
  const end = a.targets.at(-1);
  const [start] = b.targets;
  const left = a.members.at(-1);
  const [right] = b.members;

  return (
    end !== undefined &&
    start !== undefined &&
    left !== undefined &&
    right !== undefined &&
    start - end < endGap(left.width, right.width) - 1e-9
  );
};

/**
 * Where each end of one edge goes, in the order of `ends` sorted along the
 * edge: ends far enough apart stay where they are, and crowded ones spread
 * out around where they were.
 */
const spread = (ends: readonly End[]): readonly number[] => {
  let clusters = Arr.map(ends, (end) => clusterOf([end]));

  const findCrowded = () =>
    Arr.findFirstIndex(clusters, (cluster, at) => {
      const next = clusters[at + 1];

      return next !== undefined && crowds(cluster, next);
    });

  let crowded = findCrowded();

  while (Option.isSome(crowded)) {
    const at = crowded.value;
    const a = clusters[at];
    const b = clusters[at + 1];

    clusters = [
      ...clusters.slice(0, at),
      clusterOf([...(a?.members ?? []), ...(b?.members ?? [])]),
      ...clusters.slice(at + 2),
    ];

    crowded = findCrowded();
  }

  return Arr.flatMap(clusters, ({ targets }) => targets);
};

/**
 * Moves each target that sits within a line gap of a line running square to
 * the edge to just past that line, on the side it stays in order with its
 * neighbours; a target with no such room stays.
 */
const clearOfLines = (
  ends: readonly End[],
  targets: readonly number[]
): readonly number[] =>
  Arr.reduce(ends, Arr.empty<number>(), (done, end, index) => {
    const target = targets[index] ?? end.at;
    const unit = unitOnScreen.iso;
    const gap = lineGap / unit;

    const hit = Arr.findFirst(
      end.beside,
      (line) => Math.abs(target - line) < gap
    );

    const before = done.at(-1);
    const next = targets[index + 1];
    const previous = ends[index - 1];
    const following = ends[index + 1];

    return [
      ...done,
      Option.match(hit, {
        onNone: () => target,
        onSome: (line) => {
          const after = line + gap;
          const under = line - gap;

          const roomAfter =
            after <= end.high &&
            (next === undefined ||
              following === undefined ||
              next - after >= endGap(end.width, following.width) - 1e-9);

          const roomUnder =
            under >= end.low &&
            (before === undefined ||
              previous === undefined ||
              under - before >= endGap(previous.width, end.width) - 1e-9);

          if (roomAfter && (!roomUnder || after - target <= target - under)) {
            return after;
          }

          return roomUnder ? under : target;
        },
      }),
    ];
  });

/** An end after the spread: where it goes, and how far from the edge it jogs. */
interface Fan {
  readonly end: End;
  readonly target: number;
  readonly jog: number;
}

/**
 * How far from the edge each end of one edge jogs, `ends` sorted along it.
 * An end that moves towards another's lane, close enough to come near it,
 * jogs nearer the edge than that other end, a step apart, so it has turned
 * back to its lane before the other's jog begins.
 */
const fanned = (
  row: readonly { readonly end: End; readonly target: number }[],
  { view }: { readonly view: View }
): readonly Fan[] => {
  const unit = unitOnScreen[view];
  const clear = (arrowLength + headRoom) / unit;
  const step = jogStep / unit;
  const near = lineGap / unit;

  // A line's start moves only if it must: a shift of a pixel or two
  // makes a jog that is a crossing's neighbour for no gain.
  const settled = Arr.map(row, ({ end, target }, index) => {
    // A start stays put only if every other end is a full gap away from
    // where it would stay.
    const headsAway = Arr.every(
      row,
      (other, at) =>
        at === index ||
        Math.abs(other.target - end.at) >=
          endGap(end.width, other.end.width) - 1e-9
    );

    return end.first && Math.abs(target - end.at) < nudge / unit && headsAway
      ? { end, target: end.at }
      : { end, target };
  });

  const jogs = Arr.map(settled, ({ end, target }) =>
    target === end.at ? 0 : end.first ? startJog : clear
  );

  const toward = (i: number, j: number) => {
    const mine = settled[i];
    const theirs = settled[j];

    if (mine === undefined || theirs === undefined) {
      return false;
    }

    const move = mine.target - mine.end.at;
    const way = Math.sign(theirs.end.at - mine.end.at);

    return (
      move !== 0 &&
      Math.sign(move) === way &&
      (way > 0
        ? mine.target > theirs.end.at - near
        : mine.target < theirs.end.at + near)
    );
  };

  // A jog's corner keeps a line gap from any line it passes, by moving
  // further from the edge, never nearer, so the order between jogs below
  // holds. A jog passes a line that covers any of the stretch it moves over.
  const outwards = (jog: number, { end, target }: (typeof settled)[number]) =>
    Arr.reduce(
      Arr.sort(
        Arr.filter(
          end.crossings,
          ({ low, high }) =>
            Math.max(low, Math.min(end.at, target) - near) <=
            Math.min(high, Math.max(end.at, target) + near)
        ),
        Order.mapInput(Order.Number, ({ depth }: Crossing) => depth)
      ),
      jog,
      (depth, cross) =>
        Math.abs(depth - cross.depth) < near ? cross.depth + near : depth
    );

  // Each pass lets a jog's push reach one more neighbour.
  Arr.forEach(settled, () => {
    Arr.forEach(settled, (_, i) => {
      Arr.forEach(settled, (__, j) => {
        if (i !== j && toward(i, j)) {
          jogs[j] = Math.max(jogs[j] ?? 0, (jogs[i] ?? 0) + step);
        }
      });
    });

    Arr.forEach(settled, (item, index) => {
      const jog = jogs[index] ?? 0;

      jogs[index] = jog === 0 ? 0 : outwards(jog, item);
    });
  });

  return Arr.map(settled, ({ end, target }, index) => ({
    end,
    target,
    jog: Math.min(jogs[index] ?? 0, end.room),
  }));
};

/** One end's points from the edge inwards: to its target, then the jog. */
const pointsOf = ({ end, target, jog }: Fan): readonly GridPosition[] => {
  const at = (along: number, depth: number): GridPosition =>
    end.alongX
      ? { x: along, y: end.edge + end.inward * depth }
      : { x: end.edge + end.inward * depth, y: along };

  return target === end.at
    ? [at(end.at, 0)]
    : [at(target, 0), at(target, jog), at(end.at, jog)];
};

/**
 * Each hop's line as a view draws it, on the ground in grid units: its own
 * lane (see `laneRoutes`), with the ends on each structure's edge spread
 * apart so arrowheads and line starts keep clear of each other, and a
 * right-angled jog from the lane to the end just before the edge. A route
 * override is drawn as it is.
 */
export const drawnRoutes = ({
  routes,
  hops,
  placements,
  view,
}: {
  readonly routes: Readonly<Record<string, HopRoute>>;
  readonly hops: readonly DrawnHop[];
  readonly placements: Readonly<Record<string, Placement>>;
  readonly view: View;
}): Readonly<Record<string, readonly GridPosition[]>> => {
  const lanes = laneRoutes(routes, laneWidths[view]);
  const listed = Arr.filter(hops, ({ id }) => lanes[id] !== undefined);

  const ends = Arr.flatMap(listed, (hop, index) => {
    const line = lanes[hop.id] ?? [];

    if (routes[hop.id]?.overridden !== false) {
      return [];
    }

    return Arr.flatMap(
      [
        { first: true, id: hop.from },
        { first: false, id: hop.to },
      ],
      ({ first, id }) => {
        const end = endOf({
          hop: index,
          line,
          first,
          placement: placements[id],
          view,
          others: Arr.filter(
            Arr.map(listed, ({ id: other }) => lanes[other] ?? []),
            (_, at) => at !== index
          ),
        });

        return end === undefined ? [] : [{ end, id }];
      }
    );
  });

  const groups = Arr.groupBy(
    ends,
    ({ end, id }) => `${id}|${end.alongX}|${end.edge}`
  );

  const fans = Arr.flatMap(Rec.values(groups), (group) => {
    const sorted = Arr.sort(
      Arr.map(group, ({ end }) => end),
      Order.mapInput(Order.Number, ({ at }: End) => at)
    );

    const targets = clearOfLines(sorted, spread(sorted));

    return fanned(
      Arr.map(sorted, (end, at) => ({ end, target: targets[at] ?? end.at })),
      { view }
    );
  });

  return Rec.fromEntries(
    Arr.map(listed, (hop, index) => {
      const line = lanes[hop.id] ?? [];
      const mine = Arr.filter(fans, ({ end }) => end.hop === index);
      const start = Arr.findFirst(mine, ({ end }) => end.first);
      const tail = Arr.findFirst(mine, ({ end }) => !end.first);

      const front = Option.match(start, {
        onNone: () => line.slice(0, 1),
        onSome: pointsOf,
      });

      const back = Option.match(tail, {
        onNone: () => line.slice(-1),
        onSome: (fan) => Arr.reverse(pointsOf(fan)),
      });

      return [hop.id, [...front, ...line.slice(1, -1), ...back]] as const;
    })
  );
};
