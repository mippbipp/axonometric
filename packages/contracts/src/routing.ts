import { Array as Arr, Record as Rec } from "effect";
import { dual } from "effect/Function";

import type { GridPoint, Layout, Placement } from "./layout.ts";
import type { Hop, MapData } from "./map-data.ts";
import { zonesOf } from "./zones.ts";

/** Where a hop runs on the ground, from one footprint's edge to the other's. */
export interface HopRoute {
  /**
   * The route's ends and bends, in grid units on half units. Every leg runs
   * along x or y.
   */
  readonly points: readonly GridPoint[];
  /**
   * The ids of the structures, other than the hop's ends, whose footprints
   * the route runs under or along, in data.mjs order. Empty when the route
   * is clear.
   */
  readonly crosses: readonly string[];
  /** Whether the points come from a route override in `layout.json`. */
  readonly overridden: boolean;
}

/** The router works in half units, so every grid value is a whole number. */
const scale = 2;

/** How far past every footprint the router may go, in half units. */
const margin = 8;

const stepCost = 1;

/** Each bend costs as much as this many half-unit steps. */
const bendCost = 3;

/** Running alongside another hop's route costs this much more per step. */
const sharedStepCost = 2;

/**
 * Passing through a point a hop between the same two structures already
 * uses. Steps they use can't be shared at all.
 */
const pairPointCost = 8;

/**
 * Starting or ending on a back edge (-x or -y), where the box hides the
 * route's end, costs as much as this many half-unit steps. It's more than a
 * detour round to a front edge costs, so a route takes a back edge only
 * when no front edge is free.
 */
const backEdgeCost = 24;

/**
 * Each half-unit step inside the zone of a group neither end belongs to.
 * Far less than running under a box, so a route crosses a zone rather than
 * a box.
 */
const zoneStepCost = 2;

/** Each half unit a route's end sits from the middle of its edge. */
const offCentreCost = 0.25;

/** Running under a box costs more than any clear route could. */
const crossCost = 1e6;

interface Box {
  readonly id: string;
  readonly group: string;
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

const toBox = (
  { id, group }: { readonly id: string; readonly group: string },
  placement: Placement
): Box => ({
  id,
  group,
  x0: placement.x * scale,
  y0: placement.y * scale,
  x1: (placement.x + placement.w) * scale,
  y1: (placement.y + placement.d) * scale,
});

/**
 * Whether the step between two neighbouring half-unit points runs under or
 * along `box`: its midpoint is inside the footprint or on its edge.
 */
const stepTouches = (
  box: Box,
  a: { readonly x: number; readonly y: number },
  b: { readonly x: number; readonly y: number }
) => {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;

  return mx >= box.x0 && mx <= box.x1 && my >= box.y0 && my <= box.y1;
};

/** Every half-unit step along a polyline in half units. */
const stepsAlong = (points: readonly { x: number; y: number }[]) =>
  Arr.flatMap(points, (start, index) => {
    const end = points[index + 1];

    if (end === undefined) {
      return [];
    }

    const stepX = Math.sign(end.x - start.x);
    const stepY = Math.sign(end.y - start.y);

    const count = Math.max(
      Math.abs(end.x - start.x),
      Math.abs(end.y - start.y)
    );

    return Arr.map(Arr.range(1, count), (step) => ({
      a: { x: start.x + stepX * (step - 1), y: start.y + stepY * (step - 1) },
      b: { x: start.x + stepX * step, y: start.y + stepY * step },
    }));
  });

const toHalfUnits = (point: GridPoint) => ({
  x: point.x * scale,
  y: point.y * scale,
});

/** The structures other than `ends` that a route in half units touches. */
const crossesOf = (
  boxes: readonly Box[],
  ends: ReadonlySet<string>,
  points: readonly { x: number; y: number }[]
) => {
  const steps = stepsAlong(points);

  return Arr.flatMap(boxes, (box) =>
    !ends.has(box.id) && Arr.some(steps, ({ a, b }) => stepTouches(box, a, b))
      ? [box.id]
      : []
  );
};

interface Queued {
  readonly f: number;
  readonly seq: number;
  readonly state: number;
}

const queuedFirst = (a: Queued, b: Queued) =>
  a.f < b.f || (a.f === b.f && a.seq < b.seq);

/**
 * A binary min-heap of search states, cheapest first. Ties go to the state
 * pushed first, so the search is deterministic.
 */
const makeQueue = () => {
  const items: Queued[] = [];
  let seq = 0;

  const swap = (i: number, j: number) => {
    const a = items[i];
    const b = items[j];

    if (a !== undefined && b !== undefined) {
      items[i] = b;
      items[j] = a;
    }
  };

  const less = (i: number, j: number) => {
    const a = items[i];
    const b = items[j];

    return a !== undefined && b !== undefined && queuedFirst(a, b);
  };

  const push = (state: number, f: number) => {
    items.push({ f, seq, state });
    seq += 1;

    let index = items.length - 1;

    while (index > 0 && less(index, Math.floor((index - 1) / 2))) {
      const parent = Math.floor((index - 1) / 2);

      swap(index, parent);
      index = parent;
    }
  };

  const pop = (): number | undefined => {
    const [top] = items;

    swap(0, items.length - 1);
    items.pop();

    let index = 0;
    let settled = false;

    while (!settled) {
      const left = 2 * index + 1;
      const right = left + 1;
      let smallest = index;

      if (less(left, smallest)) {
        smallest = left;
      }

      if (less(right, smallest)) {
        smallest = right;
      }

      settled = smallest === index;
      swap(index, smallest);
      index = smallest;
    }

    return top?.state;
  };

  return { push, pop, size: () => items.length };
};

/** +x, +y, -x, -y, and "no direction yet" for a route's first point. */
const dx = [1, 0, -1, 0] as const;

const dy = [0, 1, 0, -1] as const;

const noDirection = 4;

const directions = 5;

/** The router's grid: every half-unit point in the routed area. */
interface Grid {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly boxes: readonly Box[];
  /**
   * For each point and each of +x and +y, the indexes of the boxes the step
   * from that point touches, or `undefined` for none.
   */
  readonly touches: readonly (readonly number[] | undefined)[];
  readonly zones: readonly Box[];
  /** Like `touches`, for steps inside a zone, keyed the same way. */
  readonly inZones: readonly (readonly number[] | undefined)[];
}

/** Adds `value` to the list at `index`. */
const push = (
  lists: (number[] | undefined)[],
  index: number,
  value: number
) => {
  const list = lists[index] ?? [];

  list.push(value);
  lists[index] = list;
};

const gridOf = (
  boxes: readonly Box[],
  zones: readonly Box[],
  extra: readonly { x: number; y: number }[]
): Grid => {
  const xs = [
    ...Arr.flatMap([...boxes, ...zones], (box) => [box.x0, box.x1]),
    ...Arr.map(extra, (point) => point.x),
  ];

  const ys = [
    ...Arr.flatMap([...boxes, ...zones], (box) => [box.y0, box.y1]),
    ...Arr.map(extra, (point) => point.y),
  ];

  const left = Math.min(0, ...xs) - margin;
  const top = Math.min(0, ...ys) - margin;
  const width = Math.max(0, ...xs) + margin - left + 1;
  const height = Math.max(0, ...ys) + margin - top + 1;
  const touches: (number[] | undefined)[] = [];
  const inZones: (number[] | undefined)[] = [];

  const keyOf = (x: number, y: number, direction: 0 | 1) =>
    ((y - top) * width + (x - left)) * 2 + direction;

  // A step is inside a zone when its midpoint is strictly inside.
  Arr.forEach(zones, (zone, zoneIndex) => {
    for (let y = zone.y0 + 1; y < zone.y1; y++) {
      for (let x = zone.x0; x < zone.x1; x++) {
        push(inZones, keyOf(x, y, 0), zoneIndex);
      }
    }

    for (let y = zone.y0; y < zone.y1; y++) {
      for (let x = zone.x0 + 1; x < zone.x1; x++) {
        push(inZones, keyOf(x, y, 1), zoneIndex);
      }
    }
  });

  Arr.forEach(boxes, (box, boxIndex) => {
    const mark = (x: number, y: number, direction: 0 | 1) => {
      push(touches, keyOf(x, y, direction), boxIndex);
    };

    for (let y = box.y0; y <= box.y1; y++) {
      for (let x = box.x0; x < box.x1; x++) {
        mark(x, y, 0);
      }
    }

    for (let y = box.y0; y < box.y1; y++) {
      for (let x = box.x0; x <= box.x1; x++) {
        mark(x, y, 1);
      }
    }
  });

  return { left, top, width, height, boxes, touches, zones, inZones };
};

/** The points along an edge from `from` to `to`, corners left out if it can. */
const along = (from: number, to: number) =>
  to - from >= 2 ? Arr.range(from + 1, to - 1) : [from, to];

/**
 * The points on a footprint's edge a route may start or end at, each with
 * what it costs to use it. Corners are left out unless an edge has no other
 * points. Points away from the middle of their edge cost a little more, so
 * a lone route leaves from the middle. Points on the back edges (-x and -y)
 * cost `backEdgeCost` more, because the box hides a route that ends there.
 */
const edgePoints = (box: Box) => {
  const backCost = backEdgeCost;
  const midX = (box.x0 + box.x1) / 2;
  const midY = (box.y0 + box.y1) / 2;

  return [
    ...Arr.map(along(box.x0, box.x1), (x) => ({
      x,
      y: box.y1,
      cost: offCentreCost * Math.abs(x - midX),
    })),
    ...Arr.map(along(box.y0, box.y1), (y) => ({
      x: box.x1,
      y,
      cost: offCentreCost * Math.abs(y - midY),
    })),
    ...Arr.map(along(box.x0, box.x1), (x) => ({
      x,
      y: box.y0,
      cost: backCost + offCentreCost * Math.abs(x - midX),
    })),
    ...Arr.map(along(box.y0, box.y1), (y) => ({
      x: box.x0,
      y,
      cost: backCost + offCentreCost * Math.abs(y - midY),
    })),
  ];
};

/** Distance in half units from a point to a box, along the axes. */
const distanceTo = (
  box: Box,
  { x, y }: { readonly x: number; readonly y: number }
) => Math.max(box.x0 - x, 0, x - box.x1) + Math.max(box.y0 - y, 0, y - box.y1);

interface Usage {
  /** Steps any route uses, keyed by step. */
  readonly steps: Set<number>;
  /** Steps and points routes between each pair of structures use. */
  readonly pairs: Map<
    string,
    { readonly steps: Set<number>; readonly points: Set<number> }
  >;
}

const pairKey = (a: string, b: string) =>
  a < b ? JSON.stringify([a, b]) : JSON.stringify([b, a]);

const pairUsage = (usage: Usage, key: string) => {
  const existing = usage.pairs.get(key);

  if (existing !== undefined) {
    return existing;
  }

  const created = { steps: new Set<number>(), points: new Set<number>() };

  usage.pairs.set(key, created);

  return created;
};

interface Cell {
  readonly x: number;
  readonly y: number;
}

const pointIndex = (grid: Grid, { x, y }: Cell) =>
  (y - grid.top) * grid.width + (x - grid.left);

/**
 * A step's key: the point it starts from and its axis, whichever way it
 * runs.
 */
const stepKey = (grid: Grid, from: Cell, direction: number) =>
  pointIndex(grid, {
    x: direction === 2 ? from.x - 1 : from.x,
    y: direction === 3 ? from.y - 1 : from.y,
  }) *
    2 +
  (direction % 2);

const directionOf = (a: Cell, b: Cell) => {
  if (b.x !== a.x) {
    return b.x > a.x ? 0 : 2;
  }

  return b.y > a.y ? 1 : 3;
};

const record = (
  grid: Grid,
  { usage, key }: { readonly usage: Usage; readonly key: string },
  points: readonly Cell[]
) => {
  const pair = pairUsage(usage, key);

  for (const { a, b } of stepsAlong(points)) {
    const step = stepKey(grid, a, directionOf(a, b));

    usage.steps.add(step);
    pair.steps.add(step);
    pair.points.add(pointIndex(grid, a));
    pair.points.add(pointIndex(grid, b));
  }
};

/** Keeps a polyline's first and last points and the points where it turns. */
const cornersOf = (points: readonly Cell[]) =>
  Arr.filter(points, (point, index) => {
    const previous = points[index - 1];
    const next = points[index + 1];

    return (
      previous === undefined ||
      next === undefined ||
      (previous.x === point.x) !== (point.x === next.x)
    );
  });

/** What one search needs to know besides the grid. */
interface Search {
  readonly grid: Grid;
  readonly usage: Usage;
  readonly pair: ReturnType<typeof pairUsage>;
  readonly ends: ReadonlySet<string>;
  /** The groups of the hop's ends, whose zones cost nothing to cross. */
  readonly groups: ReadonlySet<string>;
  readonly to: Box;
  /** Extra cost of ending at each of the target's edge points. */
  readonly goals: ReadonlyMap<number, number>;
}

const inside = (grid: Grid, { x, y }: Cell) =>
  x >= grid.left &&
  y >= grid.top &&
  x < grid.left + grid.width &&
  y < grid.top + grid.height;

/**
 * What a step from `from` in `direction` costs on top of the route so far,
 * or `undefined` when the route may not take it: off the grid, along a step
 * a hop between the same two structures uses, or under one of the hop's own
 * ends.
 */
const stepPrice = (
  search: Search,
  { from, heading }: { readonly from: Cell; readonly heading: number },
  direction: number
): number | undefined => {
  const { grid } = search;

  const next = {
    x: from.x + (dx[direction] ?? 0),
    y: from.y + (dy[direction] ?? 0),
  };

  const step = stepKey(grid, from, direction);
  const touched = grid.touches[step] ?? [];

  const ownEnd = Arr.some(touched, (boxIndex) =>
    search.ends.has(grid.boxes[boxIndex]?.id ?? "")
  );

  if (!inside(grid, next) || search.pair.steps.has(step) || ownEnd) {
    return undefined;
  }

  const bend = heading === noDirection || heading === direction ? 0 : 1;
  const nextIndex = pointIndex(grid, next);

  const zones = Arr.filter(
    grid.inZones[step] ?? [],
    (zoneIndex) => !search.groups.has(grid.zones[zoneIndex]?.group ?? "")
  ).length;

  return (
    stepCost +
    bend * bendCost +
    touched.length * crossCost +
    zones * zoneStepCost +
    (search.usage.steps.has(step) ? sharedStepCost : 0) +
    (search.pair.points.has(nextIndex) ? pairPointCost : 0) +
    (search.goals.get(nextIndex) ?? 0)
  );
};

const cellOf = (grid: Grid, state: number): Cell => {
  const point = Math.floor(state / directions);

  return {
    x: (point % grid.width) + grid.left,
    y: Math.floor(point / grid.width) + grid.top,
  };
};

const pathTo = (grid: Grid, parent: Int32Array, state: number) => {
  const path: Cell[] = [];

  for (let at = state; at !== -1; at = parent[at] ?? -1) {
    path.push(cellOf(grid, at));
  }

  return cornersOf(Arr.reverse(path));
};

/**
 * The cheapest route from `from`'s edge to `to`'s edge, by A* over the
 * half-unit grid with a cost for each bend. Running under a box costs more
 * than any clear route, so the route runs under the fewest boxes it can.
 */
const searchRoute = (
  grid: Grid,
  { usage, key }: { readonly usage: Usage; readonly key: string },
  { from, to }: { readonly from: Box; readonly to: Box }
): readonly Cell[] => {
  const search: Search = {
    grid,
    usage,
    pair: pairUsage(usage, key),
    ends: new Set([from.id, to.id]),
    groups: new Set([from.group, to.group]),
    to,
    goals: new Map(
      Arr.map(edgePoints(to), (point) => [pointIndex(grid, point), point.cost])
    ),
  };

  const size = grid.width * grid.height * directions;
  const cost = new Float64Array(size).fill(Number.POSITIVE_INFINITY);
  const parent = new Int32Array(size).fill(-1);
  const done = new Uint8Array(size);
  const queue = makeQueue();

  for (const start of edgePoints(from)) {
    const state = pointIndex(grid, start) * directions + noDirection;

    cost[state] = start.cost;
    queue.push(state, start.cost + distanceTo(to, start));
  }

  for (let state = queue.pop(); state !== undefined; state = queue.pop()) {
    const heading = state % directions;
    const here = cellOf(grid, state);
    const fresh = done[state] !== 1;

    if (
      fresh &&
      heading !== noDirection &&
      search.goals.has(Math.floor(state / directions))
    ) {
      return pathTo(grid, parent, state);
    }

    done[state] = 1;

    const moves = fresh ? [0, 1, 2, 3] : [];

    for (const direction of moves) {
      const price = stepPrice(search, { from: here, heading }, direction);

      const next = {
        x: here.x + (dx[direction] ?? 0),
        y: here.y + (dy[direction] ?? 0),
      };

      const total = (cost[state] ?? 0) + (price ?? Number.POSITIVE_INFINITY);
      const nextState = pointIndex(grid, next) * directions + direction;

      if (total < (cost[nextState] ?? Number.POSITIVE_INFINITY)) {
        cost[nextState] = total;
        parent[nextState] = state;
        queue.push(nextState, total + distanceTo(to, next));
      }
    }
  }

  return [];
};

/**
 * Routes every hop whose ends both have a placement. A hop with a route
 * override in `layout.routes` follows it. Every other hop gets a route at
 * right angles on the half-unit grid, from the edge of one footprint to the
 * edge of the other, with as few bends as it can manage, going around every
 * footprint whenever a clear route exists. Its ends sit on front edges (+x
 * and +y), where the boxes don't hide them, unless none is free, and it
 * keeps out of the zones of groups neither end belongs to when it can. Hops between the same two
 * structures, in either direction, never share a step, so they run side by
 * side. Hops are routed in data.mjs order, and the same map always gives
 * the same routes. A hop from a structure to itself gets no route.
 */
export const routeHops: {
  (layout: Layout): (data: MapData) => Readonly<Record<string, HopRoute>>;
  (data: MapData, layout: Layout): Readonly<Record<string, HopRoute>>;
} = dual(
  2,
  (data: MapData, layout: Layout): Readonly<Record<string, HopRoute>> => {
    const boxes = Arr.flatMap(data.structures, (structure) => {
      const placement = layout.structures[structure.id];

      return placement === undefined ? [] : [toBox(structure, placement)];
    });

    const zones = Arr.map(zonesOf({ data, layout }), (zone) =>
      toBox({ id: zone.group.id, group: zone.group.id }, zone.box)
    );

    const byId = new Map(Arr.map(boxes, (box) => [box.id, box]));
    const overrides = layout.routes ?? {};

    const overridePoints = Arr.flatMap(Rec.values(overrides), (points) =>
      Arr.map(points, toHalfUnits)
    );

    const grid = gridOf(boxes, zones, overridePoints);
    const usage: Usage = { steps: new Set(), pairs: new Map() };
    const routes: Record<string, HopRoute> = {};

    const routeOne = (hop: Hop) => {
      const from = byId.get(hop.from);
      const to = byId.get(hop.to);

      if (from === undefined || to === undefined || hop.from === hop.to) {
        return;
      }

      const key = pairKey(hop.from, hop.to);
      const ends = new Set([hop.from, hop.to]);
      const override = overrides[hop.id];

      const halfUnits =
        override === undefined
          ? searchRoute(grid, { usage, key }, { from, to })
          : Arr.map(override, toHalfUnits);

      if (halfUnits.length === 0) {
        return;
      }

      record(grid, { usage, key }, halfUnits);

      routes[hop.id] = {
        points:
          override ??
          Arr.map(halfUnits, (point) => ({
            x: point.x / scale,
            y: point.y / scale,
          })),
        crosses: crossesOf(boxes, ends, halfUnits),
        overridden: override !== undefined,
      };
    };

    // Overrides go first, so automatic routes keep clear of them.
    for (const hop of data.hops) {
      if (Rec.has(overrides, hop.id)) {
        routeOne(hop);
      }
    }

    for (const hop of data.hops) {
      if (!Rec.has(overrides, hop.id)) {
        routeOne(hop);
      }
    }

    return Rec.fromEntries(
      Arr.flatMap(data.hops, ({ id }) => {
        const route = routes[id];

        return route === undefined ? [] : [[id, route] as const];
      })
    );
  }
);
