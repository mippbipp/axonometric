import { Array as Arr, Option, Order, Record as Rec } from "effect";
import { dual } from "effect/Function";

import { footprintsOverlap, tagCovers } from "./layout-checks.ts";
import type { PlacedStructure } from "./layout-checks.ts";
import type { Layout, Placement } from "./layout.ts";
import type { MapData, Structure } from "./map-data.ts";

/** The footprint a newly placed structure gets. */
export const defaultFootprint = { w: 2, d: 2 } as const;

/** Clear ground between two structures, so name tags and routes have room. */
export const structureGap = 2;

/** Clear ground between two groups' zones. */
export const groupGap = 4;

/** Distance between neighbouring slots of a group's grid. */
const pitch = defaultFootprint.w + structureGap;

/** How far past the placed structures placement looks for a free slot. */
const searchMargin = 3 * pitch;

interface Point {
  readonly x: number;
  readonly y: number;
}

const grow = (box: Placement, by: number): Placement => ({
  x: box.x - by,
  y: box.y - by,
  w: box.w + 2 * by,
  d: box.d + 2 * by,
});

const boundsOf = (boxes: readonly Placement[]): Option.Option<Placement> => {
  if (!Arr.isReadonlyArrayNonEmpty(boxes)) {
    return Option.none();
  }

  const left = Math.min(...Arr.map(boxes, (box) => box.x));
  const top = Math.min(...Arr.map(boxes, (box) => box.y));
  const right = Math.max(...Arr.map(boxes, (box) => box.x + box.w));
  const bottom = Math.max(...Arr.map(boxes, (box) => box.y + box.d));

  return Option.some({ x: left, y: top, w: right - left, d: bottom - top });
};

const centreOf = (box: Placement): Point => ({
  x: box.x + box.w / 2,
  y: box.y + box.d / 2,
});

/** Grid distance between two footprints' centres, along the axes. */
const distance = (a: Placement, b: Placement) => {
  const first = centreOf(a);
  const second = centreOf(b);

  return Math.abs(first.x - second.x) + Math.abs(first.y - second.y);
};

/** Rounds down to a half unit, so every position stays on the grid. */
const toHalfUnit = (value: number) => Math.floor(value * 2) / 2;

const footprints = (placed: readonly PlacedStructure[]) =>
  Arr.map(placed, ({ placement }) => placement);

const membersOf = (placed: readonly PlacedStructure[], group: string) =>
  Arr.filter(placed, ({ structure }) => structure.group === group);

/** The ground a group's placed structures cover. */
const zoneOf = (placed: readonly PlacedStructure[], group: string) =>
  boundsOf(footprints(membersOf(placed, group)));

/** The zones of every group but `group`, from what's placed so far. */
const otherZones = (placed: readonly PlacedStructure[], group: string) =>
  Arr.flatMap(
    Arr.dedupe(Arr.map(placed, ({ structure }) => structure.group)),
    (other) => (other === group ? [] : Option.toArray(zoneOf(placed, other)))
  );

const apart = (a: Placement, b: Placement, gap: number) =>
  !footprintsOverlap(grow(a, gap / 2), grow(b, gap / 2));

/**
 * Whether `candidate` is a good spot: clear of every footprint by the
 * structure gap, with no name tag drawn over a box either way, and with its
 * group's zone kept clear of every other zone by the group gap.
 */
const fits = (
  placed: readonly PlacedStructure[],
  candidate: PlacedStructure
) => {
  const spot = candidate.placement;

  const clear = Arr.every(
    placed,
    (other) =>
      apart(spot, other.placement, structureGap) &&
      !tagCovers(candidate, other) &&
      !tagCovers(other, candidate)
  );

  const zone = boundsOf([
    ...footprints(membersOf(placed, candidate.structure.group)),
    spot,
  ]).pipe(Option.getOrElse(() => spot));

  return (
    clear &&
    Arr.every(otherZones(placed, candidate.structure.group), (other) =>
      apart(zone, other, groupGap)
    )
  );
};

/** The ids of the structures `id`'s hops connect it to. */
const neighboursOf = (data: MapData, id: string) =>
  Arr.dedupe(
    Arr.flatMap(data.hops, (hop) => {
      if (hop.from === id && hop.to !== id) {
        return [hop.to];
      }

      return hop.to === id && hop.from !== id ? [hop.from] : [];
    })
  );

/**
 * Slots on a grid of `pitch` units through `anchor`, covering everything
 * placed so far plus a margin.
 */
const slotsAround = (
  placed: readonly PlacedStructure[],
  anchor: Point
): readonly Point[] => {
  const area = grow(
    boundsOf(footprints(placed)).pipe(
      Option.getOrElse(() => ({ ...anchor, w: 0, d: 0 }))
    ),
    searchMargin
  );

  const left = anchor.x - Math.ceil((anchor.x - area.x) / pitch) * pitch;
  const top = anchor.y - Math.ceil((anchor.y - area.y) / pitch) * pitch;
  const columns = Arr.range(0, Math.ceil(area.w / pitch) + 1);
  const rows = Arr.range(0, Math.ceil(area.d / pitch) + 1);

  return Arr.flatMap(rows, (row) =>
    Arr.map(columns, (column) => ({
      x: left + column * pitch,
      y: top + row * pitch,
    }))
  );
};

const by = (key: (spot: Placement) => number) =>
  Order.mapInput(Order.Number, key);

/**
 * The order slots are preferred in: closest to the group and to the
 * structures the hops connect to first. Ties go to slots that don't sit
 * above or left of the anchor, then to the topmost, then the leftmost, so a
 * group grows down and to the right from where it started.
 */
const preference = (score: (spot: Placement) => number, anchor: Point) => {
  const backwards = by(
    (spot) => (spot.y < anchor.y ? 1 : 0) + (spot.x < anchor.x ? 1 : 0)
  );

  const readingOrder = Order.combine(
    by((spot) => spot.y),
    by((spot) => spot.x)
  );

  return Order.combine(by(score), Order.combine(backwards, readingOrder));
};

/**
 * Picks a spot for `structure`. It takes the free slot closest to its group
 * mates and to the structures its hops connect to, on a grid through its
 * first placed mate (or else its first placed neighbour). With nothing to be
 * near, it starts a new zone to the right of everything placed.
 */
const choose = (
  data: MapData,
  placed: readonly PlacedStructure[],
  structure: Structure
): Placement => {
  const neighbours = Arr.flatMap(neighboursOf(data, structure.id), (id) =>
    Option.toArray(
      Arr.findFirst(placed, (other) => other.structure.id === id).pipe(
        Option.map(({ placement }) => placement)
      )
    )
  );

  const mates = footprints(membersOf(placed, structure.group));

  const beside = boundsOf(footprints(placed)).pipe(
    Option.map((all) => ({ x: all.x + all.w + groupGap, y: all.y })),
    Option.getOrElse(() => ({ x: 0, y: 0 }))
  );

  const fallback: Placement = { ...beside, ...defaultFootprint };
  const anchor = mates[0] ?? neighbours[0] ?? beside;
  const zone = boundsOf(mates);

  const score = (spot: Placement) =>
    Option.match(zone, {
      onNone: () => 0,
      onSome: (box) => distance(spot, box),
    }) + Arr.reduce(neighbours, 0, (sum, other) => sum + distance(spot, other));

  const candidates = Arr.filter(
    Arr.map(slotsAround(placed, anchor), (slot) => ({
      ...slot,
      ...defaultFootprint,
    })),
    (placement) => fits(placed, { structure, placement })
  );

  return Arr.isReadonlyArrayNonEmpty(candidates)
    ? Arr.min(candidates, preference(score, anchor))
    : fallback;
};

/** What placement did to a layout. */
export interface PlacedLayout {
  /** Every structure's placement, in data.mjs order. */
  readonly layout: Layout;
  /** The ids of the structures that were given a placement, in order. */
  readonly placed: readonly string[];
  /** The ids of layout entries removed because no structure has them. */
  readonly pruned: readonly string[];
}

/**
 * Gives every structure without a placement one, and drops entries for
 * structures that no longer exist. Structures that already have a placement
 * keep it exactly.
 *
 * New structures are placed one group at a time, in the order of `groups`,
 * and within a group in data.mjs order. Each lands on a half unit with a 2×2
 * footprint, clear of every other footprint, next to its own group and away
 * from other groups' zones. The same input always gives the same result. The
 * revision is left as it is.
 */
export const placeStructures: {
  (layout: Layout): (data: MapData) => PlacedLayout;
  (data: MapData, layout: Layout): PlacedLayout;
} = dual(2, (data: MapData, layout: Layout): PlacedLayout => {
  const ids = new Set(Arr.map(data.structures, ({ id }) => id));
  const pruned = Arr.filter(Rec.keys(layout.structures), (id) => !ids.has(id));

  const groupIndex = new Map(
    Arr.map(data.groups, ({ id }, index) => [id, index])
  );

  const initial = Arr.flatMap(data.structures, (structure) =>
    Option.toArray(
      Option.map(Rec.get(layout.structures, structure.id), (placement) => ({
        structure,
        placement,
      }))
    )
  );

  const unplaced = Arr.sort(
    Arr.filter(data.structures, ({ id }) => !Rec.has(layout.structures, id)),
    Order.mapInput(
      Order.Number,
      (structure: Structure) =>
        groupIndex.get(structure.group) ?? data.groups.length
    )
  );

  const placed = Arr.reduce(unplaced, initial, (sofar, structure) => {
    const spot = choose(data, sofar, structure);

    return [
      ...sofar,
      {
        structure,
        placement: { ...spot, x: toHalfUnit(spot.x), y: toHalfUnit(spot.y) },
      },
    ];
  });

  const byId = new Map(
    Arr.map(placed, ({ structure, placement }) => [structure.id, placement])
  );

  const structures: Record<string, Placement> = {};

  for (const { id } of data.structures) {
    const placement = byId.get(id);

    if (placement !== undefined) {
      structures[id] = placement;
    }
  }

  return {
    layout: { ...layout, structures },
    placed: Arr.map(unplaced, ({ id }) => id),
    pruned,
  };
});
