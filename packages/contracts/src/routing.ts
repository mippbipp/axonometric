import { Array as Arr, Option, Order, Record as Rec } from "effect";
import { dual } from "effect/Function";

import {
  boundsOfPoints,
  clipToConvex,
  distanceToPolyline,
  growRect,
  rectPolygon,
} from "./geometry.ts";
import {
  boxOutline,
  nameTagRect,
  nameTagText,
  project,
  tileHeight,
  tileWidth,
} from "./iso.ts";
import type { ScreenPoint, ScreenRect } from "./iso.ts";
import type { GridPoint, Layout, Placement } from "./layout.ts";
import type { Hop, MapData, Shape } from "./map-data.ts";
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
  /**
   * Whether the route is longer than `routeCap` allows for the distance
   * between its ends, because nothing shorter gets through.
   */
  readonly tooLong: boolean;
}

/**
 * The longest a route may be, in grid units, for ends `distance` apart along
 * the axes: half as long again, plus a little room to turn.
 */
export const routeCap = (distance: number) => 1.5 * distance + 4;

/** A route's length in grid units, and the distance between its ends. */
export const routeLength = (points: readonly GridPoint[]) => {
  const legs = Arr.reduce(
    points,
    { length: 0, last: points[0] },
    (sum, point) => ({
      length:
        sum.last === undefined
          ? 0
          : sum.length +
            Math.abs(point.x - sum.last.x) +
            Math.abs(point.y - sum.last.y),
      last: point,
    })
  );

  const [first] = points;
  const last = points.at(-1);

  return {
    length: legs.length,
    distance:
      first === undefined || last === undefined
        ? 0
        : Math.abs(last.x - first.x) + Math.abs(last.y - first.y),
  };
};

/** The router works in half units, so every grid value is a whole number. */
const scale = 2;

/**
 * How far past every footprint and zone the router may go, in half units.
 */
const margin = 4;

const stepCost = 1;

/**
 * Each bend costs as much as this many half-unit steps: 80 grid units. A
 * route only adds a bend to get around a box or to keep out of a name tag,
 * never to save length, and never turns into a staircase to stay inside its
 * area.
 */
const bendCost = 240;

/**
 * Each bend costs this many half-unit steps more for every grid unit of
 * screen distance it sits outside its route's area (see `routeArea`). With
 * the same number of bends, a route picks the one that stays between its
 * boxes on screen.
 */
const bendStrayCost = 60;

/**
 * Each bend costs this many half-unit steps more for the square of its
 * screen distance, in grid units, from the line between its two boxes'
 * screen centres. It picks the narrowest of routes with the same bends:
 * between boxes one above the other, a balanced Z.
 */
const bendLineCost = 4;

/** One grid unit along x or y, measured on screen. */
const gridOnScreen = Math.hypot(tileWidth / 2, tileHeight / 2);

/** How far past its two boxes' silhouettes a route's area reaches, in grid units. */
export const areaMargin = 1.5;

/** One end of a hop, as `routeArea` needs it. */
export interface AreaEnd {
  readonly placement: Placement;
  readonly shape: Shape;
}

/**
 * The area on screen a hop's route should stay within: the bounding box of
 * its two structures' drawn silhouettes, to their iso heights, widened by
 * `areaMargin` grid units on each side. It's what the reader sees the hop
 * join.
 */
export const routeArea: {
  (to: AreaEnd): (from: AreaEnd) => ScreenRect;
  (from: AreaEnd, to: AreaEnd): ScreenRect;
} = dual(2, (from: AreaEnd, to: AreaEnd): ScreenRect =>
  growRect(
    boundsOfPoints([
      ...boxOutline(from.placement, from.shape),
      ...boxOutline(to.placement, to.shape),
    ]),
    areaMargin * gridOnScreen
  )
);

/** How far a screen point sits outside an area, in grid units. */
export const outsideArea: {
  (point: ScreenPoint): (area: ScreenRect) => number;
  (area: ScreenRect, point: ScreenPoint): number;
} = dual(
  2,
  (area: ScreenRect, point: ScreenPoint) =>
    (Math.max(area.left - point.sx, 0, point.sx - area.right) +
      Math.max(area.top - point.sy, 0, point.sy - area.bottom)) /
    gridOnScreen
);

/** Running alongside another hop's route costs this much more per step. */
const sharedStepCost = 1;

/**
 * Passing through a point a hop between the same two structures already
 * uses. Steps they use can't be shared at all.
 */
const pairPointCost = 8;

/**
 * What leaving or entering a box by an edge costs: an edge facing the other
 * end costs nothing, or a little when the other end lies beyond two edges
 * and this one faces it less directly on screen; an edge facing away costs
 * more than a bend, so a route takes it only when the facing edges are
 * blocked.
 */
const facingCosts = [0, 2, 600, 600] as const;

/**
 * Entering a box by a back edge (-x or -y) costs this much more, because the
 * box is drawn over the arrowhead there.
 */
const backEndCost = 16;

/**
 * Crossing the route of another hop that starts or ends at one of this
 * hop's structures costs as much as this many half-unit steps, so hops from
 * one structure fan out instead of crossing.
 */
const siblingCrossCost = 40;

/**
 * Each half-unit step inside the zone of a group neither end belongs to.
 * Far less than running under a box, so a route crosses a zone rather than
 * a box.
 */
const zoneStepCost = 3;

/** Each half unit a route's end sits from the middle of its edge. */
const offCentreCost = 0.25;

/** Running under a box costs more than any clear route could. */
const crossCost = 1e6;

/**
 * Running through a name tag costs more than any detour, but less than
 * running under a box.
 */
const tagCost = 1e4;

/** How far a route's first and last legs run straight out, in half units. */
const stubLengths = [2, 1] as const;

/** Room kept around a name tag, in screen units. */
const tagMargin = 3;

interface Box {
  readonly id: string;
  readonly group: string;
  readonly placement: Placement;
  readonly shape: Shape;
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

const toBox = (
  {
    id,
    group,
    shape = "box",
  }: { readonly id: string; readonly group: string; readonly shape?: Shape },
  placement: Placement
): Box => ({
  id,
  group,
  placement,
  shape,
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
  /** Like `touches`, for steps whose line on screen crosses a name tag. */
  readonly inTags: readonly (readonly number[] | undefined)[];
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

/** A step's line on screen. */
const stepOnScreen = (x: number, y: number, direction: 0 | 1) => ({
  start: project({ x: x / scale, y: y / scale }),
  end: project({
    x: (x + (direction === 0 ? 1 : 0)) / scale,
    y: (y + (direction === 1 ? 1 : 0)) / scale,
  }),
});

const gridOf = (
  boxes: readonly Box[],
  zones: readonly Box[],
  {
    tags,
    extra,
  }: {
    readonly tags: readonly ScreenRect[];
    readonly extra: readonly { x: number; y: number }[];
  }
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
  const inTags: (number[] | undefined)[] = [];

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

  const tagShapes = Arr.map(tags, (tag) =>
    rectPolygon(growRect(tag, tagMargin))
  );

  for (let y = top; y < top + height; y++) {
    for (let x = left; x < left + width; x++) {
      for (const direction of [0, 1] as const) {
        const line = stepOnScreen(x, y, direction);

        Arr.forEach(tagShapes, (shape, tagIndex) => {
          const tag = tags[tagIndex];

          const near =
            tag !== undefined &&
            Math.max(line.start.sx, line.end.sx) >= tag.left - tagMargin &&
            Math.min(line.start.sx, line.end.sx) <= tag.right + tagMargin &&
            Math.max(line.start.sy, line.end.sy) >= tag.top - tagMargin &&
            Math.min(line.start.sy, line.end.sy) <= tag.bottom + tagMargin;

          if (near && clipToConvex(line, shape) !== undefined) {
            push(inTags, keyOf(x, y, direction), tagIndex);
          }
        });
      }
    }
  }

  return {
    left,
    top,
    width,
    height,
    boxes,
    touches,
    zones,
    inZones,
    inTags,
  };
};

/**
 * The points along an edge from `from` to `to`, corners included, so a
 * route may leave a corner along either of its edges' outward directions.
 * Corners cost a little more than the edge's middle (see `offCentreCost`).
 */
const along = (from: number, to: number) => Arr.range(from, to);

/** A point on a footprint's edge a route may start or end at. */
interface EdgePoint {
  readonly x: number;
  readonly y: number;
  /** The direction pointing out of the footprint. */
  readonly out: number;
  readonly cost: number;
}

/** The screen direction each edge faces: +x, +y, -x and -y. */
const edgeNormals = [
  { sx: 2, sy: 1 },
  { sx: -2, sy: 1 },
  { sx: -2, sy: -1 },
  { sx: 2, sy: -1 },
] as const;

/**
 * Whether `other` lies beyond each edge of `box`, in edge order +x, +y,
 * -x, -y: an edge faces the other end when the other footprint starts past
 * it. Ends apart on both axes have two facing edges.
 */
export const facingEdges: {
  (other: Placement): (box: Placement) => readonly boolean[];
  (box: Placement, other: Placement): readonly boolean[];
} = dual(2, (box: Placement, other: Placement): readonly boolean[] => [
  other.x >= box.x + box.w,
  other.y >= box.y + box.d,
  other.x + other.w <= box.x,
  other.y + other.d <= box.y,
]);

const placementOf = (box: Box): Placement => ({
  x: box.x0 / scale,
  y: box.y0 / scale,
  w: (box.x1 - box.x0) / scale,
  d: (box.y1 - box.y0) / scale,
});

/**
 * Each edge's facing cost for a box whose other end is `other`. Edges that
 * face it cost nothing, or a little for the one of two that faces it less
 * directly on screen; the others cost a lot.
 */
const facingOf = (box: Box, other: Box): readonly number[] => {
  const gx = (other.x0 + other.x1 - box.x0 - box.x1) / 2;
  const gy = (other.y0 + other.y1 - box.y0 - box.y1) / 2;
  const toward = { sx: gx - gy, sy: (gx + gy) / 2 };

  const scores = Arr.map(
    edgeNormals,
    (normal) => normal.sx * toward.sx + normal.sy * toward.sy
  );

  const ranked = Arr.sort(
    Arr.range(0, 3),
    Order.mapInput(Order.Number, (edge: number) => -(scores[edge] ?? 0))
  );

  const faces = facingEdges(placementOf(box), placementOf(other));

  return Arr.map(Arr.range(0, 3), (edge) =>
    faces[edge] === true
      ? ranked.indexOf(edge) === 0
        ? 0
        : facingCosts[1]
      : facingCosts[2]
  );
};

/**
 * The points on a footprint's edge a route may start or end at, each with
 * what it costs to use it: the edge's facing cost towards `other`, plus a
 * little for points away from the middle of their edge, so a lone route
 * leaves from the middle.
 */
const edgePoints = (
  box: Box,
  other: Box,
  backCost = 0
): readonly EdgePoint[] => {
  const midX = (box.x0 + box.x1) / 2;
  const midY = (box.y0 + box.y1) / 2;
  const facing = facingOf(box, other);

  const costOf = (out: number) =>
    (facing[out] ?? 0) + (out >= 2 ? backCost : 0);

  return [
    ...Arr.map(along(box.x0, box.x1), (x) => ({
      x,
      y: box.y1,
      out: 1,
      cost: costOf(1) + offCentreCost * Math.abs(x - midX),
    })),
    ...Arr.map(along(box.y0, box.y1), (y) => ({
      x: box.x1,
      y,
      out: 0,
      cost: costOf(0) + offCentreCost * Math.abs(y - midY),
    })),
    ...Arr.map(along(box.x0, box.x1), (x) => ({
      x,
      y: box.y0,
      out: 3,
      cost: costOf(3) + offCentreCost * Math.abs(x - midX),
    })),
    ...Arr.map(along(box.y0, box.y1), (y) => ({
      x: box.x0,
      y,
      out: 2,
      cost: costOf(2) + offCentreCost * Math.abs(y - midY),
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
  /**
   * For each structure, the points the routes of its hops pass and the axes
   * their legs run along there: 1 for x, 2 for y.
   */
  readonly axes: Map<string, Map<number, number>>;
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

const axesOf = (usage: Usage, structure: string) => {
  const existing = usage.axes.get(structure);

  if (existing !== undefined) {
    return existing;
  }

  const created = new Map<number, number>();

  usage.axes.set(structure, created);

  return created;
};

const record = (
  grid: Grid,
  {
    usage,
    key,
    ends,
  }: {
    readonly usage: Usage;
    readonly key: string;
    readonly ends: readonly string[];
  },
  points: readonly Cell[]
) => {
  const pair = pairUsage(usage, key);
  const maps = Arr.map(ends, (end) => axesOf(usage, end));

  for (const { a, b } of stepsAlong(points)) {
    const step = stepKey(grid, a, directionOf(a, b));
    const axis = directionOf(a, b) % 2 === 0 ? 1 : 2;

    for (const map of maps) {
      for (const point of [pointIndex(grid, a), pointIndex(grid, b)]) {
        map.set(point, (map.get(point) ?? 0) | axis);
      }
    }

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
  readonly from: Box;
  readonly to: Box;
  /** Where the routes of the ends' other hops run, and along which axes. */
  readonly siblings: readonly ReadonlyMap<number, number>[];
  /** When set, steps outside this box aren't allowed at all. */
  readonly window: Box | undefined;
  /** The route's area on screen. */
  readonly area: ScreenRect;
  /** The line between the two boxes' screen centres. */
  readonly line: readonly [ScreenPoint, ScreenPoint];
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

  const reverse = heading !== noDirection && (heading + 2) % 4 === direction;

  const outside =
    search.window !== undefined && distanceTo(search.window, next) > 0;

  if (
    !inside(grid, next) ||
    outside ||
    search.pair.steps.has(step) ||
    ownEnd ||
    reverse
  ) {
    return undefined;
  }

  const turns = heading !== noDirection && heading !== direction;
  const bend = turns ? bendCost + strayOf(search, from) : 0;
  const nextIndex = pointIndex(grid, next);

  const across = direction % 2 === 0 ? 2 : 1;

  const crossings = Arr.filter(
    search.siblings,
    (map) => ((map.get(nextIndex) ?? 0) & across) !== 0
  ).length;

  const zones = Arr.filter(
    grid.inZones[step] ?? [],
    (zoneIndex) => !search.groups.has(grid.zones[zoneIndex]?.group ?? "")
  ).length;

  return (
    stepCost +
    bend +
    touched.length * crossCost +
    zones * zoneStepCost +
    crossings * siblingCrossCost +
    (grid.inTags[step] ?? []).length * tagCost +
    (search.usage.steps.has(step) ? sharedStepCost : 0) +
    (search.pair.points.has(nextIndex) ? pairPointCost : 0)
  );
};

/** What a bend at `cell` costs for sitting outside the route's area. */
const strayOf = (search: Search, cell: Cell) => {
  const at = project({ x: cell.x / scale, y: cell.y / scale });
  const fromLine = distanceToPolyline(search.line, at) / gridOnScreen;

  // Squared, so one far bend costs more than two bends half as far: a
  // balanced Z beats a lopsided one.
  return (
    bendStrayCost * outsideArea(search.area, at) +
    bendLineCost * fromLine * fromLine
  );
};

/** The screen point over the middle of a footprint, at ground level. */
const screenCentre = (box: Box) =>
  project({
    x: (box.x0 + box.x1) / 2 / scale,
    y: (box.y0 + box.y1) / 2 / scale,
  });

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

  return Arr.reverse(path);
};

const stepFrom = (cell: Cell, direction: number, count = 1): Cell => ({
  x: cell.x + (dx[direction] ?? 0) * count,
  y: cell.y + (dy[direction] ?? 0) * count,
});

/** The start of a running total that may turn out blocked. */
const noPrice = (): number | undefined => 0;

/**
 * What it costs to run straight from `from` for `count` steps in
 * `direction`, or `undefined` when a step is blocked.
 */
const runPrice = (
  search: Search,
  from: Cell,
  { direction, count }: { readonly direction: number; readonly count: number }
) =>
  Arr.reduce(Arr.range(0, count - 1), noPrice(), (sum, step) => {
    const price = stepPrice(
      search,
      { from: stepFrom(from, direction, step), heading: direction },
      direction
    );

    return sum === undefined || price === undefined ? undefined : sum + price;
  });

/** A stub: a straight run out from an edge point, where the search meets it. */
interface Stub {
  readonly edge: EdgePoint;
  /** The stub's far end, away from the box. */
  readonly tip: Cell;
  readonly cost: number;
}

/**
 * Every stub out of `box`: from each edge point, straight out for each of
 * `stubLengths`, with what the edge point and the run cost. Longer stubs
 * come first and cost less, so a route leaves a box squarely.
 */
const stubsOf = (search: Search, box: Box, other: Box): readonly Stub[] =>
  Arr.flatMap(edgePoints(box, other), (edge) =>
    Arr.flatMap(stubLengths, (count, index) => {
      const price = runPrice(search, edge, { direction: edge.out, count });

      return price === undefined
        ? []
        : [
            {
              edge,
              tip: stepFrom(edge, edge.out, count),
              cost: edge.cost + price + index * bendCost,
            },
          ];
    })
  );

/** The price of a step back into a box, for a stub at the route's end. */
const inwardStubsOf = (search: Search, box: Box, other: Box): readonly Stub[] =>
  Arr.flatMap(edgePoints(box, other, backEndCost), (edge) =>
    Arr.flatMap(stubLengths, (count, index) => {
      const tip = stepFrom(edge, edge.out, count);

      const price = runPrice(search, tip, {
        direction: (edge.out + 2) % 4,
        count,
      });

      return price === undefined
        ? []
        : [{ edge, tip, cost: edge.cost + price + index * bendCost }];
    })
  );

/** The best way found so far to finish a route. */
interface Finish {
  readonly cost: number;
  readonly state: number;
  readonly stub: Stub;
}

/** One search's working state. */
interface Frontier {
  readonly cost: Float64Array;
  readonly parent: Int32Array;
  readonly done: Uint8Array;
  readonly origin: Map<number, Cell>;
  readonly queue: ReturnType<typeof makeQueue>;
}

const searchOf = (
  grid: Grid,
  { usage, key }: { readonly usage: Usage; readonly key: string },
  {
    from,
    to,
    window,
  }: {
    readonly from: Box;
    readonly to: Box;
    readonly window: Box | undefined;
  }
): Search => ({
  grid,
  usage,
  pair: pairUsage(usage, key),
  ends: new Set([from.id, to.id]),
  groups: new Set([from.group, to.group]),
  from,
  to,
  siblings: Arr.flatMap([from.id, to.id], (id) =>
    Option.toArray(Option.fromNullishOr(usage.axes.get(id)))
  ),
  window,
  area: routeArea(from, to),
  line: [screenCentre(from), screenCentre(to)],
});

/** The stubs into the target, keyed by the point where the search meets them. */
const goalsOf = (search: Search) => {
  const goals = new Map<number, Stub[]>();

  for (const stub of inwardStubsOf(search, search.to, search.from)) {
    const index = pointIndex(search.grid, stub.tip);

    goals.set(index, [...(goals.get(index) ?? []), stub]);
  }

  return goals;
};

/** The cheapest way to finish from `state` into one of the goal stubs. */
const finishFrom = (
  {
    search,
    goals,
  }: {
    readonly search: Search;
    readonly goals: ReadonlyMap<number, readonly Stub[]>;
  },
  { state, g }: { readonly state: number; readonly g: number },
  best: Finish | undefined
): Finish | undefined => {
  const heading = state % directions;

  return Arr.reduce(
    goals.get(Math.floor(state / directions)) ?? [],
    best,
    (sofar, stub) => {
      const turn =
        heading === (stub.edge.out + 2) % 4
          ? 0
          : bendCost + strayOf(search, cellOf(search.grid, state));

      const total =
        heading === stub.edge.out
          ? Number.POSITIVE_INFINITY
          : g + stub.cost + turn;

      return sofar === undefined || total < sofar.cost
        ? { cost: total, state, stub }
        : sofar;
    }
  );
};

/** Pushes every step out of `state` that improves on what's known. */
const expand = (search: Search, frontier: Frontier, state: number) => {
  const { grid, to } = search;
  const heading = state % directions;
  const here = cellOf(grid, state);
  const g = frontier.cost[state] ?? 0;

  for (const direction of [0, 1, 2, 3]) {
    const price = stepPrice(search, { from: here, heading }, direction);
    const next = stepFrom(here, direction);
    const total = g + (price ?? Number.POSITIVE_INFINITY);
    const nextState = pointIndex(grid, next) * directions + direction;

    if (total < (frontier.cost[nextState] ?? Number.POSITIVE_INFINITY)) {
      frontier.cost[nextState] = total;
      frontier.parent[nextState] = state;
      frontier.queue.push(nextState, total + distanceTo(to, next));
    }
  }
};

/** The route a finished search found, from edge to edge, corners only. */
const routeOf = (grid: Grid, frontier: Frontier, best: Finish) => {
  const path = pathTo(grid, frontier.parent, best.state);
  let seed = best.state;

  while ((frontier.parent[seed] ?? -1) !== -1) {
    seed = frontier.parent[seed] ?? -1;
  }

  const start = frontier.origin.get(seed);

  return cornersOf([
    ...(start === undefined ? [] : [start]),
    ...path,
    { x: best.stub.edge.x, y: best.stub.edge.y },
  ]);
};

/**
 * The cheapest route from `from`'s edge to `to`'s edge, by A* over the
 * half-unit grid with a cost for each bend. Each end runs straight out of
 * its box for a stub before it may turn. Running under a box costs more
 * than any clear route, so the route runs under the fewest boxes it can.
 */
const searchRoute = (
  grid: Grid,
  pair: { readonly usage: Usage; readonly key: string },
  ends: {
    readonly from: Box;
    readonly to: Box;
    readonly window: Box | undefined;
  }
): readonly Cell[] => {
  const search = searchOf(grid, pair, ends);
  const goals = goalsOf(search);
  const size = grid.width * grid.height * directions;

  const frontier: Frontier = {
    cost: new Float64Array(size).fill(Number.POSITIVE_INFINITY),
    parent: new Int32Array(size).fill(-1),
    done: new Uint8Array(size),
    origin: new Map(),
    queue: makeQueue(),
  };

  for (const stub of stubsOf(search, ends.from, ends.to)) {
    const state = pointIndex(grid, stub.tip) * directions + stub.edge.out;

    if (stub.cost < (frontier.cost[state] ?? Number.POSITIVE_INFINITY)) {
      frontier.cost[state] = stub.cost;
      frontier.origin.set(state, stub.edge);
      frontier.queue.push(state, stub.cost + distanceTo(ends.to, stub.tip));
    }
  }

  let best: Finish | undefined;

  for (
    let state = frontier.queue.pop();
    state !== undefined;
    state = frontier.queue.pop()
  ) {
    const g = frontier.cost[state] ?? 0;
    const bound = g + distanceTo(ends.to, cellOf(grid, state));

    if (best !== undefined && bound >= best.cost) {
      break;
    }

    if (frontier.done[state] !== 1) {
      frontier.done[state] = 1;
      best = finishFrom({ search, goals }, { state, g }, best);
      expand(search, frontier, state);
    }
  }

  return best === undefined ? [] : routeOf(grid, frontier, best);
};

/** How far past the box around both ends a capped route may go. */
const windowMargin = 4;

const lengthOfCells = (points: readonly Cell[]) =>
  routeLength(Arr.map(points, ({ x, y }) => ({ x: x / scale, y: y / scale })));

const withinCap = (points: readonly Cell[]) => {
  const { length, distance } = lengthOfCells(points);

  return length <= routeCap(distance);
};

/**
 * The cheapest route, unless it's longer than `routeCap` allows. Then the
 * route is searched again inside the box around both ends, grown by
 * `windowMargin`, which may mean running under a box; the shorter of the
 * two is kept.
 */
const cappedRoute = (
  grid: Grid,
  pair: { readonly usage: Usage; readonly key: string },
  { from, to }: { readonly from: Box; readonly to: Box }
): readonly Cell[] => {
  const free = searchRoute(grid, pair, { from, to, window: undefined });

  if (free.length === 0 || withinCap(free)) {
    return free;
  }

  const tight = searchRoute(grid, pair, {
    from,
    to,
    window: {
      ...from,
      id: "",
      group: "",
      x0: Math.min(from.x0, to.x0) - windowMargin,
      y0: Math.min(from.y0, to.y0) - windowMargin,
      x1: Math.max(from.x1, to.x1) + windowMargin,
      y1: Math.max(from.y1, to.y1) + windowMargin,
    },
  });

  return tight.length > 0 &&
    lengthOfCells(tight).length < lengthOfCells(free).length
    ? tight
    : free;
};

/**
 * Routes every hop whose ends both have a placement. A hop with a route
 * override in `layout.routes` follows it. Every other hop gets a route at
 * right angles on the half-unit grid, from the edge of one footprint to the
 * edge of the other, going around every footprint whenever a clear route
 * exists. A route costs its length, a fixed cost per bend, and more for each
 * bend outside `routeArea`, the screen area its two boxes span, so routes
 * stay between their boxes as the reader sees them. Each end
 * leaves or enters by an edge facing the other end, unless something
 * blocks it: every
 * end runs straight out of its box for at least one unit, routes keep out
 * of name tags whenever they can, and hops sharing a structure avoid
 * crossing each other. A route longer than `routeCap` allows is searched
 * again close to its ends. Routes stay inside the zones' bounds plus a
 * margin, and keep out of the zones of
 * groups neither end belongs to when they can. Hops between the same two
 * structures, in either direction, never share a step, so they run side by
 * side. Overrides go first, then the longest hops, then data.mjs order for
 * ties, and the same map always gives
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

    const tags = Arr.flatMap(data.structures, (structure) => {
      const placement = layout.structures[structure.id];

      return placement === undefined
        ? []
        : [nameTagRect(placement, nameTagText(structure))];
    });

    const grid = gridOf(boxes, zones, { tags, extra: overridePoints });

    const usage: Usage = {
      steps: new Set(),
      axes: new Map(),
      pairs: new Map(),
    };

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
          ? cappedRoute(grid, { usage, key }, { from, to })
          : Arr.map(override, toHalfUnits);

      if (halfUnits.length === 0) {
        return;
      }

      record(grid, { usage, key, ends: [hop.from, hop.to] }, halfUnits);

      const points =
        override ??
        Arr.map(halfUnits, (point) => ({
          x: point.x / scale,
          y: point.y / scale,
        }));

      const { length, distance } = routeLength(points);

      routes[hop.id] = {
        points,
        crosses: crossesOf(boxes, ends, halfUnits),
        overridden: override !== undefined,
        tooLong: length > routeCap(distance),
      };
    };

    // Overrides go first, so automatic routes keep clear of them.
    for (const hop of data.hops) {
      if (Rec.has(overrides, hop.id)) {
        routeOne(hop);
      }
    }

    // Then the longest hops, which have the fewest good ways through, so
    // the shorter ones fan out around them. Ties keep data.mjs order.
    const span = (hop: Hop) => {
      const from = byId.get(hop.from);
      const to = byId.get(hop.to);

      return from === undefined || to === undefined
        ? 0
        : Math.abs(from.x0 + from.x1 - to.x0 - to.x1) +
            Math.abs(from.y0 + from.y1 - to.y0 - to.y1);
    };

    const automatic = Arr.sort(
      Arr.filter(data.hops, (hop) => !Rec.has(overrides, hop.id)),
      Order.mapInput(Order.Number, (hop: Hop) => -span(hop))
    );

    for (const hop of automatic) {
      routeOne(hop);
    }

    return Rec.fromEntries(
      Arr.flatMap(data.hops, ({ id }) => {
        const route = routes[id];

        return route === undefined ? [] : [[id, route] as const];
      })
    );
  }
);

/** What `routeRevealed` routes. */
export interface RevealedSource {
  readonly data: MapData;
  readonly layout: Layout;
  /** The structures drawn, such as those a chapter has revealed so far. */
  readonly revealed: ReadonlySet<string>;
}

/**
 * Routes the hops between revealed structures around the revealed
 * structures only, as one chapter of the walkthrough draws them. A chapter
 * that shows three structures routes them as if nothing else were there,
 * so its hops stay short; a later chapter that reveals more routes again.
 */
export const routeRevealed = ({
  data,
  layout,
  revealed,
}: RevealedSource): Readonly<Record<string, HopRoute>> =>
  routeHops(
    {
      ...data,
      structures: Arr.filter(data.structures, ({ id }) => revealed.has(id)),
      hops: Arr.filter(
        data.hops,
        ({ from, to }) => revealed.has(from) && revealed.has(to)
      ),
    },
    layout
  );
