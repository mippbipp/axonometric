import { Array as Arr, Option, Order, Record as Rec, Result } from "effect";
import { dual } from "effect/Function";

import { isDetour } from "./detours.ts";
import { boxOutline, nameTagRect, nameTagText, tagCoversBox } from "./iso.ts";
import type { ScreenPoint, ScreenRect } from "./iso.ts";
import { footprintsOverlap, spanOf, tagCovers } from "./layout-checks.ts";
import type { PlacedStructure } from "./layout-checks.ts";
import type { Layout, Placement } from "./layout.ts";
import type { MapData, Structure } from "./map-data.ts";
import { views } from "./plan.ts";
import { routeRevealed } from "./routing.ts";
import { sceneClashes, sceneOf } from "./scene.ts";
import { zonePadding } from "./zones.ts";

/** The footprint a newly placed structure gets. */
export const defaultFootprint = { d: 2, w: 2 } as const;

/** Clear ground between two structures, so name tags and routes have room. */
export const structureGap = 2;

/** Clear ground left between two zones, for routes to run through. */
const zoneGap = 2;

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
  d: box.d + 2 * by,
  w: box.w + 2 * by,
  x: box.x - by,
  y: box.y - by,
});

const boundsOf = (
  boxes: ReadonlyArray<Placement>
): Option.Option<Placement> => {
  if (!Arr.isReadonlyArrayNonEmpty(boxes)) {
    return Option.none();
  }

  const left = Math.min(...Arr.map(boxes, (box) => box.x));
  const top = Math.min(...Arr.map(boxes, (box) => box.y));
  const right = Math.max(...Arr.map(boxes, (box) => box.x + box.w));
  const bottom = Math.max(...Arr.map(boxes, (box) => box.y + box.d));

  return Option.some({ d: bottom - top, w: right - left, x: left, y: top });
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

const footprints = (placed: ReadonlyArray<PlacedStructure>) =>
  Arr.map(placed, ({ placement }) => placement);

const membersOf = (placed: ReadonlyArray<PlacedStructure>, group: string) =>
  Arr.filter(placed, ({ structure }) => structure.group === group);

/** The ground a group's placed structures cover. */
const zoneOf = (placed: ReadonlyArray<PlacedStructure>, group: string) =>
  boundsOf(footprints(membersOf(placed, group)));

/** The zones of every group but `group`, from what's placed so far. */
const otherZones = (placed: ReadonlyArray<PlacedStructure>, group: string) =>
  Arr.flatMap(
    Arr.dedupe(Arr.map(placed, ({ structure }) => structure.group)),
    (other) => (other === group ? [] : Option.toArray(zoneOf(placed, other)))
  );

const apart = (a: Placement, b: Placement, gap: number) =>
  !footprintsOverlap(grow(a, gap / 2), grow(b, gap / 2));

/** A placed structure's name tag and box outline on screen, in the Iso view. */
interface Drawn {
  readonly outline: ReadonlyArray<ScreenPoint>;
  readonly tag: ScreenRect;
}

const drawnOf = ({ placement, structure }: PlacedStructure): Drawn => ({
  outline: boxOutline(placement, structure.shape),
  tag: nameTagRect(placement, nameTagText(structure)),
});

/** What `fits` measures a candidate against: the structures placed so far. */
interface Ground {
  /** Each placed structure's tag and outline, in `placed` order. */
  readonly drawn: ReadonlyArray<Drawn>;
  readonly placed: ReadonlyArray<PlacedStructure>;
  /** The zones of every group but the candidate's. */
  readonly zones: ReadonlyArray<Placement>;
}

const groundFor = (
  placed: ReadonlyArray<PlacedStructure>,
  group: string
): Ground => ({
  drawn: Arr.map(placed, drawnOf),
  placed,
  zones: otherZones(placed, group),
});

/**
 * Whether `candidate` is a good spot: clear of every footprint by the
 * structure gap, with no name tag drawn over a box either way, and with its
 * group's zone kept clear of every other zone by the group gap.
 */
const fits = ({ drawn, placed, zones }: Ground, candidate: PlacedStructure) => {
  const spot = candidate.placement;

  const zone = boundsOf([
    ...footprints(membersOf(placed, candidate.structure.group)),
    spot,
  ]).pipe(Option.getOrElse(() => spot));

  // The zone test is the cheaper, and on a map of many groups it turns
  // most slots away.
  if (!Arr.every(zones, (other) => apart(zone, other, groupGap))) {
    return false;
  }

  const own = drawnOf(candidate);

  return Arr.every(placed, (other, index) => {
    const theirs = drawn[index] ?? drawnOf(other);

    return (
      apart(spot, other.placement, structureGap) &&
      !tagCoversBox(own.tag, theirs.outline) &&
      !tagCoversBox(theirs.tag, own.outline)
    );
  });
};

/**
 * The ids of the structures `id`'s hops connect it to, once per hop, so a
 * structure joined by three hops counts three times.
 */
const neighboursOf = (data: MapData, id: string) =>
  Arr.flatMap(data.hops, (hop) => {
    if (hop.from === id && hop.to !== id) {
      return [hop.to];
    }

    return hop.to === id && hop.from !== id ? [hop.from] : [];
  });

/**
 * Slots on a grid of `pitch` units through `anchor`, covering everything
 * placed so far plus a margin.
 */
const slotsAround = (
  placed: ReadonlyArray<PlacedStructure>,
  anchor: Point
): ReadonlyArray<Point> => {
  const area = grow(
    boundsOf(footprints(placed)).pipe(
      Option.getOrElse(() => ({ ...anchor, d: 0, w: 0 }))
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
 * How many placed structures other than `a` and `b` stand in the ground
 * between them, the rectangle their footprints span. A hop's route has to
 * go round each one.
 */
const inTheWay = (
  placed: ReadonlyArray<PlacedStructure>,
  a: Placement,
  b: Placement
) => {
  const between = spanOf(a, b);

  return Arr.reduce(placed, 0, (count, { placement }) =>
    placement !== a && placement !== b && footprintsOverlap(placement, between)
      ? count + 1
      : count
  );
};

/**
 * The most slots placement draws to compare for the structure of a
 * one-member group.
 */
const drawnCandidates = 6;

/**
 * How many slots placement draws in all, shared between the one-member
 * groups, so a map with many keeps `build` quick. Each drawing routes and
 * lays out part of a chapter, a few tens of milliseconds.
 */
const drawingBudget = 12;

/**
 * The structures a hop away from `id`, and a hop away from those: the part
 * of the map a structure placed at a slot changes the drawing of.
 */
const nearbyOf = (data: MapData, id: string) => {
  const first = new Set([id, ...neighboursOf(data, id)]);

  return new Set([
    ...first,
    ...Arr.flatMap([...first], (near) => neighboursOf(data, near)),
  ]);
};

/** A slot placement tests against the ground, or one it draws to compare. */
export type PlacementWork = "slot" | "drawing";

/** A structure being placed, and the map placed around it so far. */
interface Placing {
  readonly data: MapData;
  readonly onWork: (work: PlacementWork) => void;
  readonly placed: ReadonlyArray<PlacedStructure>;
  readonly structure: Structure;
}

/**
 * The structures to draw for `structure`: those near it that are placed,
 * revealed by the chapter that reveals it, with that chapter's hops
 * labelled first. A map with no chapters draws them all.
 */
const drawnAround = (
  { data, structure }: Placing,
  structures: Readonly<Record<string, Placement>>
) => {
  const nearby = nearbyOf(data, structure.id);
  const shown = (id: string) => nearby.has(id) && Rec.has(structures, id);

  const index = Arr.findFirstIndex(data.chapters, ({ reveals }) =>
    reveals.includes(structure.id)
  );

  return Option.match(index, {
    onNone: () => ({
      labelFirst: [],
      revealed: new Set(Arr.filter(Rec.keys(structures), shown)),
    }),
    onSome: (found) => {
      const chapters = data.chapters.slice(0, found + 1);
      const sofar = Arr.flatMap(chapters, ({ reveals }) => reveals);

      return {
        labelFirst: data.chapters[found]?.plays ?? [],
        revealed: new Set(Arr.filter(sofar, shown)),
      };
    },
  });
};

/**
 * How many problems the drawing near the structure at `spot` has: the
 * detours, and the drawing warnings `check` gives, things drawn over each
 * other in either view and Plan labels with no spot. It draws the chapter
 * that reveals the structure (see `drawnAround`). Detours aren't problems
 * `check` reports, but placement counts them with the rest.
 */
const drawnProblems = (placing: Placing, spot: Placement) => {
  const { data, onWork, placed, structure } = placing;

  onWork("drawing");

  const structures = Rec.fromEntries([
    ...Arr.map(placed, (item) => [item.structure.id, item.placement] as const),
    [structure.id, spot] as const,
  ]);

  const layout: Layout = { format: 1, revision: 0, structures };
  const { labelFirst, revealed } = drawnAround(placing, structures);
  const routes = routeRevealed({ data, layout, revealed });

  const detours = Arr.filter(Rec.values(routes), ({ points }) =>
    isDetour(points)
  ).length;

  return Arr.reduce(views, detours, (total, view) => {
    const scene = sceneOf({ data, labelFirst, layout, revealed, routes, view });

    // `check` holds only Plan view to the label rule.
    const hidden =
      view === "plan"
        ? Arr.filter(scene.hops, ({ label }) => label === undefined).length
        : 0;

    return total + sceneClashes(scene).length + hidden;
  });
};

/**
 * The slot of `best`, in its order, whose drawing has the fewest problems
 * near the structure. It stops at the first with none.
 */
const fewestProblems = (
  placing: Placing,
  best: Arr.NonEmptyReadonlyArray<Placement>
) => {
  let [chosen] = best;
  let fewest = Number.POSITIVE_INFINITY;

  for (const spot of best) {
    const problems = drawnProblems(placing, spot);

    if (problems < fewest) {
      chosen = spot;
      fewest = problems;
    }

    if (fewest === 0) {
      break;
    }
  }

  return chosen;
};

/**
 * Picks a spot for `structure`. It takes the free slot closest to its group
 * mates and to the structures its hops connect to, on a grid through its
 * first placed mate (or else its first placed neighbour). With nothing to be
 * near, it starts a new zone to the right of everything placed.
 *
 * With `drawn` above 1, as for the structure of a one-member group, it
 * compares that many of its best slots by what they draw (see
 * `drawnProblems`) and takes the one with the fewest problems.
 */
const choose = (placing: Placing, drawn: number): Placement => {
  const { data, onWork, placed, structure } = placing;

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
    }) +
    Arr.reduce(
      neighbours,
      0,
      (sum, other) =>
        sum + distance(spot, other) + pitch * inTheWay(placed, spot, other)
    );

  const ground = groundFor(placed, structure.group);

  const candidates = Arr.filter(
    Arr.map(slotsAround(placed, anchor), (slot) => ({
      ...slot,
      ...defaultFootprint,
    })),
    (placement) => {
      onWork("slot");

      return fits(ground, { placement, structure });
    }
  );

  if (!Arr.isReadonlyArrayNonEmpty(candidates)) {
    return fallback;
  }

  const scores = new Map<Placement, number>(
    Arr.map(candidates, (spot) => [spot, score(spot)])
  );

  const ranked = Arr.sort(
    candidates,
    preference((spot) => scores.get(spot) ?? score(spot), anchor)
  );

  const best = Arr.take(ranked, drawn);

  return best.length > 1 && Arr.isReadonlyArrayNonEmpty(best)
    ? fewestProblems(placing, best)
    : ranked[0];
};

/** The same key for two ids whichever comes first. */
const pairKey = (a: string, b: string) => (a < b ? `${a}\n${b}` : `${b}\n${a}`);

/**
 * Orders a group's members so that structures joined by hops come next to
 * each other: each next member is the one with the most hops to those
 * already chosen, ties going to data.mjs order.
 */
const connectedOrder = (data: MapData, members: ReadonlyArray<Structure>) => {
  const ids = new Set(Arr.map(members, ({ id }) => id));

  const counts = new Map<string, number>();

  for (const hop of data.hops) {
    if (ids.has(hop.from) && ids.has(hop.to)) {
      const key = pairKey(hop.from, hop.to);

      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  const links = (a: string, b: string) => counts.get(pairKey(a, b)) ?? 0;

  const chosen: Array<Structure> = [];
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
  readonly members: ReadonlyArray<{
    readonly slot: Slot;
    readonly structure: Structure;
  }>;
  readonly rows: number;
  /** Distance between neighbouring slots. */
  readonly spacing: number;
}

const sizeOf = (block: Block) => ({
  d: (block.rows - 1) * block.spacing + defaultFootprint.d,
  w: (block.columns - 1) * block.spacing + defaultFootprint.w,
});

/** Where `slot` of a block with its top left corner at `offset` lies. */
const slotSpot = (block: Block, offset: Point, slot: Slot): Placement => ({
  x: offset.x + slot.column * block.spacing,
  y: offset.y + slot.row * block.spacing,
  ...defaultFootprint,
});

/** A block's members placed with the block's top left corner at `offset`. */
const layBlock = (
  block: Block,
  offset: Point
): ReadonlyArray<PlacedStructure> =>
  Arr.map(block.members, ({ slot, structure }) => ({
    placement: slotSpot(block, offset, slot),
    structure,
  }));

/** Whether no name tag in `members` is drawn over another member's box. */
const tagsClear = (members: ReadonlyArray<PlacedStructure>) =>
  Arr.every(members, (a) =>
    Arr.every(
      members,
      (b) => a.structure.id === b.structure.id || !tagCovers(a, b)
    )
  );

/**
 * `block` with the least spacing, `pitch` widened in half units, at which no
 * name tag covers a box.
 */
const spaced = (block: Omit<Block, "spacing">): Block => {
  const spacings = Arr.map(
    Arr.range(0, (widestPitch - pitch) * 2),
    (step) => pitch + step / 2
  );

  const spacing = Option.getOrElse(
    Arr.findFirst(spacings, (candidate) =>
      tagsClear(layBlock({ ...block, spacing: candidate }, origin))
    ),
    () => widestPitch
  );

  return { ...block, spacing };
};

/**
 * Lays out a new group as a block about as wide as it is deep, filled row by
 * row in a snake, so each member sits next to the one before it. Slots are
 * `pitch` apart, widened in half units until no name tag covers a box.
 */
const blockOf = (data: MapData, members: ReadonlyArray<Structure>): Block => {
  const ordered = connectedOrder(data, members);
  const columns = Math.ceil(Math.sqrt(ordered.length));
  const rows = Math.ceil(ordered.length / columns);

  const slotted = Arr.map(ordered, (structure, index) => {
    const row = Math.floor(index / columns);
    const step = index % columns;
    const column = row % 2 === 0 ? step : columns - 1 - step;

    return { slot: { column, row }, structure };
  });

  return spaced({ columns, members: slotted, rows });
};

/** Where row or column `index` starts, given the sizes of those before it. */
const startOf = (sizes: ReadonlyArray<number>, index: number) =>
  Arr.reduce(sizes.slice(0, index), 0, (sum, size) => sum + size + groupGap);

/** Marks a grid cell, or a block's slot, that nothing takes. */
const empty = -1;

/**
 * The grid of rows and columns blocks are arranged in: about as wide as it
 * is deep, with a cell for every block and the rest of the last row spare.
 */
const gridFor = (count: number) => {
  const columns = Math.ceil(Math.sqrt(count));

  return { cells: columns * Math.ceil(count / columns), columns };
};

/** Where blocks start: the origin, or right of everything already placed. */
const blocksStart = (placed: ReadonlyArray<PlacedStructure>): Point =>
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
  placed: ReadonlyArray<PlacedStructure>,
  blocks: ReadonlyArray<Block>,
  occupants: ReadonlyArray<number>
): ReadonlyArray<Point> => {
  const { cells, columns } = gridFor(blocks.length);
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
const layBlocks = (
  blocks: ReadonlyArray<Block>,
  offsets: ReadonlyArray<Point>
) =>
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

const placementsOf = (placed: ReadonlyArray<PlacedStructure>) =>
  new Map(
    Arr.map(placed, ({ placement, structure }) => [structure.id, placement])
  );

const swapped = (items: ReadonlyArray<number>, i: number, j: number) =>
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
  start: ReadonlyArray<number>,
  cost: (items: ReadonlyArray<number>) => HopCost,
  allowed: (
    items: ReadonlyArray<number>,
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
  readonly pairLeast: Float64Array;
  readonly pairLength: Float64Array;
  readonly pairOff: Float64Array;
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
  placed: ReadonlyArray<PlacedStructure>,
  blocks: ReadonlyArray<Block>
): CellWeights => {
  const { cells, columns } = gridFor(blocks.length);
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
      Arr.map(layBlock(block, origin), ({ placement, structure }) => [
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
    pairLeast: leastPairCosts(pair.length, { blocks: count, cells }),
    pairLength: pair.length,
    pairOff: pair.off,
    placedLength: toPlaced.length,
    placedOff: toPlaced.off,
  };
};

/** What `cells[block]`, the cell each block takes, costs under `weights`. */
const cellsCost = (
  weights: CellWeights,
  cells: ReadonlyArray<number>
): HopCost => {
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
): ReadonlyArray<ReadonlyArray<number>> => {
  const {
    blocks,
    cells,
    pairLeast,
    pairLength,
    pairOff,
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

  const kept: Array<{
    cells: ReadonlyArray<number>;
    length: number;
    off: number;
  }> = [];

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
const cellsOf = (occupants: ReadonlyArray<number>, count: number) =>
  Arr.map(Arr.range(0, count - 1), (block) => occupants.indexOf(block));

/** The block in each of `cellCount` cells, or `empty`, from each block's cell. */
const occupantsOf = (cells: ReadonlyArray<number>, cellCount: number) =>
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
  placed: ReadonlyArray<PlacedStructure>,
  blocks: ReadonlyArray<Block>
): ReadonlyArray<number> => {
  const weights = cellWeights(data, placed, blocks);
  const inOrder = occupantsOf(Arr.range(0, blocks.length - 1), weights.cells);

  if (blocks.length > exhaustiveGroups) {
    return improveBySwaps(inOrder, (occupants) =>
      cellsCost(weights, cellsOf(occupants, blocks.length))
    );
  }

  // The weights space cells evenly, but rows and columns really take only
  // the room their blocks need, so the shortlist is measured as laid out.
  const measured = (occupants: ReadonlyArray<number>) => {
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
    { cost: measured(inOrder), occupants: inOrder },
    (best, occupants) => {
      const cost = measured(occupants);

      return cheaper(cost, best.cost) < 0 ? { cost, occupants } : best;
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
  others: ReadonlyArray<PlacedStructure>,
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

  const blockFrom = (order: ReadonlyArray<number>): Block => ({
    ...block,
    members: Arr.flatMap(order, (member, index) => {
      const structure = block.members[member]?.structure;
      const slot = slots[index];

      return structure === undefined || slot === undefined
        ? []
        : [{ slot, structure }];
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

  const ends = Arr.map(block.members, (): Array<Placement> => []);
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

  const cost = (order: ReadonlyArray<number>): HopCost => {
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
  placed: ReadonlyArray<PlacedStructure>,
  blocks: ReadonlyArray<Block>
): ReadonlyArray<PlacedStructure> => {
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

/**
 * The Euclidean distance between two footprints on the ground, 0 where they
 * touch or overlap.
 */
const groundGap = (a: Placement, b: Placement) =>
  Math.hypot(
    Math.max(0, b.x - (a.x + a.w), a.x - (b.x + b.w)),
    Math.max(0, b.y - (a.y + a.d), a.y - (b.y + b.d))
  );

/**
 * The ways to stand two members: side by side in a row or stacked in a
 * column, each in both orders, in that order. Each is spaced as a block is.
 */
const arrangementsOf = ([first, second]: readonly [
  Structure,
  Structure,
]): ReadonlyArray<Block> =>
  Arr.flatMap(
    [
      { columns: 2, rows: 1 },
      { columns: 1, rows: 2 },
    ],
    ({ columns, rows }) =>
      Arr.map(
        [
          [first, second],
          [second, first],
        ],
        (ordered) =>
          spaced({
            columns,
            members: Arr.map(ordered, (structure, index) => ({
              slot: {
                column: columns === 2 ? index : 0,
                row: rows === 2 ? index : 0,
              },
              structure,
            })),
            rows,
          })
      )
  );

/**
 * How far along a side of the target zone, either way from the pair's hop
 * ends, a pair is tried. A saved zone's side can be any length, and this
 * keeps the spots tried, each scored by its hops, to a fixed number. Along a
 * side up to twice this long, every spot is tried.
 */
const sideReach = 2 * searchMargin;

/**
 * Values in half-unit steps from `from` to `to`: all of them when they span
 * no more than `2 * sideReach` units, else the `2 * sideReach` units of them
 * centred as close to `near` as they can be.
 */
const halfSteps = (from: number, to: number, near: number) => {
  const steps = Math.round((to - from) * 2) + 1;
  const reach = sideReach * 2;
  const middle = Math.round((near - from) * 2);
  const first = Math.max(0, Math.min(middle - reach, steps - 1 - 2 * reach));
  const last = Math.min(steps - 1, first + 2 * reach);

  return Arr.makeBy(last - first + 1, (step) => from + (first + step) / 2);
};

/**
 * Where the top left corner of a box of `size` goes to stand `away` from
 * `target` on each of its four sides, overlapping it along that side by at
 * least half a unit, and no more than `sideReach` along it from `near`.
 */
const besideOffsets = (
  target: Placement,
  size: Pick<Placement, "d" | "w">,
  { away, near }: { readonly away: number; readonly near: Point }
): ReadonlyArray<Point> => {
  const ys = halfSteps(
    target.y - size.d + 0.5,
    target.y + target.d - 0.5,
    near.y - size.d / 2
  );

  const xs = halfSteps(
    target.x - size.w + 0.5,
    target.x + target.w - 0.5,
    near.x - size.w / 2
  );

  return [
    ...Arr.map(ys, (y) => ({ x: target.x + target.w + away, y })),
    ...Arr.map(ys, (y) => ({ x: target.x - away - size.w, y })),
    ...Arr.map(xs, (x) => ({ x, y: target.y + target.d + away })),
    ...Arr.map(xs, (x) => ({ x, y: target.y - away - size.d })),
  ];
};

/** A way to stand a two-member group beside its target zone. */
interface Siting {
  readonly arrangement: number;
  /**
   * How many structures of the ground stand between the members and the
   * structures their hops connect to (see `inTheWay`).
   */
  readonly blocked: number;
  readonly cost: HopCost;
  readonly laid: ReadonlyArray<PlacedStructure>;
  readonly offset: Point;
}

const bySiting = (key: (siting: Siting) => number) =>
  Order.mapInput(Order.Number, key);

/**
 * Fewest structures in the way of the members' hops first, then cheapest
 * hops, then the topmost and leftmost, then arrangement order. Each route
 * bends round a structure in its way, and the bends crowd out Plan labels, so
 * they count before length. In flake-pipeline, ranking by length alone left
 * a Plan label with no spot.
 */
const betterSiting = Order.combineAll([
  bySiting((siting) => siting.blocked),
  Order.mapInput(cheaper, (siting: Siting) => siting.cost),
  bySiting((siting) => siting.offset.y),
  bySiting((siting) => siting.offset.x),
  bySiting((siting) => siting.arrangement),
]);

/**
 * The group the two members share the most hops with, counting hops to
 * every structure, placed yet or not, and ties going to the group
 * `data.groups` lists first. Only groups in `zoned`, those with something
 * placed or laid out, can be the target. The rest are new one-member groups,
 * whose structure is placed after the pairs beside the structures its hops
 * connect to, so it comes to the pair. There is none when the members have
 * no hop to such a group.
 */
const targetOf = (
  data: MapData,
  members: readonly [Structure, Structure],
  zoned: ReadonlySet<string>
): Option.Option<string> => {
  const [{ group }] = members;
  const groupOf = new Map(Arr.map(data.structures, (s) => [s.id, s.group]));

  const ends = Arr.flatMap(members, ({ id }) =>
    Arr.flatMap(neighboursOf(data, id), (end) =>
      Option.toArray(Option.fromNullishOr(groupOf.get(end)))
    )
  );

  const busiest = Arr.reduce(
    data.groups,
    { hops: 0, id: "" },
    (best, other) => {
      const hops = Arr.filter(ends, (end) => end === other.id).length;

      return other.id !== group && zoned.has(other.id) && hops > best.hops
        ? { hops, id: other.id }
        : best;
    }
  );

  return busiest.hops > 0 ? Option.some(busiest.id) : Option.none();
};

/**
 * Finds the two members of a new group a spot beside `target`'s zone as it
 * stands in `ground`. It tries the four sides of that zone at `groupGap`,
 * then farther out up to `searchMargin`. Of the arrangements and offsets
 * whose zone is no farther from the target's than from any other zone, it
 * takes the first in `betterSiting` order where both members fit. There is
 * no result when `target` has nothing in `ground`, or none of the spots
 * fits.
 */
const sitePair = (
  { data, onWork }: Pick<Placing, "data" | "onWork">,
  ground: ReadonlyArray<PlacedStructure>,
  { members, target: targetGroup }: PairTarget
): Option.Option<ReadonlyArray<PlacedStructure>> => {
  const [{ group }] = members;
  const ids = new Set(Arr.map(members, ({ id }) => id));
  const groundById = new Map(
    Arr.map(ground, (item) => [item.structure.id, item])
  );

  const ends = Arr.flatMap(members, ({ id }) =>
    Arr.flatMap(neighboursOf(data, id), (end) =>
      Option.toArray(Option.fromNullishOr(groundById.get(end)))
    )
  );

  return Option.flatMap(targetGroup, (targetId) =>
    Option.flatMap(zoneOf(ground, targetId), (target) => {
      const targetOutline = grow(target, zonePadding);

      const others = Arr.map(otherZones(ground, targetId), (zone) =>
        grow(zone, zonePadding)
      );

      const arrangements = arrangementsOf(members);

      const hops = Arr.filter(
        data.hops,
        ({ from, to }) => ids.has(from) || ids.has(to)
      );

      const fixed = Arr.map(
        ends,
        ({ placement, structure }) => [structure.id, placement] as const
      );

      // Where the pair's hops go, or the target's middle when none of them
      // is placed yet.
      const endsBounds = boundsOf(footprints(ends));

      const near = Option.getOrElse(Option.map(endsBounds, centreOf), () =>
        centreOf(target)
      );

      const sitingsAway = (away: number) =>
        Arr.flatMap(arrangements, (block, arrangement) => {
          const size = sizeOf(block);

          return Arr.flatMap(
            besideOffsets(target, size, { away, near }),
            (offset) => {
              onWork("slot");

              const outline = grow({ ...offset, ...size }, zonePadding);
              const toTarget = groundGap(outline, targetOutline);

              if (
                !Arr.every(
                  others,
                  (zone) => toTarget <= groundGap(outline, zone)
                )
              ) {
                return [];
              }

              const laid = layBlock(block, offset);

              const cost = hopCost(
                hops,
                new Map([
                  ...fixed,
                  ...Arr.map(
                    laid,
                    ({ placement, structure }) =>
                      [structure.id, placement] as const
                  ),
                ])
              );

              const blocked = Arr.reduce(laid, 0, (sum, member) =>
                Arr.reduce(
                  neighboursOf(data, member.structure.id),
                  sum,
                  (count, id) =>
                    Option.match(Option.fromNullishOr(groundById.get(id)), {
                      onNone: () => count,
                      onSome: (end) =>
                        count +
                        inTheWay(ground, member.placement, end.placement),
                    })
                )
              );

              return [{ arrangement, blocked, cost, laid, offset }];
            }
          );
        });

      const around = groundFor(ground, group);

      const accepted = (siting: Siting) => {
        const [first, second] = siting.laid;

        if (first === undefined || second === undefined) {
          return Option.none();
        }

        onWork("slot");

        if (!fits(around, first)) {
          return Option.none();
        }

        onWork("slot");

        const withFirst: Ground = {
          drawn: [...around.drawn, drawnOf(first)],
          placed: [...around.placed, first],
          zones: around.zones,
        };

        return fits(withFirst, second)
          ? Option.some(siting.laid)
          : Option.none();
      };

      const distances = Arr.makeBy(
        Math.floor((searchMargin - groupGap) / pitch) + 1,
        (step) => groupGap + step * pitch
      );

      return Arr.findFirst(distances, (away) =>
        Arr.findFirst(Arr.sort(sitingsAway(away), betterSiting), accepted)
      );
    })
  );
};

/** A new two-member group, and the group it goes beside (see `targetOf`). */
interface PairTarget {
  readonly members: readonly [Structure, Structure];
  readonly target: Option.Option<string>;
}

/**
 * `pairs` in the order they're sited: each after the pair it targets, so it
 * goes beside where that pair ends up, not where the grid first put it.
 * Pairs are taken in `groups` order, each after its chain of targets. A
 * chain that loops back, such as two pairs that target each other, is broken
 * where it was entered: that pair goes first, beside its target's grid spot,
 * and the rest of the loop then follows it back.
 */
const settlingOrder = (
  pairs: ReadonlyArray<PairTarget>
): ReadonlyArray<PairTarget> => {
  const byGroup = new Map(
    Arr.map(pairs, (pair) => [pair.members[0].group, pair])
  );

  const targetPair = (pair: PairTarget) =>
    Option.getOrUndefined(
      Option.flatMap(pair.target, (id) => Option.fromNullishOr(byGroup.get(id)))
    );

  const settled = new Set<PairTarget>();
  const order: Array<PairTarget> = [];

  for (const start of pairs) {
    const chain: Array<PairTarget> = [];
    let next: PairTarget | undefined = start;

    while (next !== undefined && !settled.has(next) && !chain.includes(next)) {
      chain.push(next);
      next = targetPair(next);
    }

    const loop =
      next !== undefined && chain.includes(next)
        ? chain.indexOf(next)
        : chain.length;

    for (const pair of [
      ...chain.slice(loop, loop + 1),
      ...Arr.reverse(chain.slice(loop + 1)),
      ...Arr.reverse(chain.slice(0, loop)),
    ]) {
      settled.add(pair);
      order.push(pair);
    }
  }

  return order;
};

/**
 * Moves each two-member group's members from their grid spots to beside the
 * zone they share the most hops with (see `targetOf` and `sitePair`), in
 * `settlingOrder`, so a pair sees where the pairs before it went. A group
 * that has nowhere to go keeps its grid spots.
 */
const sitePairs = (
  context: Pick<Placing, "data" | "onWork">,
  layouts: {
    readonly arranged: ReadonlyArray<PlacedStructure>;
    readonly initial: ReadonlyArray<PlacedStructure>;
  },
  pairs: ReadonlyArray<readonly [Structure, Structure]>
) => {
  const zoned = new Set(
    Arr.map(
      [...layouts.initial, ...layouts.arranged],
      ({ structure }) => structure.group
    )
  );

  const targeted = Arr.map(pairs, (members) => ({
    members,
    target: targetOf(context.data, members, zoned),
  }));

  return Arr.reduce(
    settlingOrder(targeted),
    layouts.arranged,
    (sofar, pair) => {
      const ids = new Set(Arr.map(pair.members, ({ id }) => id));

      const ground = [
        ...layouts.initial,
        ...Arr.filter(sofar, ({ structure }) => !ids.has(structure.id)),
      ];

      return Option.match(sitePair(context, ground, pair), {
        onNone: () => sofar,
        onSome: (sited) =>
          Arr.map(sofar, (item) =>
            Option.getOrElse(
              Arr.findFirst(
                sited,
                ({ structure }) => structure.id === item.structure.id
              ),
              () => item
            )
          ),
      });
    }
  );
};

/** What placement did to a layout. */
export interface PlacedLayout {
  /** Every structure's placement, in data.mjs order. */
  readonly layout: Layout;
  /** The ids of the structures that were given a placement, in order. */
  readonly placed: ReadonlyArray<string>;
  /** The ids of layout entries removed because no structure has them. */
  readonly pruned: ReadonlyArray<string>;
  /** The ids of route overrides removed because no hop has them. */
  readonly prunedRoutes: ReadonlyArray<string>;
}

const place = (
  data: MapData,
  layout: Layout,
  onWork: (work: PlacementWork) => void
): PlacedLayout => {
  const ids = new Set(Arr.map(data.structures, ({ id }) => id));
  const pruned = Arr.filter(Rec.keys(layout.structures), (id) => !ids.has(id));

  const groupIndex = new Map(
    Arr.map(data.groups, ({ id }, index) => [id, index])
  );

  const initial = Arr.flatMap(data.structures, (structure) =>
    Option.toArray(
      Option.map(Rec.get(layout.structures, structure.id), (placement) => ({
        placement,
        structure,
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

  // Groups with nothing placed yet are laid out as blocks, and those of two
  // members then move beside the zone they share the most hops with. The rest
  // of the new structures join their group one at a time.
  const placedGroups = new Set(
    Arr.map(initial, ({ structure }) => structure.group)
  );

  const membersOfGroup = (group: string) =>
    Arr.filter(unplaced, (structure) => structure.group === group);

  const newGroups = Arr.filter(
    Arr.dedupe(Arr.map(unplaced, ({ group }) => group)),
    (group) => !placedGroups.has(group)
  );

  // A one-member group has no block to arrange. Its structure is placed
  // after the blocks, beside the structures its hops connect to.
  const [oneMember, fresh] = Arr.partition(newGroups, (group) =>
    membersOfGroup(group).length === 1
      ? Result.succeed(group)
      : Result.fail(group)
  );

  const oneMemberGroups = new Set(oneMember);

  const drawnEach = Math.min(
    drawnCandidates,
    Math.floor(drawingBudget / Math.max(oneMemberGroups.size, 1))
  );

  const arranged = arrangeBlocks(
    data,
    initial,
    Arr.map(fresh, (group) => blockOf(data, membersOfGroup(group)))
  );

  const pairs = Arr.flatMap(fresh, (group) => {
    const members = membersOfGroup(group);
    const [first, second] = members;

    return members.length === 2 && first !== undefined && second !== undefined
      ? [[first, second] as const]
      : [];
  });

  const blocks = sitePairs({ data, onWork }, { arranged, initial }, pairs);

  const blockSpot = new Map(
    Arr.map(blocks, ({ placement, structure }) => [structure.id, placement])
  );

  const blocked = new Set(Arr.map(blocks, ({ structure }) => structure.id));

  // Block members go first, so a structure placed on its own never takes a
  // block's ground.
  const inOrder = [
    ...Arr.filter(unplaced, ({ id }) => blocked.has(id)),
    ...Arr.filter(unplaced, ({ id }) => !blocked.has(id)),
  ];

  const placed = Arr.reduce(inOrder, initial, (sofar, structure) => {
    // A block spot is kept unless something placed by hand is in its way.
    const planned = Option.filter(
      Option.fromNullishOr(blockSpot.get(structure.id)),
      (placement) => {
        onWork("slot");

        return fits(groundFor(sofar, structure.group), {
          placement,
          structure,
        });
      }
    );

    const spot = Option.getOrElse(planned, () =>
      choose(
        { data, onWork, placed: sofar, structure },
        oneMemberGroups.has(structure.group) ? drawnEach : 1
      )
    );

    return [
      ...sofar,
      {
        placement: { ...spot, x: toHalfUnit(spot.x), y: toHalfUnit(spot.y) },
        structure,
      },
    ];
  });

  const byId = new Map(
    Arr.map(placed, ({ placement, structure }) => [structure.id, placement])
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
};

/**
 * Gives every structure without a placement one, and drops entries for
 * structures that no longer exist and route overrides for hops that no
 * longer exist. Structures that already have a placement
 * keep it exactly.
 *
 * A group with nothing placed yet is laid out as a block about as wide as it
 * is deep, with structures joined by hops next to each other. The blocks
 * sit in rows and columns arranged to shorten the hops between groups, and
 * members move to the side of their block facing where their hops go. A new
 * group of two members then moves to stand beside the zone it shares the most
 * hops with, each member on the side facing its own hops. A new structure in a
 * group that already has placed members takes the free slot nearest its group
 * and the structures its hops connect to. Every new placement lands on a half unit
 * with a 2×2 footprint, clear of every other footprint and name tag, and
 * keeps its zone `groupGap` away from other groups' structures. The same
 * input always gives the same result. The revision is left as it is.
 */
export const placeStructures: {
  (layout: Layout): (data: MapData) => PlacedLayout;
  (data: MapData, layout: Layout): PlacedLayout;
} = dual(2, (data: MapData, layout: Layout) => place(data, layout, () => {}));

/** `placeStructures`, calling `onWork` for each slot it tests or draws. */
export const placeStructuresWith: {
  (
    layout: Layout,
    onWork: (work: PlacementWork) => void
  ): (data: MapData) => PlacedLayout;
  (
    data: MapData,
    layout: Layout,
    onWork: (work: PlacementWork) => void
  ): PlacedLayout;
} = dual(3, place);
