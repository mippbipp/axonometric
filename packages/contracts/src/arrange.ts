import { Array as Arr, Number, Option, Order } from "effect";

import type { GridPoint, Placement } from "./layout.ts";
import type { LayoutChange, StructureMove } from "./proposals.ts";

/** Where each structure sits, by id. Ids the layout doesn't place are skipped. */
export type Placements = Readonly<Partial<Record<string, Placement>>>;

/**
 * How `alignMoves` lines structures up, in ground terms. Left and right act
 * on x, top and bottom on y, and the centres on each axis.
 *
 * Plan view draws x to the right and y downward, so the names read as they
 * say. The Iso view turns the ground by a quarter turn: x runs down and to
 * the right, y runs down and to the left. There "left" and "right" put the
 * structures on one x, a line running from upper right to lower left, and
 * "top" and "bottom" put them on one y, a line running from upper left to
 * lower right.
 */
export type Alignment =
  | "left"
  | "right"
  | "top"
  | "bottom"
  | "centre-x"
  | "centre-y";

/** The ground axis `distributeMoves` spreads structures along. */
export type Axis = "x" | "y";

const snap = (value: number) => Math.round(value * 2) / 2;

/** The structures in `ids` that `placements` places, as `[id, placement]`. */
const placed = (placements: Placements, ids: ReadonlyArray<string>) =>
  Arr.flatMap(Arr.dedupe(ids), (id) =>
    Option.match(Option.fromNullishOr(placements[id]), {
      onNone: () => [],
      onSome: (placement): Array<[string, Placement]> => [[id, placement]],
    })
  );

const toMove = (id: string, position: GridPoint): StructureMove => ({
  position,
  target: { id, kind: "structure" },
});

/** The moves that put each structure at `positionOf(placement)`, less those already there. */
const movesTo = (
  structures: ReadonlyArray<readonly [string, Placement]>,
  positionOf: (placement: Placement, index: number) => GridPoint
): ReadonlyArray<StructureMove> =>
  Arr.flatMap(structures, ([id, placement], index) => {
    const position = positionOf(placement, index);

    return position.x === placement.x && position.y === placement.y
      ? []
      : [toMove(id, position)];
  });

const smallest = (values: ReadonlyArray<number>) => Math.min(...values);

const largest = (values: ReadonlyArray<number>) => Math.max(...values);

/**
 * The moves that line up `ids` as `how` says, in the ground's terms, as the
 * structures sit in `placements`. Edges go to the smallest or largest edge
 * of the set; centres go to the middle of the set's extent. Positions land
 * on half units. A structure that's already in line, or that `placements`
 * doesn't place, gets no move.
 */
export const alignMoves = ({
  how,
  ids,
  placements,
}: {
  readonly how: Alignment;
  readonly ids: ReadonlyArray<string>;
  readonly placements: Placements;
}): ReadonlyArray<StructureMove> => {
  const structures = placed(placements, ids);
  const at = Arr.map(structures, ([, placement]) => placement);

  const left = smallest(Arr.map(at, ({ x }) => x));
  const right = largest(Arr.map(at, ({ w, x }) => x + w));
  const top = smallest(Arr.map(at, ({ y }) => y));
  const bottom = largest(Arr.map(at, ({ d, y }) => y + d));

  const positions: Readonly<Record<Alignment, (at: Placement) => GridPoint>> = {
    bottom: ({ d, x }) => ({ x, y: snap(bottom - d) }),
    "centre-x": ({ w, y }) => ({ x: snap((left + right) / 2 - w / 2), y }),
    "centre-y": ({ d, x }) => ({ x, y: snap((top + bottom) / 2 - d / 2) }),
    left: ({ y }) => ({ x: left, y }),
    right: ({ w, y }) => ({ x: snap(right - w), y }),
    top: ({ x }) => ({ x, y: top }),
  };

  return movesTo(structures, positions[how]);
};

type Entry = readonly [string, Placement];

/** What `distributeMoves` reads and writes along one ground axis. */
interface Along {
  /** `placement`'s position with its start along the axis set to `start`. */
  readonly setStart: (placement: Placement, start: number) => GridPoint;
  readonly size: (placement: Placement) => number;
  readonly start: (placement: Placement) => number;
}

const along: Readonly<Record<Axis, Along>> = {
  x: {
    setStart: ({ y }, start) => ({ x: start, y }),
    size: ({ w }) => w,
    start: ({ x }) => x,
  },
  y: {
    setStart: ({ x }, start) => ({ x, y: start }),
    size: ({ d }) => d,
    start: ({ y }) => y,
  },
};

/**
 * The moves that spread `ids` evenly along `axis`: the first and last by
 * position stay put, and the gaps between neighbouring edges become equal.
 * Positions land on half units, so a gap can differ by half a unit from the
 * others. Needs three structures; with fewer there is nothing to spread.
 */
export const distributeMoves = ({
  axis,
  ids,
  placements,
}: {
  readonly axis: Axis;
  readonly ids: ReadonlyArray<string>;
  readonly placements: Placements;
}): ReadonlyArray<StructureMove> => {
  const { setStart, size, start } = along[axis];

  // By position along the axis, then by id, so equal positions order the
  // same each time.
  const byStart: Order.Order<Entry> = Order.combine(
    Order.mapInput(Order.Number, ([, placement]: Entry) => start(placement)),
    Order.mapInput(Order.String, ([id]: Entry) => id)
  );

  const ordered = Arr.sort(placed(placements, ids), byStart);

  const first = Arr.head(ordered);
  const last = Arr.last(ordered);

  if (ordered.length < 3 || Option.isNone(first) || Option.isNone(last)) {
    return [];
  }

  const origin = start(first.value[1]);
  const end = start(last.value[1]) + size(last.value[1]);
  const sizes = Arr.map(ordered, ([, placement]) => size(placement));
  const gap = (end - origin - Number.sumAll(sizes)) / (ordered.length - 1);

  const starts = Arr.scan(
    sizes.slice(0, -1),
    origin,
    (at, extent) => at + extent + gap
  );

  return movesTo(ordered, (placement, index) =>
    setStart(placement, snap(starts[index] ?? origin))
  );
};

/**
 * The moves that shift `ids` by `delta` on the ground, keeping each
 * structure's place in the set. `delta` should be a multiple of half a unit.
 */
export const nudgeMoves = ({
  delta,
  ids,
  placements,
}: {
  readonly delta: GridPoint;
  readonly ids: ReadonlyArray<string>;
  readonly placements: Placements;
}): ReadonlyArray<StructureMove> =>
  movesTo(placed(placements, ids), ({ x, y }) => ({
    x: x + delta.x,
    y: y + delta.y,
  }));

/** Two corners of a box on the ground, in either order. */
export interface GroundBox {
  readonly from: GridPoint;
  readonly to: GridPoint;
}

/**
 * The structures, among `ids`, whose footprints share ground with `box`. A
 * footprint the box only touches along an edge doesn't count. In the Iso
 * view the box is the ground rectangle between the two corners, which is a
 * diamond on screen.
 */
export const structuresInBox = ({
  box: { from, to },
  ids,
  placements,
}: {
  readonly box: GroundBox;
  /** The structures to look at. */
  readonly ids: ReadonlyArray<string>;
  readonly placements: Placements;
}): ReadonlyArray<string> => {
  const left = Math.min(from.x, to.x);
  const right = Math.max(from.x, to.x);
  const top = Math.min(from.y, to.y);
  const bottom = Math.max(from.y, to.y);

  return Arr.flatMap(placed(placements, ids), ([id, { d, w, x, y }]) =>
    x < right && left < x + w && y < bottom && top < y + d ? [id] : []
  );
};

/**
 * `changes` with one more move change, `id`, holding all of `moves`. A set
 * moved, nudged, aligned or distributed together is one change, so one
 * discard or undo takes it back. With no moves, `changes` as they were.
 */
export const appendMove = ({
  changes,
  id,
  moves,
}: {
  readonly changes: ReadonlyArray<LayoutChange>;
  readonly id: string;
  readonly moves: ReadonlyArray<StructureMove>;
}): ReadonlyArray<LayoutChange> =>
  Arr.isReadonlyArrayNonEmpty(moves)
    ? [...changes, { by: "engineer", id, kind: "move", moves }]
    : changes;
