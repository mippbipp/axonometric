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

const origin: Point = { x: 0, y: 0 };

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
    Option.getOrElse(() => origin)
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

/** The same key for two ids whichever comes first. */
const pairKey = (a: string, b: string) => (a < b ? `${a}\n${b}` : `${b}\n${a}`);

/**
 * Orders a group's members so that structures joined by hops come next to
 * each other: each next member is the one with the most hops to those
 * already chosen, ties going to data.mjs order.
 */
const connectedOrder = (data: MapData, members: readonly Structure[]) => {
  const ids = new Set(Arr.map(members, ({ id }) => id));

  const counts = new Map<string, number>();

  for (const hop of data.hops) {
    if (ids.has(hop.from) && ids.has(hop.to)) {
      const key = pairKey(hop.from, hop.to);

      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  const links = (a: string, b: string) => counts.get(pairKey(a, b)) ?? 0;

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

/** Where `slot` of a block with its top left corner at `offset` lies. */
const slotSpot = (block: Block, offset: Point, slot: Slot): Placement => ({
  x: offset.x + slot.column * block.spacing,
  y: offset.y + slot.row * block.spacing,
  ...defaultFootprint,
});

/** A block's members placed with the block's top left corner at `offset`. */
const layBlock = (block: Block, offset: Point): readonly PlacedStructure[] =>
  Arr.map(block.members, ({ structure, slot }) => ({
    structure,
    placement: slotSpot(block, offset, slot),
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
      tagsClear(layBlock(block(candidate), origin))
    ),
    () => widestPitch
  );

  return block(spacing);
};

/** Where row or column `index` starts, given the sizes of those before it. */
const startOf = (sizes: readonly number[], index: number) =>
  Arr.reduce(sizes.slice(0, index), 0, (sum, size) => sum + size + groupGap);

/** Marks a grid cell, or a block's slot, that nothing takes. */
const empty = -1;

/**
 * The grid of rows and columns blocks are arranged in: about as wide as it
 * is deep, with a cell for every block and the rest of the last row spare.
 */
const gridFor = (count: number) => {
  const columns = Math.ceil(Math.sqrt(count));

  return { columns, cells: columns * Math.ceil(count / columns) };
};

/** Where blocks start: the origin, or right of everything already placed. */
const blocksStart = (placed: readonly PlacedStructure[]): Point =>
  boundsOf(footprints(placed)).pipe(
    Option.map((all) => ({ x: all.x + all.w + groupGap, y: all.y })),
    Option.getOrElse(() => origin)
  );

/**
 * Where each block's top left corner goes when `occupants[cell]` is the
 * block in each grid cell, or `empty`. Each row and column is as big as its
 * biggest block, `groupGap` from the next.
 */
const blockOffsets = (
  placed: readonly PlacedStructure[],
  blocks: readonly Block[],
  occupants: readonly number[]
): readonly Point[] => {
  const { columns, cells } = gridFor(blocks.length);
  const start = blocksStart(placed);

  const cellOf = new Map(
    Arr.map(occupants, (block, cell) => [block, cell] as const)
  );

  const columnOf = (index: number) => (cellOf.get(index) ?? index) % columns;

  const rowOf = (index: number) =>
    Math.floor((cellOf.get(index) ?? index) / columns);

  const widths = Arr.map(Arr.range(0, columns - 1), (column) =>
    Math.max(
      0,
      ...Arr.flatMap(blocks, (block, index) =>
        columnOf(index) === column ? [sizeOf(block).w] : []
      )
    )
  );

  const depths = Arr.map(Arr.range(0, cells / columns - 1), (row) =>
    Math.max(
      0,
      ...Arr.flatMap(blocks, (block, index) =>
        rowOf(index) === row ? [sizeOf(block).d] : []
      )
    )
  );

  return Arr.map(blocks, (_, index) => ({
    x: start.x + startOf(widths, columnOf(index)),
    y: start.y + startOf(depths, rowOf(index)),
  }));
};

/** Every block's members, each block laid out at its offset. */
const layBlocks = (blocks: readonly Block[], offsets: readonly Point[]) =>
  Arr.flatMap(blocks, (block, index) =>
    layBlock(block, offsets[index] ?? origin)
  );

/**
 * How well a layout serves its hops: their total length, as grid distance
 * between footprint centres, and how many of them join structures that share
 * neither a ground row nor a column.
 */
interface HopCost {
  readonly length: number;
  readonly misaligned: number;
}

/** Whether two footprints' centres share neither a ground row nor a column. */
const misaligned = (a: Placement, b: Placement) => {
  const first = centreOf(a);
  const second = centreOf(b);

  return first.x !== second.x && first.y !== second.y;
};

/** What `hops` cost with structures at `at`. Hops with an end not in `at` don't count. */
const hopCost = (
  hops: MapData["hops"],
  at: ReadonlyMap<string, Placement>
): HopCost =>
  Arr.reduce(hops, { length: 0, misaligned: 0 }, (sum, hop) => {
    const from = at.get(hop.from);
    const to = at.get(hop.to);

    if (from === undefined || to === undefined) {
      return sum;
    }

    return {
      length: sum.length + distance(from, to),
      misaligned: sum.misaligned + (misaligned(from, to) ? 1 : 0),
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

const swapped = (items: readonly number[], i: number, j: number) =>
  Arr.map(items, (item, index) => {
    if (index === i) {
      return items[j] ?? item;
    }

    return index === j ? (items[i] ?? item) : item;
  });

/**
 * Starting from `start`, swaps pairs of entries while a swap makes `cost`
 * cheaper and is `allowed`, trying pairs in order. Every accepted swap
 * lowers the cost, so it stops.
 */
const improveBySwaps = (
  start: readonly number[],
  cost: (items: readonly number[]) => HopCost,
  allowed: (
    items: readonly number[],
    moved: readonly [number, number]
  ) => boolean = () => true
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

        if (
          cheaper(candidateCost, bestCost) < 0 &&
          allowed(candidate, [i, j])
        ) {
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
 * What putting blocks in grid cells costs, worked out once so the search
 * never lays a block out. For blocks `a > b` in cells `ca` and `cb`, the
 * hops between them cost `pairLength` and `pairOff` at
 * `((a * blocks + b) * cells + ca) * cells + cb`, and at least
 * `pairLeast[a * blocks + b]` in any two different cells. A block's hops to
 * structures already placed cost `placedLength` and `placedOff` at
 * `block * cells + cell`. Lengths are grid distances between footprint
 * centres; the `Off` counts are hops whose ends share neither a ground row
 * nor a column. Cells are spaced as if every block were as big as the
 * biggest one.
 */
interface CellWeights {
  readonly blocks: number;
  readonly cells: number;
  readonly pairLength: Float64Array;
  readonly pairOff: Float64Array;
  readonly pairLeast: Float64Array;
  readonly placedLength: Float64Array;
  readonly placedOff: Float64Array;
}

/** Adds one hop between centres `a` and `b` to the costs at `at`. */
const addHop = (
  {
    length,
    off,
  }: { readonly length: Float64Array; readonly off: Float64Array },
  at: number,
  [a, b]: readonly [Point, Point]
) => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;

  length[at] = (length[at] ?? 0) + Math.abs(dx) + Math.abs(dy);
  off[at] = (off[at] ?? 0) + (dx !== 0 && dy !== 0 ? 1 : 0);
};

const shifted = (point: Point, offset: Point): Point => ({
  x: point.x + offset.x,
  y: point.y + offset.y,
});

/** For each pair of blocks, the least their hops cost in two different cells. */
const leastPairCosts = (
  pairLength: Float64Array,
  { blocks, cells }: { readonly blocks: number; readonly cells: number }
) =>
  Float64Array.from(Arr.range(0, blocks * blocks - 1), (pair) => {
    let least = Infinity;

    for (let ca = 0; ca < cells; ca += 1) {
      for (let cb = 0; cb < cells; cb += 1) {
        if (ca !== cb) {
          least = Math.min(
            least,
            pairLength[(pair * cells + ca) * cells + cb] ?? 0
          );
        }
      }
    }

    return least === Infinity ? 0 : least;
  });

const cellWeights = (
  data: MapData,
  placed: readonly PlacedStructure[],
  blocks: readonly Block[]
): CellWeights => {
  const { columns, cells } = gridFor(blocks.length);
  const count = blocks.length;
  const sizes = Arr.map(blocks, sizeOf);
  const cellW = Math.max(0, ...Arr.map(sizes, ({ w }) => w)) + groupGap;
  const cellD = Math.max(0, ...Arr.map(sizes, ({ d }) => d)) + groupGap;
  const start = blocksStart(placed);
  const fixed = placementsOf(placed);

  const corners = Arr.map(Arr.range(0, cells - 1), (cell) => ({
    x: start.x + (cell % columns) * cellW,
    y: start.y + Math.floor(cell / columns) * cellD,
  }));

  // Each new structure's block, and its centre with its block's top left
  // corner at the origin.
  const member = new Map(
    Arr.flatMap(blocks, (block, index) =>
      Arr.map(layBlock(block, origin), ({ structure, placement }) => [
        structure.id,
        { block: index, centre: centreOf(placement) },
      ])
    )
  );

  const pair = {
    length: new Float64Array(count * count * cells * cells),
    off: new Float64Array(count * count * cells * cells),
  };

  const toPlaced = {
    length: new Float64Array(count * cells),
    off: new Float64Array(count * cells),
  };

  for (const hop of data.hops) {
    const from = member.get(hop.from);
    const to = member.get(hop.to);
    const end = fixed.get(from === undefined ? hop.from : hop.to);
    const own = from ?? to;

    if (from !== undefined && to !== undefined && from.block !== to.block) {
      const [high, low] = from.block > to.block ? [from, to] : [to, from];
      const base = (high.block * count + low.block) * cells * cells;

      for (const [ca, a] of corners.entries()) {
        for (const [cb, b] of corners.entries()) {
          addHop(pair, base + ca * cells + cb, [
            shifted(high.centre, a),
            shifted(low.centre, b),
          ]);
        }
      }
    } else if (
      (from === undefined) !== (to === undefined) &&
      own !== undefined &&
      end !== undefined
    ) {
      for (const [cell, corner] of corners.entries()) {
        addHop(toPlaced, own.block * cells + cell, [
          shifted(own.centre, corner),
          centreOf(end),
        ]);
      }
    }
  }

  return {
    blocks: count,
    cells,
    pairLength: pair.length,
    pairOff: pair.off,
    pairLeast: leastPairCosts(pair.length, { blocks: count, cells }),
    placedLength: toPlaced.length,
    placedOff: toPlaced.off,
  };
};

/** What `cells[block]`, the cell each block takes, costs under `weights`. */
const cellsCost = (weights: CellWeights, cells: readonly number[]): HopCost => {
  const { blocks, cells: cellCount, pairLength, pairOff } = weights;
  let length = 0;
  let off = 0;

  for (const [a, ca] of cells.entries()) {
    length += weights.placedLength[a * cellCount + ca] ?? 0;
    off += weights.placedOff[a * cellCount + ca] ?? 0;

    for (const [b, cb] of cells.slice(0, a).entries()) {
      const at = ((a * blocks + b) * cellCount + ca) * cellCount + cb;

      length += pairLength[at] ?? 0;
      off += pairOff[at] ?? 0;
    }
  }

  return { length, misaligned: off };
};

/** How many of the cheapest arrangements by weight are measured exactly. */
const shortlist = 32;

/**
 * Tries every way to give each block its own cell, block 0's choice first,
 * and returns the `shortlist` cheapest by `weights`, cheapest first, ties
 * in the order found. A partial arrangement that, with the least the
 * remaining blocks could add, already costs more than the last one kept is
 * skipped. This runs hundreds of thousands of times, so it works on plain
 * numbers and allocates nothing in the inner loop.
 */
const cheapestCells = (
  weights: CellWeights
): readonly (readonly number[])[] => {
  const {
    blocks,
    cells,
    pairLength,
    pairOff,
    pairLeast,
    placedLength,
    placedOff,
  } = weights;

  // `rest[depth]` is the least the blocks from `depth` on can add: their
  // hops to placed structures from their best cell, and their hops to
  // earlier blocks at their shortest.
  const rest = new Float64Array(blocks + 1);

  for (let block = blocks - 1; block >= 0; block -= 1) {
    let least = Infinity;

    for (let cell = 0; cell < cells; cell += 1) {
      least = Math.min(least, placedLength[block * cells + cell] ?? 0);
    }

    for (let earlier = 0; earlier < block; earlier += 1) {
      least += pairLeast[block * blocks + earlier] ?? 0;
    }

    rest[block] = (rest[block + 1] ?? 0) + least;
  }

  const kept: { cells: readonly number[]; length: number; off: number }[] = [];

  let worstLength = Infinity;
  let worstOff = Infinity;
  const taken = new Uint8Array(cells);
  const chosen = new Int32Array(blocks);

  const keep = (length: number, off: number) => {
    const at = Option.getOrElse(
      Arr.findFirstIndex(
        kept,
        (other) =>
          length < other.length || (length === other.length && off < other.off)
      ),
      () => kept.length
    );

    kept.splice(at, 0, {
      cells: [...chosen],
      length,
      off,
    });

    if (kept.length > shortlist) {
      kept.pop();
    }

    if (kept.length === shortlist) {
      worstLength = kept.at(-1)?.length ?? Infinity;
      worstOff = kept.at(-1)?.off ?? Infinity;
    }
  };

  const extend = (depth: number, length: number, off: number) => {
    if (depth === blocks) {
      keep(length, off);

      return;
    }

    for (let cell = 0; cell < cells; cell += 1) {
      if (taken[cell] === 0) {
        let nextLength = length + (placedLength[depth * cells + cell] ?? 0);
        let nextOff = off + (placedOff[depth * cells + cell] ?? 0);

        for (let earlier = 0; earlier < depth; earlier += 1) {
          const at =
            ((depth * blocks + earlier) * cells + cell) * cells +
            (chosen[earlier] ?? 0);

          nextLength += pairLength[at] ?? 0;
          nextOff += pairOff[at] ?? 0;
        }

        const least = nextLength + (rest[depth + 1] ?? 0);

        if (
          least < worstLength ||
          (least === worstLength && nextOff < worstOff)
        ) {
          taken[cell] = 1;
          chosen[depth] = cell;
          extend(depth + 1, nextLength, nextOff);
          taken[cell] = 0;
        }
      }
    }
  };

  extend(0, 0, 0);

  return Arr.map(kept, ({ cells: found }) => found);
};

/**
 * The most groups whose every arrangement is tried. Eight groups fill a 3×3
 * grid, 9! = 362,880 arrangements. With precomputed weights and pruning,
 * that search took about 32 ms for 8 groups of 16, and all of placement
 * about 90 ms, inside the 100 ms `build` can spend. Nine groups need a 4×3
 * grid, 12!/3! = 80 million arrangements, well past that, so past eight the
 * search only improves `groups` order by swaps.
 */
const exhaustiveGroups = 8;

/** The cell each of `count` blocks takes, from the block in each cell. */
const cellsOf = (occupants: readonly number[], count: number) =>
  Arr.map(Arr.range(0, count - 1), (block) => occupants.indexOf(block));

/** The block in each of `cellCount` cells, or `empty`, from each block's cell. */
const occupantsOf = (cells: readonly number[], cellCount: number) =>
  Arr.map(Arr.range(0, cellCount - 1), (cell) => {
    const block = cells.indexOf(cell);

    return block === -1 ? empty : block;
  });

/**
 * The block in each grid cell, or `empty`, so that hops are as short as they
 * can be and then as many as possible join blocks in a shared row or
 * column. Empty cells can fall anywhere. Ties keep `groups` order, with the
 * spare cells last, and then the first of the shortlist, which lists equal
 * weights in lexicographic order of each block's cell.
 */
const occupantsFor = (
  data: MapData,
  placed: readonly PlacedStructure[],
  blocks: readonly Block[]
): readonly number[] => {
  const weights = cellWeights(data, placed, blocks);
  const inOrder = occupantsOf(Arr.range(0, blocks.length - 1), weights.cells);

  if (blocks.length > exhaustiveGroups) {
    return improveBySwaps(inOrder, (occupants) =>
      cellsCost(weights, cellsOf(occupants, blocks.length))
    );
  }

  // The weights space cells evenly, but rows and columns really take only
  // the room their blocks need, so the shortlist is measured as laid out.
  const measured = (occupants: readonly number[]) => {
    const offsets = blockOffsets(placed, blocks, occupants);

    return hopCost(
      data.hops,
      placementsOf([...placed, ...layBlocks(blocks, offsets)])
    );
  };

  return Arr.reduce(
    Arr.map(cheapestCells(weights), (cells) =>
      occupantsOf(cells, weights.cells)
    ),
    { occupants: inOrder, cost: measured(inOrder) },
    (best, occupants) => {
      const cost = measured(occupants);

      return cheaper(cost, best.cost) < 0 ? { occupants, cost } : best;
    }
  ).occupants;
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

  // `order[slot]` is the index of the member in that slot, or `empty`.
  const start = Arr.map(slots, (slot) =>
    Option.getOrElse(
      Arr.findFirstIndex(
        block.members,
        (member) =>
          member.slot.column === slot.column && member.slot.row === slot.row
      ),
      () => empty
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

  // What each member's hops to `others` cost from each slot, and how many
  // hops join each pair of members, worked out once for the search.
  const fixed = placementsOf(others);
  const count = block.members.length;
  const spots = Arr.map(slots, (slot) => slotSpot(block, offset, slot));

  const memberOf = new Map(
    Arr.map(block.members, ({ structure }, index) => [structure.id, index])
  );

  const ends = Arr.map(block.members, (): Placement[] => []);
  const within = Arr.map(Arr.range(0, count * count - 1), () => 0);

  for (const hop of data.hops) {
    const from = memberOf.get(hop.from);
    const to = memberOf.get(hop.to);

    if (from !== undefined && to !== undefined) {
      if (from !== to) {
        within[from * count + to] = (within[from * count + to] ?? 0) + 1;
        within[to * count + from] = (within[to * count + from] ?? 0) + 1;
      }
    } else if (from !== undefined || to !== undefined) {
      const end = fixed.get(from === undefined ? hop.from : hop.to);

      if (end !== undefined) {
        ends[from ?? to ?? 0]?.push(end);
      }
    }
  }

  const toOthers = Arr.flatMap(ends, (placements) =>
    Arr.map(spots, (spot) =>
      Arr.reduce(placements, { length: 0, misaligned: 0 }, (sum, end) => ({
        length: sum.length + distance(spot, end),
        misaligned: sum.misaligned + (misaligned(spot, end) ? 1 : 0),
      }))
    )
  );

  const slotDistance = Arr.flatMap(spots, (a) =>
    Arr.map(spots, (b) => distance(a, b))
  );

  const slotOffLine = Arr.flatMap(spots, (a) =>
    Arr.map(spots, (b) => (misaligned(a, b) ? 1 : 0))
  );

  const slotOf = new Int32Array(count);

  const cost = (order: readonly number[]): HopCost => {
    for (const [slot, member] of order.entries()) {
      if (member !== empty) {
        slotOf[member] = slot;
      }
    }

    let length = 0;
    let off = 0;

    for (let member = 0; member < count; member += 1) {
      const slot = slotOf[member] ?? 0;
      const own = toOthers[member * slots.length + slot];

      length += own?.length ?? 0;
      off += own?.misaligned ?? 0;

      for (let other = 0; other < member; other += 1) {
        const links = within[member * count + other] ?? 0;

        if (links > 0) {
          const pair = slot * slots.length + (slotOf[other] ?? 0);

          length += links * (slotDistance[pair] ?? 0);
          off += links * (slotOffLine[pair] ?? 0);
        }
      }
    }

    return { length, misaligned: off };
  };

  return blockFrom(
    improveBySwaps(start, cost, (order, moved) => {
      const laid = layBlock(blockFrom(order), offset);

      const movedIds = new Set(
        Arr.flatMap(moved, (slot) =>
          Option.toArray(
            Option.map(
              Option.fromNullishOr(block.members[order[slot] ?? empty]),
              ({ structure }) => structure.id
            )
          )
        )
      );

      // Only tags and boxes of the members that moved can newly clash.
      return Arr.every(laid, (a) =>
        Arr.every(
          laid,
          (b) =>
            a.structure.id === b.structure.id ||
            (!movedIds.has(a.structure.id) && !movedIds.has(b.structure.id)) ||
            !tagCovers(a, b)
        )
      );
    })
  );
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
  const offsets = blockOffsets(
    placed,
    blocks,
    occupantsFor(data, placed, blocks)
  );

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
        ...layBlocks(
          Arr.filter(sofar, (_, at) => at !== index),
          Arr.filter(offsets, (_, at) => at !== index)
        ),
      ];

      const next = faceNeighbours(data, others, {
        block,
        offset: offsets[index] ?? origin,
      });

      return Arr.map(sofar, (other, at) => (at === index ? next : other));
    }
  );

  return layBlocks(faced, offsets);
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
 * is deep, with structures joined by hops next to each other. The blocks
 * sit in rows and columns arranged to shorten the hops between groups, and
 * members move to the side of their block facing where their hops go. A new structure in a group that
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
