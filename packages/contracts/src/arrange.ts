import { Array as Arr, Number, Option, Order } from "effect";

import type { GridPoint, Placement } from "./layout.ts";
import type { LayoutChange, StructureMove } from "./proposals.ts";

/** Where each structure sits, by id. Ids the layout doesn't place are skipped. */
type Placements = Readonly<Partial<Record<string, Placement>>>;

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

export const alignments: readonly Alignment[] = [
  "left",
  "right",
  "top",
  "bottom",
  "centre-x",
  "centre-y",
];

/** The ground axis `distributeMoves` spreads structures along. */
export type Axis = "x" | "y";

const snap = (value: number) => Math.round(value * 2) / 2;

/** The structures in `ids` that `placements` places, as `[id, placement]`. */
const placed = (placements: Placements, ids: readonly string[]) =>
  Arr.flatMap(Arr.dedupe(ids), (id) =>
    Option.match(Option.fromNullishOr(placements[id]), {
      onNone: () => [],
      onSome: (placement): [string, Placement][] => [[id, placement]],
    })
  );

const toMove = (id: string, position: GridPoint): StructureMove => ({
  target: { kind: "structure", id },
  position,
});

/** The moves that put each structure at `positionOf(placement)`, less those already there. */
const movesTo = (
  structures: readonly (readonly [string, Placement])[],
  positionOf: (placement: Placement, index: number) => GridPoint
): readonly StructureMove[] =>
  Arr.flatMap(structures, ([id, placement], index) => {
    const position = positionOf(placement, index);

    return position.x === placement.x && position.y === placement.y
      ? []
      : [toMove(id, position)];
  });

const smallest = (values: readonly number[]) => Math.min(...values);

const largest = (values: readonly number[]) => Math.max(...values);

/**
 * The moves that line up `ids` as `how` says, in the ground's terms, as the
 * structures sit in `placements`. Edges go to the smallest or largest edge
 * of the set; centres go to the middle of the set's extent. Positions land
 * on half units. A structure that's already in line, or that `placements`
 * doesn't place, gets no move.
 */
export const alignMoves = ({
  placements,
  ids,
  how,
}: {
  readonly placements: Placements;
  readonly ids: readonly string[];
  readonly how: Alignment;
}): readonly StructureMove[] => {
  const structures = placed(placements, ids);
  const at = Arr.map(structures, ([, placement]) => placement);

  const left = smallest(Arr.map(at, ({ x }) => x));
  const right = largest(Arr.map(at, ({ x, w }) => x + w));
  const top = smallest(Arr.map(at, ({ y }) => y));
  const bottom = largest(Arr.map(at, ({ y, d }) => y + d));

  return movesTo(structures, ({ x, y, w, d }) => {
    switch (how) {
      case "left":
        return { x: left, y };
      case "right":
        return { x: snap(right - w), y };
      case "top":
        return { x, y: top };
      case "bottom":
        return { x, y: snap(bottom - d) };
      case "centre-x":
        return { x: snap((left + right) / 2 - w / 2), y };
      case "centre-y":
        return { x, y: snap((top + bottom) / 2 - d / 2) };
      default:
        return { x, y };
    }
  });
};

type Entry = readonly [string, Placement];

/** By position along `axis`, then by id, so equal positions order the same each time. */
const byStart = (axis: Axis): Order.Order<Entry> =>
  Order.combine(
    Order.mapInput(Order.Number, ([, placement]: Entry) =>
      axis === "x" ? placement.x : placement.y
    ),
    Order.mapInput(Order.String, ([id]: Entry) => id)
  );

const sizeOf = (placement: Placement, axis: Axis) =>
  axis === "x" ? placement.w : placement.d;

/**
 * The moves that spread `ids` evenly along `axis`: the first and last by
 * position stay put, and the gaps between neighbouring edges become equal.
 * Positions land on half units, so a gap can differ by half a unit from the
 * others. Needs three structures; with fewer there is nothing to spread.
 */
export const distributeMoves = ({
  placements,
  ids,
  axis,
}: {
  readonly placements: Placements;
  readonly ids: readonly string[];
  readonly axis: Axis;
}): readonly StructureMove[] => {
  const ordered = Arr.sort(placed(placements, ids), byStart(axis));

  const first = Arr.head(ordered);
  const last = Arr.last(ordered);

  if (ordered.length < 3 || Option.isNone(first) || Option.isNone(last)) {
    return [];
  }

  const origin = axis === "x" ? first.value[1].x : first.value[1].y;

  const end =
    (axis === "x" ? last.value[1].x : last.value[1].y) +
    sizeOf(last.value[1], axis);

  const sizes = Arr.map(ordered, ([, placement]) => sizeOf(placement, axis));
  const gap = (end - origin - Number.sumAll(sizes)) / (ordered.length - 1);

  const starts = Arr.scan(
    sizes.slice(0, -1),
    origin,
    (at, size) => at + size + gap
  );

  return movesTo(ordered, (placement, index) => {
    const along = snap(starts[index] ?? origin);

    return axis === "x"
      ? { x: along, y: placement.y }
      : { x: placement.x, y: along };
  });
};

/**
 * The moves that shift `ids` by `delta` on the ground, keeping each
 * structure's place in the set. `delta` should be a multiple of half a unit.
 */
export const nudgeMoves = ({
  placements,
  ids,
  delta,
}: {
  readonly placements: Placements;
  readonly ids: readonly string[];
  readonly delta: GridPoint;
}): readonly StructureMove[] =>
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
 * The structures, among `ids`, whose footprints share ground with `box`. A footprint the box only touches
 * along an edge doesn't count. In the Iso view the box is the ground
 * rectangle between the two corners, which is a diamond on screen.
 */
export const structuresInBox = ({
  placements,
  box: { from, to },
  ids,
}: {
  readonly placements: Placements;
  readonly box: GroundBox;
  /** The structures to look at. Defaults to every one `placements` places. */
  readonly ids: readonly string[];
}): readonly string[] => {
  const left = Math.min(from.x, to.x);
  const right = Math.max(from.x, to.x);
  const top = Math.min(from.y, to.y);
  const bottom = Math.max(from.y, to.y);

  return Arr.flatMap(placed(placements, ids), ([id, { x, y, w, d }]) =>
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
  readonly changes: readonly LayoutChange[];
  readonly id: string;
  readonly moves: readonly StructureMove[];
}): readonly LayoutChange[] =>
  Arr.isReadonlyArrayNonEmpty(moves)
    ? [...changes, { id, kind: "move", moves }]
    : changes;
