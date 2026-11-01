import { Array as Arr, Option, Order, Record as Rec } from "effect";
import { dual } from "effect/Function";

import { footprintsOverlap, tagCovers } from "./layout-checks.ts";
import type { PlacedStructure } from "./layout-checks.ts";
import type { Layout, Placement } from "./layout.ts";
import type { MapData, Structure } from "./map-data.ts";
import { zonePadding } from "./zones.ts";

/** The footprint a newly placed structure gets. */
export const defaultFootprint = { w: 2, d: 2 } as const;

/** Clear ground between two structures, so name tags and routes have room. */
export const structureGap = 2;

/** Clear ground left between two zones, for routes to run through. */
export const zoneGap = 2;

/** Clear ground between the footprints of two groups' structures. */
export const groupGap = 2 * zonePadding + zoneGap;

/** Distance between neighbouring slots of a group's grid. */
const pitch = defaultFootprint.w + structureGap;

/** The widest a block's slots are spread to keep name tags clear. */
const widestPitch = 4 * pitch;

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

/**
 * Orders a group's members so that structures joined by hops come next to
 * each other: each next member is the one with the most hops to those
 * already chosen, ties going to data.mjs order.
 */
const connectedOrder = (data: MapData, members: readonly Structure[]) => {
  const ids = new Set(Arr.map(members, ({ id }) => id));

  const links = (a: string, b: string) =>
    Arr.filter(
      data.hops,
      (hop) =>
        (hop.from === a && hop.to === b) || (hop.from === b && hop.to === a)
    ).length;

  const chosen: Structure[] = [];
  let rest = Arr.filter(members, ({ id }) => ids.has(id));

  while (Arr.isReadonlyArrayNonEmpty(rest)) {
    const strength = (candidate: Structure) =>
      Arr.reduce(chosen, 0, (sum, done) => sum + links(candidate.id, done.id));

    const next = Arr.reduce(rest, rest[0], (best, candidate) =>
      strength(candidate) > strength(best) ? candidate : best
    );

    chosen.push(next);
    rest = Arr.filter(rest, (candidate) => candidate.id !== next.id);
  }

  return chosen;
};

/** A cell of a block's grid of slots. */
interface Slot {
  readonly column: number;
  readonly row: number;
}

/** A group's new structures laid out as a block, before it's moved into place. */
interface Block {
  readonly columns: number;
  readonly rows: number;
  /** Distance between neighbouring slots. */
  readonly spacing: number;
  readonly members: readonly {
    readonly structure: Structure;
    readonly slot: Slot;
  }[];
}

const sizeOf = (block: Block) => ({
  w: (block.columns - 1) * block.spacing + defaultFootprint.w,
  d: (block.rows - 1) * block.spacing + defaultFootprint.d,
});

/** A block's members placed with the block's top left corner at `offset`. */
const layBlock = (block: Block, offset: Point): readonly PlacedStructure[] =>
  Arr.map(block.members, ({ structure, slot }) => ({
    structure,
    placement: {
      x: offset.x + slot.column * block.spacing,
      y: offset.y + slot.row * block.spacing,
      ...defaultFootprint,
    },
  }));

/** Whether no name tag in `members` is drawn over another member's box. */
const tagsClear = (members: readonly PlacedStructure[]) =>
  Arr.every(members, (a) =>
    Arr.every(
      members,
      (b) => a.structure.id === b.structure.id || !tagCovers(a, b)
    )
  );

/**
 * Lays out a new group as a block about as wide as it is deep, filled row by
 * row in a snake, so each member sits next to the one before it. Slots are
 * `pitch` apart, widened in half units until no name tag covers a box.
 */
const blockOf = (data: MapData, members: readonly Structure[]): Block => {
  const ordered = connectedOrder(data, members);
  const columns = Math.ceil(Math.sqrt(ordered.length));
  const rows = Math.ceil(ordered.length / columns);

  const slotted = Arr.map(ordered, (structure, index) => {
    const row = Math.floor(index / columns);
    const step = index % columns;
    const column = row % 2 === 0 ? step : columns - 1 - step;

    return { structure, slot: { column, row } };
  });

  const spacings = Arr.map(
    Arr.range(0, (widestPitch - pitch) * 2),
    (step) => pitch + step / 2
  );

  const block = (spacing: number): Block => ({
    columns,
    rows,
    spacing,
    members: slotted,
  });

  const spacing = Option.getOrElse(
    Arr.findFirst(spacings, (candidate) =>
      tagsClear(layBlock(block(candidate), { x: 0, y: 0 }))
    ),
    () => widestPitch
  );

  return block(spacing);
};

/** Where row or column `index` starts, given the sizes of those before it. */
const startOf = (sizes: readonly number[], index: number) =>
  Arr.reduce(sizes.slice(0, index), 0, (sum, size) => sum + size + groupGap);

/**
 * Where each block's top left corner goes when block `index` takes cell
 * `cells[index]` of a grid of rows and columns, `groupGap` apart. The grid
 * starts at the origin, or to the right of everything already placed.
 */
const blockOffsets = (
  placed: readonly PlacedStructure[],
  blocks: readonly Block[],
  cells: readonly number[]
): readonly Point[] => {
  const columns = Math.ceil(Math.sqrt(blocks.length));
  const rowCount = Math.ceil(blocks.length / columns);

  const origin = boundsOf(footprints(placed)).pipe(
    Option.map((all) => ({ x: all.x + all.w + groupGap, y: all.y })),
    Option.getOrElse(() => ({ x: 0, y: 0 }))
  );

  const columnOf = (index: number) => (cells[index] ?? index) % columns;

  const rowOf = (index: number) =>
    Math.floor((cells[index] ?? index) / columns);

  const widths = Arr.map(Arr.range(0, columns - 1), (column) =>
    Math.max(
      0,
      ...Arr.flatMap(blocks, (block, index) =>
        columnOf(index) === column ? [sizeOf(block).w] : []
      )
    )
  );

  const depths = Arr.map(Arr.range(0, rowCount - 1), (row) =>
    Math.max(
      0,
      ...Arr.flatMap(blocks, (block, index) =>
        rowOf(index) === row ? [sizeOf(block).d] : []
      )
    )
  );

  return Arr.map(blocks, (_, index) => ({
    x: origin.x + startOf(widths, columnOf(index)),
    y: origin.y + startOf(depths, rowOf(index)),
  }));
};

/**
 * How well a layout serves its hops: their total length, as grid distance
 * between footprint centres, and how many of them join structures that share
 * neither a ground row nor a column. Hops with an end not in `at` don't count.
 */
interface HopCost {
  readonly length: number;
  readonly misaligned: number;
}

const hopCost = (data: MapData, at: ReadonlyMap<string, Placement>): HopCost =>
  Arr.reduce(data.hops, { length: 0, misaligned: 0 }, (sum, hop) => {
    const from = at.get(hop.from);
    const to = at.get(hop.to);

    if (from === undefined || to === undefined) {
      return sum;
    }

    const a = centreOf(from);
    const b = centreOf(to);

    return {
      length: sum.length + Math.abs(a.x - b.x) + Math.abs(a.y - b.y),
      misaligned: sum.misaligned + (a.x !== b.x && a.y !== b.y ? 1 : 0),
    };
  });

/** Shorter hops first, then fewer hops off a shared row or column. */
const cheaper = Order.combine(
  Order.mapInput(Order.Number, (cost: HopCost) => cost.length),
  Order.mapInput(Order.Number, (cost: HopCost) => cost.misaligned)
);

const placementsOf = (placed: readonly PlacedStructure[]) =>
  new Map(
    Arr.map(placed, ({ structure, placement }) => [structure.id, placement])
  );

/** Every ordering of `0` to `count - 1`, in lexicographic order. */
const permutations = (count: number): readonly (readonly number[])[] => {
  const extend = (
    prefix: readonly number[],
    rest: readonly number[]
  ): readonly (readonly number[])[] =>
    Arr.isReadonlyArrayNonEmpty(rest)
      ? Arr.flatMap(rest, (next) =>
          extend(
            [...prefix, next],
            Arr.filter(rest, (other) => other !== next)
          )
        )
      : [prefix];

  return extend([], Arr.range(0, count - 1));
};

/** The most groups whose every arrangement is tried. */
const exhaustiveGroups = 8;

const swapped = (items: readonly number[], i: number, j: number) =>
  Arr.map(items, (item, index) => {
    if (index === i) {
      return items[j] ?? item;
    }

    return index === j ? (items[i] ?? item) : item;
  });

/**
 * Starting from `start`, swaps pairs of entries while a swap makes `cost`
 * cheaper, trying pairs in order. Every accepted swap lowers the cost, so it
 * stops.
 */
const improveBySwaps = (
  start: readonly number[],
  cost: (items: readonly number[]) => HopCost
) => {
  let best = start;
  let bestCost = cost(start);
  let improved = true;

  while (improved) {
    improved = false;

    for (const i of Arr.range(0, best.length - 1)) {
      for (const j of Arr.range(i + 1, best.length - 1)) {
        const candidate = swapped(best, i, j);
        const candidateCost = cost(candidate);

        if (cheaper(candidateCost, bestCost) < 0) {
          best = candidate;
          bestCost = candidateCost;
          improved = true;
        }
      }
    }
  }

  return best;
};

/**
 * The grid cell each block takes, so that hops are as short as they can be.
 * With up to `exhaustiveGroups` blocks every arrangement is tried; past that,
 * swaps improve on `groups` order. Ties keep the arrangement closest to
 * `groups` order.
 */
const cellsFor = (
  data: MapData,
  placed: readonly PlacedStructure[],
  blocks: readonly Block[]
): readonly number[] => {
  const cost = (cells: readonly number[]) => {
    const offsets = blockOffsets(placed, blocks, cells);

    return hopCost(
      data,
      placementsOf([
        ...placed,
        ...Arr.flatMap(blocks, (block, index) =>
          layBlock(block, offsets[index] ?? { x: 0, y: 0 })
        ),
      ])
    );
  };

  const inOrder: readonly number[] = Arr.range(0, blocks.length - 1);

  if (blocks.length > exhaustiveGroups) {
    return improveBySwaps(inOrder, cost);
  }

  return Arr.reduce(
    permutations(blocks.length),
    { cells: inOrder, cost: cost(inOrder) },
    (best, cells) => {
      const next = cost(cells);

      return cheaper(next, best.cost) < 0 ? { cells, cost: next } : best;
    }
  ).cells;
};

/**
 * Moves a block's members between its slots while that shortens the hops to
 * everything in `others`, so a structure whose hops leave the group sits on
 * the side of the block facing where they go. A move that would put a name
 * tag over a box is skipped.
 */
const faceNeighbours = (
  data: MapData,
  others: readonly PlacedStructure[],
  { block, offset }: { readonly block: Block; readonly offset: Point }
): Block => {
  const slots = Arr.flatMap(Arr.range(0, block.rows - 1), (row) =>
    Arr.map(Arr.range(0, block.columns - 1), (column) => ({ column, row }))
  );

  // `order[slot]` is the member in that slot, or an index past the members
  // for an empty one.
  const start = Arr.map(slots, (slot, index) =>
    Option.getOrElse(
      Arr.findFirstIndex(
        block.members,
        (member) =>
          member.slot.column === slot.column && member.slot.row === slot.row
      ),
      () => block.members.length + index
    )
  );

  const blockFrom = (order: readonly number[]): Block => ({
    ...block,
    members: Arr.flatMap(order, (member, index) => {
      const structure = block.members[member]?.structure;
      const slot = slots[index];

      return structure === undefined || slot === undefined
        ? []
        : [{ structure, slot }];
    }),
  });

  const unusable = { length: Infinity, misaligned: Infinity };

  const cost = (order: readonly number[]) => {
    const laid = layBlock(blockFrom(order), offset);

    return tagsClear(laid)
      ? hopCost(data, placementsOf([...others, ...laid]))
      : unusable;
  };

  return blockFrom(improveBySwaps(start, cost));
};

/**
 * Lays out the blocks of groups that have nothing placed yet. Blocks take
 * the cells of a grid of rows and columns that make hops shortest, and then
 * each block's members move to the side facing the structures their hops
 * connect to.
 */
const arrangeBlocks = (
  data: MapData,
  placed: readonly PlacedStructure[],
  blocks: readonly Block[]
): readonly PlacedStructure[] => {
  const cells = cellsFor(data, placed, blocks);
  const offsets = blockOffsets(placed, blocks, cells);
  const offsetOf = (index: number) => offsets[index] ?? { x: 0, y: 0 };

  const faced = Arr.reduce(
    Arr.range(0, blocks.length - 1),
    blocks,
    (sofar, index) => {
      const block = sofar[index];

      if (block === undefined) {
        return sofar;
      }

      const others = [
        ...placed,
        ...Arr.flatMap(sofar, (other, at) =>
          at === index ? [] : layBlock(other, offsetOf(at))
        ),
      ];

      const next = faceNeighbours(data, others, {
        block,
        offset: offsetOf(index),
      });

      return Arr.map(sofar, (other, at) => (at === index ? next : other));
    }
  );

  return Arr.flatMap(faced, (block, index) => layBlock(block, offsetOf(index)));
};

/** What placement did to a layout. */
export interface PlacedLayout {
  /** Every structure's placement, in data.mjs order. */
  readonly layout: Layout;
  /** The ids of the structures that were given a placement, in order. */
  readonly placed: readonly string[];
  /** The ids of layout entries removed because no structure has them. */
  readonly pruned: readonly string[];
  /** The ids of route overrides removed because no hop has them. */
  readonly prunedRoutes: readonly string[];
}

/**
 * Gives every structure without a placement one, and drops entries for
 * structures that no longer exist and route overrides for hops that no
 * longer exist. Structures that already have a placement
 * keep it exactly.
 *
 * A group with nothing placed yet is laid out as a block about as wide as it
 * is deep, with structures joined by hops next to each other, and the blocks
 * sit in rows and columns in `groups` order. A new structure in a group that
 * already has placed members takes the free slot nearest its group and the
 * structures its hops connect to. Every new placement lands on a half unit
 * with a 2×2 footprint, clear of every other footprint and name tag, and
 * keeps its zone `groupGap` away from other groups' structures. The same
 * input always gives the same result. The revision is left as it is.
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

  // Groups with nothing placed yet are laid out as blocks. The rest of the
  // new structures join their group one at a time.
  const placedGroups = new Set(
    Arr.map(initial, ({ structure }) => structure.group)
  );

  const fresh = Arr.filter(
    Arr.dedupe(Arr.map(unplaced, ({ group }) => group)),
    (group) => !placedGroups.has(group)
  );

  const blocks = arrangeBlocks(
    data,
    initial,
    Arr.map(fresh, (group) =>
      blockOf(
        data,
        Arr.filter(unplaced, (structure) => structure.group === group)
      )
    )
  );

  const blockSpot = new Map(
    Arr.map(blocks, ({ structure, placement }) => [structure.id, placement])
  );

  const placed = Arr.reduce(unplaced, initial, (sofar, structure) => {
    // A block spot is kept unless something placed by hand is in its way.
    const planned = Option.filter(
      Option.fromNullishOr(blockSpot.get(structure.id)),
      (placement) => fits(sofar, { structure, placement })
    );

    const spot = Option.getOrElse(planned, () =>
      choose(data, sofar, structure)
    );

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

  const hopIds = new Set(Arr.map(data.hops, ({ id }) => id));
  const routes = layout.routes ?? {};
  const prunedRoutes = Arr.filter(Rec.keys(routes), (id) => !hopIds.has(id));

  const kept =
    layout.routes === undefined
      ? {}
      : { routes: Rec.filter(routes, (_, id) => hopIds.has(id)) };

  return {
    layout: { ...layout, structures, ...kept },
    placed: Arr.map(unplaced, ({ id }) => id),
    pruned,
    prunedRoutes,
  };
});
