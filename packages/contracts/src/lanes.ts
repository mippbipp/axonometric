import { Array as Arr, Option, Order, Record as Rec } from "effect";
import { dual } from "effect/Function";

import { project } from "./iso.ts";
import type { GridPosition } from "./iso.ts";
import type { GridPoint } from "./layout.ts";
import { planUnit } from "./plan.ts";
import type { View } from "./plan.ts";
import type { HopRoute } from "./routing.ts";

// Routes may share grid points: a bundle's hops share a trunk, and the router
// lets other hops share a stretch when nothing else gets through. The views
// draw each hop as its own line. Every leg that runs on the same grid line as
// another leg, overlapping or touching it, gets its own lane beside the line,
// and lanes are ordered so lines that run together don't cross: two routes
// sharing a stretch keep the same side of each other along all of it, the
// side they turn off to where they part.

/**
 * How far apart the lines of a bundle are drawn, in screen units, the same
 * in both views. At the zoom that fits a 15-structure map in a 1780×1020
 * window, it's about 4 px in Plan view and 6 px in the Iso view.
 */
export const laneGap = 8;

/** The sine of the angle between the x and y axes on screen in each view. */
const axisSine = (() => {
  const x = project({ x: 1, y: 0 });
  const y = project({ x: 0, y: 1 });
  const cross = Math.abs(x.sx * y.sy - x.sy * y.sx);

  return cross / (Math.hypot(x.sx, x.sy) * Math.hypot(y.sx, y.sy));
})();

/**
 * How far apart lanes sit on the ground in each view, in grid units, so that
 * on screen the lines are `laneGap` apart, measured square to them.
 */
export const laneWidths: Readonly<Record<View, number>> = {
  iso:
    laneGap /
    (Math.hypot(project({ x: 1, y: 0 }).sx, project({ x: 1, y: 0 }).sy) *
      axisSine),
  plan: laneGap / planUnit,
};

/** A route's corners in half units, with repeated and straight-through points dropped. */
const cornersOf = (points: readonly GridPoint[]) => {
  const halves = Arr.dedupeAdjacentWith(
    Arr.map(points, ({ x, y }) => ({
      x: Math.round(x * 2),
      y: Math.round(y * 2),
    })),
    (a, b) => a.x === b.x && a.y === b.y
  );

  return Arr.filter(halves, (point, index) => {
    const previous = halves[index - 1];
    const next = halves[index + 1];

    return (
      previous === undefined ||
      next === undefined ||
      (previous.x === point.x) !== (point.x === next.x)
    );
  });
};

interface Cell {
  readonly x: number;
  readonly y: number;
}

interface Leg {
  readonly hop: number;
  readonly index: number;
  /** Whether the leg runs along x. */
  readonly alongX: boolean;
  /** The grid line it runs on: y for a leg along x, x for one along y. */
  readonly line: number;
  readonly low: number;
  readonly high: number;
}

/** One hop's route, as the lanes need it. */
interface Path {
  readonly corners: readonly Cell[];
  readonly legs: readonly Leg[];
  /** Every half-unit point it passes, in order. */
  readonly cells: readonly Cell[];
  /** For each cell, the leg the step from it belongs to. */
  readonly legOfStep: readonly number[];
  /** The index in `cells` of each point, by key. */
  readonly at: ReadonlyMap<string, number>;
}

const cellKey = ({ x, y }: Cell) => `${x},${y}`;

const pathOf = (hop: number, points: readonly GridPoint[]): Path => {
  const corners = cornersOf(points);

  const legs = Arr.flatMap(corners, (start, index): readonly Leg[] => {
    const end = corners[index + 1];

    if (end === undefined) {
      return [];
    }

    const alongX = start.y === end.y;
    const [from, to] = alongX ? [start.x, end.x] : [start.y, end.y];

    return [
      {
        hop,
        index,
        alongX,
        line: alongX ? start.y : start.x,
        low: Math.min(from, to),
        high: Math.max(from, to),
      },
    ];
  });

  const cells: Cell[] = [];
  const legOfStep: number[] = [];

  Arr.forEach(corners, (start, index) => {
    const end = corners[index + 1];

    if (end === undefined) {
      cells.push(start);

      return;
    }

    const count = Math.abs(end.x - start.x) + Math.abs(end.y - start.y);

    for (let step = 0; step < count; step++) {
      cells.push({
        x: start.x + Math.sign(end.x - start.x) * step,
        y: start.y + Math.sign(end.y - start.y) * step,
      });
      legOfStep.push(index);
    }
  });

  return {
    corners,
    legs,
    cells,
    legOfStep,
    at: new Map(Arr.map(cells, (cell, index) => [cellKey(cell), index])),
  };
};

const directionOf = (a: Cell, b: Cell): Cell => ({
  x: Math.sign(b.x - a.x),
  y: Math.sign(b.y - a.y),
});

/**
 * Which way `next` turns from `heading`: -1 left, 1 right, 0 straight on or
 * no step at all, as when the route ends.
 */
const turnOf = (heading: Cell, next: Option.Option<Cell>) =>
  Option.match(next, {
    onNone: () => 0,
    onSome: ({ x, y }) => Math.sign(heading.x * y - heading.y * x),
  });

/**
 * Where a path goes from its point `cells[at]`, other than to `back`: the
 * direction of its neighbouring point there, or none when it ends.
 */
const awayFrom = (
  path: Path,
  at: number | undefined,
  back: Cell
): Option.Option<Cell> => {
  const here = at === undefined ? undefined : path.cells[at];

  if (at === undefined || here === undefined) {
    return Option.none();
  }

  return Option.map(
    Arr.findFirst(
      Arr.filter(
        [path.cells[at - 1], path.cells[at + 1]],
        (cell): cell is Cell => cell !== undefined
      ),
      (cell) => cellKey(cell) !== cellKey(back)
    ),
    (cell) => directionOf(here, cell)
  );
};

/**
 * Which way `p` and `q` turn, -1 left to 1 right, where they part at `p`'s
 * point `cells[at]`, having come along the shared stretch from `back`.
 */
const turnsAt = (
  p: Path,
  q: Path,
  { at, back }: { readonly at: number; readonly back: Cell }
) => {
  const here = p.cells[at];

  if (here === undefined) {
    return { mine: 0, theirs: 0 };
  }

  const heading = directionOf(back, here);

  const theirs = awayFrom(q, q.at.get(cellKey(here)), back);

  return {
    mine: turnOf(heading, awayFrom(p, at, back)),
    theirs: turnOf(heading, theirs),
  };
};

/**
 * For two paths that share the steps from `p.cells[from]` to
 * `p.cells[to + 1]`, whether `p` runs on the left of `q` there, looking
 * along `p`'s direction of travel: the side each turns off to where they
 * part ahead, else where they part behind, else `p` on the left.
 */
const leftOf = (
  p: Path,
  q: Path,
  { from, to }: { readonly from: number; readonly to: number }
) => {
  const last = p.cells[to];

  if (last !== undefined) {
    const { mine, theirs } = turnsAt(p, q, { at: to + 1, back: last });

    if (mine !== theirs) {
      return mine < theirs;
    }
  }

  const second = p.cells[from + 1];

  if (second !== undefined) {
    const { mine, theirs } = turnsAt(p, q, { at: from, back: second });

    // Looking backwards, left and right swap.
    if (mine !== theirs) {
      return mine > theirs;
    }
  }

  return true;
};

/**
 * Whether a leg of `p` that runs left of another leg, looking along `p`,
 * sits at the smaller coordinate across the line.
 */
const leftIsLower = (p: Path, step: number) => {
  const here = p.cells[step];
  const next = p.cells[step + 1];

  if (here === undefined || next === undefined) {
    return true;
  }

  const { x, y } = directionOf(here, next);

  // The left of heading (x, y) is (y, -x).
  return (x === 0 ? y : -x) < 0;
};

const stepKey = (a: Cell, b: Cell) =>
  `${Math.min(a.x, b.x)},${Math.min(a.y, b.y)},${a.y === b.y ? "x" : "y"}`;

const stepsOfPath = (path: Path) =>
  new Set(
    Arr.flatMap(path.cells, (cell, index) => {
      const next = path.cells[index + 1];

      return next === undefined ? [] : [stepKey(cell, next)];
    })
  );

/** The runs of steps `p` shares with `theirs`, as first and last step. */
const sharedRuns = (p: Path, theirs: ReadonlySet<string>) => {
  const shares = Arr.map(p.cells.slice(0, -1), (cell, index) => {
    const next = p.cells[index + 1];

    return next !== undefined && theirs.has(stepKey(cell, next));
  });

  return Arr.reduce(
    shares,
    Arr.empty<{ readonly from: number; readonly to: number }>(),
    (runs, shared, index) => {
      const last = runs.at(-1);

      if (!shared) {
        return runs;
      }

      return last !== undefined && last.to === index - 1
        ? [...runs.slice(0, -1), { from: last.from, to: index }]
        : [...runs, { from: index, to: index }];
    }
  );
};

/** One leg that must sit lower across its line than another. */
interface Below {
  readonly lower: string;
  readonly upper: string;
}

/**
 * Which of two paths' legs sits lower across their line along each step
 * they share: `p` keeps the side it turns off to where they part.
 */
const pairOrder = (
  [pi, p]: readonly [number, Path],
  [qi, q]: readonly [number, Path],
  theirs: ReadonlySet<string>
): readonly Below[] =>
  Arr.flatMap(sharedRuns(p, theirs), ({ from, to }) => {
    const left = leftOf(p, q, { from, to });

    return Arr.flatMap(Arr.range(from, to), (step): readonly Below[] => {
      const a = p.cells[step];
      const b = p.cells[step + 1];
      const qStep = a === undefined ? undefined : q.at.get(cellKey(a));
      const qOther = b === undefined ? undefined : q.at.get(cellKey(b));

      if (qStep === undefined || qOther === undefined) {
        return [];
      }

      const pLeg = `${pi}:${p.legOfStep[step] ?? 0}`;
      const qLeg = `${qi}:${q.legOfStep[Math.min(qStep, qOther)] ?? 0}`;

      return left === leftIsLower(p, step)
        ? [{ lower: pLeg, upper: qLeg }]
        : [{ lower: qLeg, upper: pLeg }];
    });
  });

/**
 * For every pair of legs that share steps, which sits lower across their
 * line: keyed by `hop:leg`, the legs that must sit below it.
 */
const orderings = (paths: readonly Path[]) => {
  const steps = Arr.map(paths, stepsOfPath);
  const below = new Map<string, Set<string>>();

  Arr.forEach(paths, (p, pi) => {
    Arr.forEach(paths.slice(pi + 1), (q, offset) => {
      const qi = pi + 1 + offset;

      for (const { lower, upper } of pairOrder(
        [pi, p],
        [qi, q],
        steps[qi] ?? new Set()
      )) {
        const set = below.get(upper) ?? new Set<string>();

        set.add(lower);
        below.set(upper, set);
      }
    });
  });

  return below;
};

const legId = (leg: Leg) => `${leg.hop}:${leg.index}`;

const meets = (a: Leg, b: Leg) => a.low <= b.high && b.low <= a.high;

/**
 * The most room a grid line's lanes may take across it, in grid units: half
 * the half unit to the next grid line on each side, so lanes never reach
 * another line's lanes or a box's edge half a unit away.
 */
const laneRoom = 0.5;

/** Legs on one grid line that overlap or touch, one after another along it. */
const touchingGroups = (legs: readonly Leg[]) =>
  Arr.reduce(
    Arr.sort(
      legs,
      Order.mapInput(Order.Number, (leg: Leg) => leg.low)
    ),
    Arr.empty<readonly Leg[]>(),
    (done, leg) => {
      const last = done.at(-1);

      return last !== undefined &&
        leg.low <= Math.max(...Arr.map(last, ({ high }) => high))
        ? [...done.slice(0, -1), [...last, leg]]
        : [...done, [leg]];
    }
  );

/**
 * A group's legs lowest first: every leg after the legs it must sit above.
 * A cycle, which only overrides can make, falls back to route order.
 */
const lowestFirst = (
  group: readonly Leg[],
  below: ReadonlyMap<string, ReadonlySet<string>>
) => {
  const order: Leg[] = [];
  const placed = new Set<string>();

  const free = (leg: Leg) => !placed.has(legId(leg));

  const ready = (leg: Leg) =>
    free(leg) &&
    Arr.every([...(below.get(legId(leg)) ?? [])], (id) => placed.has(id));

  while (order.length < group.length) {
    const next = Option.orElse(Arr.findFirst(group, ready), () =>
      Arr.findFirst(group, free)
    );

    if (Option.isNone(next)) {
      break;
    }

    order.push(next.value);
    placed.add(legId(next.value));
  }

  return order;
};

/**
 * Each leg's track in a group, counting up from 0 across the line: above
 * every leg it must sit above, and apart from every leg it meets.
 */
const tracksOf = (
  order: readonly Leg[],
  below: ReadonlyMap<string, ReadonlySet<string>>
) => {
  const tracks = new Map<string, number>();

  for (const leg of order) {
    const lower = Arr.map(
      [...(below.get(legId(leg)) ?? [])],
      (id) => tracks.get(id) ?? -1
    );

    const taken = new Set(
      Arr.flatMap(order, (other) => {
        const track = tracks.get(legId(other));

        return track !== undefined && meets(leg, other) ? [track] : [];
      })
    );

    let track = Math.max(-1, ...lower) + 1;

    while (taken.has(track)) {
      track += 1;
    }

    tracks.set(legId(leg), track);
  }

  return tracks;
};

/**
 * Each leg's offset from its grid line, in grid units, by `hop:leg`,
 * negative towards smaller coordinates. A leg alone on its line keeps 0.
 * Lanes are `width` apart, or closer where more lanes share a line than fit
 * in `laneRoom` that far apart.
 */
const lanesOf = (paths: readonly Path[], width: number) => {
  const below = orderings(paths);
  const lanes = new Map<string, number>();

  const lines = Arr.groupBy(
    Arr.flatMap(paths, ({ legs }) => legs),
    (leg) => `${leg.alongX ? "x" : "y"}${leg.line}`
  );

  const groups = Arr.filter(
    Arr.flatMap(Rec.values(lines), touchingGroups),
    (group) => group.length > 1
  );

  for (const group of groups) {
    const tracks = tracksOf(lowestFirst(group, below), below);
    const used = [...tracks.values()];
    const middle = (Math.min(...used) + Math.max(...used)) / 2;
    const count = Math.max(...used) - Math.min(...used) + 1;
    const gap = Math.min(width, laneRoom / count);

    for (const [id, track] of tracks) {
      lanes.set(id, (track - middle) * gap);
    }
  }

  return lanes;
};

/**
 * Each hop's route as a view draws it, on the ground in grid units: its own
 * line, moved off the grid line into its lane wherever it runs on the same
 * line as another route, lanes `width` grid units apart where they fit.
 * Every leg still runs along x or y, and each end stays on its structure's
 * edge.
 */
export const laneRoutes: {
  (
    width: number
  ): (
    routes: Readonly<Record<string, HopRoute>>
  ) => Readonly<Record<string, readonly GridPosition[]>>;
  (
    routes: Readonly<Record<string, HopRoute>>,
    width: number
  ): Readonly<Record<string, readonly GridPosition[]>>;
} = dual(
  2,
  (
    routes: Readonly<Record<string, HopRoute>>,
    width: number
  ): Readonly<Record<string, readonly GridPosition[]>> => {
    const entries = Rec.toEntries(routes);

    const paths = Arr.map(entries, ([, route], index) =>
      pathOf(index, route.points)
    );

    const lanes = lanesOf(paths, width);

    return Rec.fromEntries(
      Arr.map(entries, ([id], hop) => {
        const path = paths[hop];

        if (path === undefined || path.legs.length === 0) {
          return [
            id,
            Arr.map(routes[id]?.points ?? [], ({ x, y }) => ({ x, y })),
          ] as const;
        }

        const shift = (leg: number) => lanes.get(`${hop}:${leg}`) ?? 0;

        const points = Arr.map(path.corners, (corner, index) => {
          const legs = Arr.filter(
            path.legs,
            (leg) => leg.index === index - 1 || leg.index === index
          );

          const across = (alongX: boolean) =>
            Arr.reduce(
              Arr.filter(legs, (leg) => leg.alongX === alongX),
              0,
              (sum, leg) => sum + shift(leg.index)
            );

          return {
            x: corner.x / 2 + across(false),
            y: corner.y / 2 + across(true),
          };
        });

        return [id, points] as const;
      })
    );
  }
);
