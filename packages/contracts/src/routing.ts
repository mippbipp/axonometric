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
  gridOnScreen,
  nameTagRect,
  nameTagText,
  project,
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
 * the axes: half as long again, plus one unit. The unit is the slack two
 * half-unit face stubs need when a route leaves or enters at a corner, the
 * most any route between footprints at least a half unit apart overshoots
 * `1.5 * distance` by. Footprints that touch can need more, because both
 * ends' stubs must clear the shared edge; placement keeps a gap, and `check`
 * warns when a hand-placed layout makes such a route long.
 */
export const routeCap = (distance: number) => 1.5 * distance + 1;

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
 * Each bend costs as much as this many half-unit steps: 120 grid units. It
 * must outweigh the extra length of any detour on a map, so a route adds a
 * bend only to get around a box or out of a name tag, and never turns into
 * a staircase to stay inside its area.
 */
const bendCost = 240;

/**
 * Each bend costs this many half-unit steps more for every grid unit of
 * screen distance it sits outside its route's area (see `routeArea`). It
 * must outweigh a few grid units of extra length, so of routes with the
 * same bends one inside the area wins, but stay well below `bendCost`, so
 * it never buys an extra bend.
 */
const bendStrayCost = 60;

/**
 * Each bend costs this many half-unit steps more for the square of its
 * screen distance, in grid units, from the line between its two boxes'
 * screen centres. Squared, a far bend outweighs two near ones, so between
 * boxes one above the other a balanced Z beats a lopsided one; small, it
 * only chooses among routes `bendStrayCost` already ranks equal.
 */
const bendLineCost = 4;

/** How far past its two boxes' silhouettes a route's area reaches, in grid units. */
const areaMargin = 1.5;

/** One end of a hop, as `routeArea` needs it. */
interface AreaEnd {
  readonly placement: Placement;
  readonly shape: Shape;
}

/**
 * The area on screen a hop's route should stay within: the bounding box of
 * its two structures' drawn silhouettes, to their iso heights, widened by
 * `areaMargin` grid units on each side. It's what the reader sees the hop
 * join.
 */
const routeArea: {
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
const outsideArea: {
  (point: ScreenPoint): (area: ScreenRect) => number;
  (area: ScreenRect, point: ScreenPoint): number;
} = dual(
  2,
  (area: ScreenRect, point: ScreenPoint) =>
    (Math.max(area.left - point.sx, 0, point.sx - area.right) +
      Math.max(area.top - point.sy, 0, point.sy - area.bottom)) /
    gridOnScreen
);

/**
 * Passing through a point a hop between the same two structures already
 * uses. Steps they use can't be shared at all.
 */
const pairPointCost = 8;

/**
 * What leaving or entering a box by an edge costs, on top of the route. An
 * edge facing the other end straight on costs nothing.
 */
const edgeCosts = {
  /**
   * The other of two facing edges, when the other end lies beyond both: a
   * little, so the more direct one wins a tie.
   */
  facingAside: 2,
  /**
   * An edge facing away. It must outweigh two bends, the detour round to a
   * facing edge, so a route takes it only when every facing edge is
   * blocked.
   */
  facingAway: 600,
} as const;

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
const zoneStepCost = 20;

/** Each half unit a route's end sits from the middle of its edge. */
const offCentreCost = 0.25;

/**
 * Each half-unit step under a box. It must outweigh every other cost a
 * clear route can add up on a map, bends and detours included, so a route
 * runs under a box only when no clear route exists.
 */
const crossCost = 1e6;

/**
 * Each step through a name tag. It must outweigh any detour, bends
 * included, so a route crosses a tag only when nothing goes round; and stay
 * far below `crossCost`, so it crosses a tag rather than run under a box.
 */
const tagCost = 3e5;

/**
 * Each point on a box's outline a route passes, other than its own ends,
 * and each step along a zone's outline. Each step or point another route
 * already uses, other than a crossing at right angles. Each is drawn as a
 * clash, so it must outweigh any detour; it stays below `tagCost`, so a
 * route touches an outline rather than run through a name tag.
 */
const touchCost = 1e5;

/**
 * Each step or point another route already uses, other than a crossing at
 * right angles. It's drawn as one line, so it must outweigh any detour,
 * leaving by a back edge included.
 */
const shareCost = 1e5;

/**
 * Each point a half unit from a box's outline, and each step running a half
 * unit beside a zone's outline, other than an end's stub. A zone reaches
 * only a unit past its boxes, so a route round a box inside its own zone
 * has one lane, a half unit from both outlines. Blocking it would push
 * routes out of their zones and past `routeCap`, so it only breaks ties
 * towards a lane further out.
 */
const nearCost = 0.5;

/**
 * What a stub of a half unit costs more than one of a whole unit. Less than
 * a bend, so a route takes a short stub to keep a half unit off another
 * zone's outline rather than cross the zone.
 */
const shortStubCost = 60;

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

/**
 * The four directions on the ground, as numbers so they key arrays and the
 * search's states: along +x, +y, -x and -y. Opposite directions are two
 * apart, and the axis is the number's parity (even along x, odd along y).
 */
const plusX = 0;

const plusY = 1;

const minusX = 2;

const minusY = 3;

const dx = [1, 0, -1, 0] as const;

const dy = [0, 1, 0, -1] as const;

/** The heading of a route's first point, which has no direction yet. */
const noDirection = 4;

/** How many headings a search state can have, `noDirection` included. */
const directions = 5;

const opposite = (direction: number) => (direction + 2) % 4;

/** Whether a direction runs along x. */
const alongXAxis = (direction: number) => direction % 2 === 0;

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
  /** For each point, the indexes of the boxes whose outline it's on. */
  readonly onOutline: readonly (readonly number[] | undefined)[];
  /**
   * For each point, the indexes of the boxes whose outline it's a half
   * unit from, outside the box.
   */
  readonly nearOutline: readonly (readonly number[] | undefined)[];
  /** Like `touches`, for steps along a zone's outline. */
  readonly alongZones: readonly (readonly number[] | undefined)[];
  /**
   * Like `touches`, for steps running beside a zone's outline, a half unit
   * inside or outside it.
   */
  readonly besideZones: readonly (readonly number[] | undefined)[];
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
  const onOutline: (number[] | undefined)[] = [];
  const nearOutline: (number[] | undefined)[] = [];
  const alongZones: (number[] | undefined)[] = [];
  const besideZones: (number[] | undefined)[] = [];

  const keyOf = (x: number, y: number, direction: 0 | 1) =>
    ((y - top) * width + (x - left)) * 2 + direction;

  const pointOf = (x: number, y: number) => (y - top) * width + (x - left);

  // A box's outline, and the ring a half unit outside it.
  Arr.forEach(boxes, (box, boxIndex) => {
    for (let y = box.y0 - 1; y <= box.y1 + 1; y++) {
      for (let x = box.x0 - 1; x <= box.x1 + 1; x++) {
        const inner = x > box.x0 && x < box.x1 && y > box.y0 && y < box.y1;
        const outer = x < box.x0 || x > box.x1 || y < box.y0 || y > box.y1;

        if (outer) {
          push(nearOutline, pointOf(x, y), boxIndex);
        } else if (!inner) {
          push(onOutline, pointOf(x, y), boxIndex);
        }
      }
    }
  });

  // Steps along a zone's outline, and beside it a half unit either way.
  Arr.forEach(zones, (zone, zoneIndex) => {
    for (const offset of [-1, 0, 1]) {
      const lists = offset === 0 ? alongZones : besideZones;

      for (const y of [zone.y0 + offset, zone.y1 + offset]) {
        for (let x = zone.x0 - 1; x <= zone.x1; x++) {
          push(lists, keyOf(x, y, 0), zoneIndex);
        }
      }

      for (const x of [zone.x0 + offset, zone.x1 + offset]) {
        for (let y = zone.y0 - 1; y <= zone.y1; y++) {
          push(lists, keyOf(x, y, 1), zoneIndex);
        }
      }
    }
  });

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
    onOutline,
    nearOutline,
    alongZones,
    besideZones,
  };
};

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
const facingEdges: {
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

  const costOf = (edge: number) => {
    if (faces[edge] !== true) {
      return edgeCosts.facingAway;
    }

    return ranked.indexOf(edge) === 0 ? 0 : edgeCosts.facingAside;
  };

  return Arr.map(Arr.range(0, 3), costOf);
};

/**
 * The points on a footprint's edge a route may start or end at: at least a
 * half unit from the edge's corners, or anywhere on an edge too short for
 * that. Each comes with what it costs to use it: the edge's
 * facing cost towards `other`, `backCost` more on a back edge (-x or -y),
 * and a little for points away from the middle of their edge, so a lone
 * route leaves from the middle.
 */
const edgePoints = (
  box: Box,
  other: Box,
  backCost = 0
): readonly EdgePoint[] => {
  const midX = (box.x0 + box.x1) / 2;
  const midY = (box.y0 + box.y1) / 2;
  const facing = facingOf(box, other);

  const along = alongEdge;

  const costOf = (out: number) =>
    (facing[out] ?? 0) + (out === minusX || out === minusY ? backCost : 0);

  return [
    ...Arr.map(along(box.x0, box.x1), (x) => ({
      x,
      y: box.y1,
      out: plusY,
      cost: costOf(plusY) + offCentreCost * Math.abs(x - midX),
    })),
    ...Arr.map(along(box.y0, box.y1), (y) => ({
      x: box.x1,
      y,
      out: plusX,
      cost: costOf(plusX) + offCentreCost * Math.abs(y - midY),
    })),
    ...Arr.map(along(box.x0, box.x1), (x) => ({
      x,
      y: box.y0,
      out: minusY,
      cost: costOf(minusY) + offCentreCost * Math.abs(x - midX),
    })),
    ...Arr.map(along(box.y0, box.y1), (y) => ({
      x: box.x0,
      y,
      out: minusX,
      cost: costOf(minusX) + offCentreCost * Math.abs(y - midY),
    })),
  ];
};

/** The half-unit positions along an edge an end may take: clear of corners. */
const alongEdge = (from: number, to: number) =>
  to - from >= 2 ? Arr.range(from + 1, to - 1) : Arr.range(from, to);

/** The points an end may take on one edge of `box`, in order along it. */
const pointsOnEdge = (box: Box, out: number): readonly EdgePoint[] => {
  switch (out) {
    case plusY:
      return Arr.map(alongEdge(box.x0, box.x1), (x) => ({
        x,
        y: box.y1,
        out,
        cost: 0,
      }));
    case minusY:
      return Arr.map(alongEdge(box.x0, box.x1), (x) => ({
        x,
        y: box.y0,
        out,
        cost: 0,
      }));
    case plusX:
      return Arr.map(alongEdge(box.y0, box.y1), (y) => ({
        x: box.x1,
        y,
        out,
        cost: 0,
      }));
    default:
      return Arr.map(alongEdge(box.y0, box.y1), (y) => ({
        x: box.x0,
        y,
        out,
        cost: 0,
      }));
  }
};

/**
 * How good an edge of `box` is for an end towards `other`: 0 for an edge
 * facing it, 1 for a side edge, 2 for the back edge.
 */
const edgeTier = (box: Box, other: Box, edge: number) => {
  const faces = facingEdges(placementOf(box), placementOf(other));

  if (faces[edge] === true) {
    return 0;
  }

  return faces[opposite(edge)] === true ? 2 : 1;
};

/**
 * The edges of `box` an end towards `other` may take, best first: the
 * edges facing `other`, then the side edges, then the back edge. Within
 * each, the edge facing `other` most directly on screen comes first.
 */
const edgeOrder = (box: Box, other: Box): readonly number[] => {
  const costs = facingOf(box, other);
  const tier = (edge: number) => edgeTier(box, other, edge);

  return Arr.sort(
    Arr.range(0, 3),
    Order.combine(
      Order.mapInput(Order.Number, tier),
      Order.mapInput(Order.Number, (edge: number) => costs[edge] ?? 0)
    )
  );
};

/**
 * Matches `targets`, in order, to as many of `positions`, in order, keeping
 * both orders, so the total distance from each target to its position is
 * least. Returns each target's position index.
 */
const matchInOrder = (
  targets: readonly number[],
  positions: readonly number[]
): readonly number[] => {
  const n = targets.length;
  const m = positions.length;
  const cost = Arr.makeBy(n + 1, () =>
    Arr.makeBy(m + 1, () => Number.POSITIVE_INFINITY)
  );

  cost[0]?.fill(0);

  for (let i = 1; i <= n; i++) {
    for (let j = i; j <= m; j++) {
      const skip = cost[i]?.[j - 1] ?? Number.POSITIVE_INFINITY;
      const take =
        (cost[i - 1]?.[j - 1] ?? Number.POSITIVE_INFINITY) +
        Math.abs((targets[i - 1] ?? 0) - (positions[j - 1] ?? 0));

      const row = cost[i];

      if (row !== undefined) {
        row[j] = Math.min(skip, take);
      }
    }
  }

  const chosen: number[] = [];
  let j = m;

  for (let i = n; i >= 1; i--) {
    while (j > i && (cost[i]?.[j] ?? 0) === (cost[i]?.[j - 1] ?? 0)) {
      j -= 1;
    }

    chosen[i - 1] = j - 1;
    j -= 1;
  }

  return chosen;
};

/**
 * Which way an end on edge `out` of `box` heads towards `other`, as an
 * angle from the edge's outward normal towards the edge's increasing
 * coordinate. Ends sorted by it along the edge leave without crossing: of
 * two routes turning the same way, the one that turns later takes the
 * point further from the turn.
 */
const headingAlong = (box: Box, other: Box, out: number) => {
  const dx = (other.x0 + other.x1 - box.x0 - box.x1) / 2;
  const dy = (other.y0 + other.y1 - box.y0 - box.y1) / 2;

  switch (out) {
    case plusX:
      return Math.atan2(dy, dx);
    case minusX:
      return Math.atan2(dy, -dx);
    case plusY:
      return Math.atan2(dx, dy);
    default:
      return Math.atan2(dx, -dy);
  }
};

/** One end of a hop at one box, waiting for a point on its edge. */
interface EndSlot {
  readonly key: string;
  readonly box: Box;
  readonly other: Box;
  /** How far apart the two boxes' centres are, in half units. */
  readonly span: number;
}

/**
 * The point on `box` each end takes, keyed by `${hop id}:from` or
 * `${hop id}:to`, chosen for all of a box's ends at once before any route
 * is searched, from the points `usable` allows. Ends with fewer facing
 * points go first, then those of the
 * longest hops, and each takes the first edge in `edgeOrder` with a point
 * left. On each edge the ends are ordered by where they head, the other
 * box's centre along the edge, so routes leaving one edge don't cross by
 * the box, and spread out along the edge.
 */
const assignEnds = (
  slots: readonly EndSlot[],
  usable: (point: EdgePoint) => boolean
): ReadonlyMap<string, EdgePoint> => {
  const assigned = new Map<string, EdgePoint>();
  const byBox = Arr.groupBy(slots, ({ box }) => box.id);

  const centreAlong = (box: Box, out: number) =>
    alongXAxis(out) ? box.y0 + box.y1 : box.x0 + box.x1;

  for (const ends of Object.values(byBox)) {
    const [first] = ends;

    if (first === undefined) {
      continue;
    }

    const { box } = first;

    const free = (out: number) => Arr.filter(pointsOnEdge(box, out), usable);

    const room = new Map(
      Arr.map(Arr.range(0, 3), (out) => [out, free(out).length])
    );

    const facingRoom = (slot: EndSlot) =>
      Arr.reduce(
        Arr.filter(
          Arr.range(0, 3),
          (out) =>
            facingEdges(placementOf(box), placementOf(slot.other))[out] === true
        ),
        0,
        (sum, out) => sum + (room.get(out) ?? 0)
      );

    const order = Arr.sort(
      ends,
      Order.combine(
        Order.mapInput(Order.Number, facingRoom),
        Order.mapInput(Order.Number, (slot: EndSlot) => -slot.span)
      )
    );

    const onEdge = new Map<number, EndSlot[]>();

    // Each end takes the first tier with room: the edges facing its other
    // end, then the sides, then the back. Of the edges in that tier, the
    // one facing most directly on screen goes first.
    for (const slot of order) {
      const tier = (edge: number) => edgeTier(box, slot.other, edge);

      const ranked = edgeOrder(box, slot.other);

      const out = Arr.findFirst(
        Arr.sort(
          Arr.filter(
            ranked,
            (edge) => (onEdge.get(edge)?.length ?? 0) < (room.get(edge) ?? 0)
          ),
          Order.combine(
            Order.mapInput(Order.Number, tier),
            Order.mapInput(Order.Number, (edge: number) => ranked.indexOf(edge))
          )
        ),
        () => true
      );

      if (Option.isSome(out)) {
        onEdge.set(out.value, [...(onEdge.get(out.value) ?? []), slot]);
      }
    }

    for (const [out, placed] of onEdge) {
      const points = free(out);
      const position = (point: EdgePoint) =>
        alongXAxis(out) ? point.y * 2 : point.x * 2;

      const sorted = Arr.sort(
        placed,
        Order.mapInput(Order.Number, (slot: EndSlot) =>
          headingAlong(box, slot.other, out)
        )
      );

      const chosen = matchInOrder(
        Arr.map(sorted, (slot) => centreAlong(slot.other, out)),
        Arr.map(points, position)
      );

      Arr.forEach(sorted, (slot, index) => {
        const point = points[chosen[index] ?? -1];

        if (point !== undefined) {
          assigned.set(slot.key, point);
        }
      });
    }
  }

  return assigned;
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
   * Points any route uses: the axes routes run straight through them along
   * (1 for x, 2 for y), or `bendsHere` where a route bends or ends.
   */
  readonly points: Map<number, number>;
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

/** A point where a route bends or ends, which no other route may touch. */
const bendsHere = 4;

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
    x: direction === minusX ? from.x - 1 : from.x,
    y: direction === minusY ? from.y - 1 : from.y,
  }) *
    2 +
  (direction % 2);

const directionOf = (a: Cell, b: Cell) => {
  if (b.x !== a.x) {
    return b.x > a.x ? plusX : minusX;
  }

  return b.y > a.y ? plusY : minusY;
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
    const axis = alongXAxis(directionOf(a, b)) ? 1 : 2;

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

  const cells = Arr.flatMap(stepsAlong(points), ({ a }) => [a]);
  const last = points.at(-1);
  const all = last === undefined ? cells : [...cells, last];

  Arr.forEach(all, (cell, index) => {
    const before = all[index - 1];
    const after = all[index + 1];
    const point = pointIndex(grid, cell);

    const role =
      before === undefined ||
      after === undefined ||
      alongXAxis(directionOf(before, cell)) !==
        alongXAxis(directionOf(cell, after))
        ? bendsHere
        : alongXAxis(directionOf(cell, after))
          ? 1
          : 2;

    usage.points.set(point, (usage.points.get(point) ?? 0) | role);
  });
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
  /** The points the route must start and end at, when they're assigned. */
  readonly start: EdgePoint | undefined;
  readonly finish: EdgePoint | undefined;
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
  {
    from,
    heading,
    stub = false,
  }: {
    readonly from: Cell;
    readonly heading: number;
    /** Whether the step is part of an end's stub, by its own box. */
    readonly stub?: boolean;
  },
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

  const reverse = heading !== noDirection && opposite(heading) === direction;

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

  const across = alongXAxis(direction) ? 2 : 1;

  const crossings = Arr.filter(
    search.siblings,
    (map) => ((map.get(nextIndex) ?? 0) & across) !== 0
  ).length;

  const zones = Arr.filter(
    grid.inZones[step] ?? [],
    (zoneIndex) => !search.groups.has(grid.zones[zoneIndex]?.group ?? "")
  ).length;

  const counted = (boxIndexes: readonly number[] | undefined) =>
    Arr.filter(
      boxIndexes ?? [],
      (boxIndex) => !stub || !search.ends.has(grid.boxes[boxIndex]?.id ?? "")
    ).length;

  // Two routes may share a point only where both run straight through it
  // at right angles: not another route's bend or end, not along it, and
  // not where this route bends.
  const used = search.usage.points.get(nextIndex) ?? 0;
  const sameAxis = alongXAxis(direction) ? 1 : 2;

  const touchesRoute =
    (used & (bendsHere | sameAxis)) !== 0 ||
    (turns && search.usage.points.has(pointIndex(grid, from)));

  return (
    stepCost +
    counted(grid.onOutline[nextIndex]) * touchCost +
    counted(grid.nearOutline[nextIndex]) * nearCost +
    (grid.alongZones[step] ?? []).length * touchCost +
    (stub ? 0 : (grid.besideZones[step] ?? []).length * nearCost) +
    (touchesRoute ? shareCost : 0) +
    bend +
    touched.length * crossCost +
    zones * zoneStepCost +
    crossings * siblingCrossCost +
    (grid.inTags[step] ?? []).length * tagCost +
    (search.usage.steps.has(step) ? shareCost : 0) +
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
      { from: stepFrom(from, direction, step), heading: direction, stub: true },
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
  Arr.flatMap(startsOf(search, box, other), (edge) =>
    Arr.flatMap(stubLengths, (count, index) => {
      const price = runPrice(search, edge, { direction: edge.out, count });

      return price === undefined
        ? []
        : [
            {
              edge,
              tip: stepFrom(edge, edge.out, count),
              cost:
                edge.cost +
                price +
                index * shortStubCost +
                (search.usage.points.has(pointIndex(search.grid, edge))
                  ? shareCost
                  : 0),
            },
          ];
    })
  );

/**
 * Every stub into `box`, for a route's end: from each edge point, straight
 * out for each of `stubLengths`, priced for the run back in towards the
 * edge, with what the edge point costs (back edges `backEndCost` more).
 */
const inwardStubsOf = (search: Search, box: Box, other: Box): readonly Stub[] =>
  Arr.flatMap(finishesOf(search, box, other, backEndCost), (edge) =>
    Arr.flatMap(stubLengths, (count, index) => {
      const tip = stepFrom(edge, edge.out, count);

      const price = runPrice(search, tip, {
        direction: opposite(edge.out),
        count,
      });

      return price === undefined
        ? []
        : [{ edge, tip, cost: edge.cost + price + index * shortStubCost }];
    })
  );

/** What a search routes between. */
interface RouteEnds {
  readonly from: Box;
  readonly to: Box;
  readonly window: Box | undefined;
  readonly start?: EdgePoint | undefined;
  readonly finish?: EdgePoint | undefined;
}

/**
 * What an end costs at `point` on top of its edge's cost: nothing at its
 * assigned point, `offPointCost` elsewhere on an edge as good, so routes
 * keep the order the assignment gave them unless that costs a bend, and
 * `unassignedCost` for each tier worse, so an end falls back to a side or
 * the back only when the better edges are full.
 */
const assignedPrice = (
  { box, other }: { readonly box: Box; readonly other: Box },
  point: EdgePoint,
  mine: EdgePoint | undefined
) => {
  if (mine === undefined || (mine.x === point.x && mine.y === point.y)) {
    return 0;
  }

  const worse =
    edgeTier(box, other, point.out) - edgeTier(box, other, mine.out);

  return worse > 0 ? worse * unassignedCost : 0;
};

const priced = (
  ends: { readonly box: Box; readonly other: Box },
  points: readonly EdgePoint[],
  mine: EdgePoint | undefined
) =>
  Arr.map(points, (point) => ({
    ...point,
    cost: point.cost + assignedPrice(ends, point, mine),
  }));

/** The points a route may start at, its assigned one cheapest. */
const startsOf = (search: Search, box: Box, other: Box) =>
  priced(
    { box, other },
    edgePoints(box, other),
    box === search.from ? search.start : undefined
  );

/** The points a route may end at, its assigned one cheapest. */
const finishesOf = (search: Search, box: Box, other: Box, backCost = 0) =>
  priced(
    { box, other },
    edgePoints(box, other, backCost),
    box === search.to ? search.finish : undefined
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
  { from, to, window, start, finish }: RouteEnds
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
  start,
  finish,
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
      const cell = cellOf(search.grid, state);

      const turn =
        heading === opposite(stub.edge.out)
          ? 0
          : bendCost +
            strayOf(search, cell) +
            (search.usage.points.has(pointIndex(search.grid, cell))
              ? shareCost
              : 0);

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
 * The cheapest straight leg from `from`'s edge to a facing point on `to`'s
 * edge, when the two face each other across a gap no wider than a stub:
 * there the search's stubs would overlap, so it's found directly.
 */
const straightAcross = (
  search: Search,
  { from, to }: { readonly from: Box; readonly to: Box }
): readonly Cell[] | undefined => {
  const targets = new Map(
    Arr.map(finishesOf(search, to, from), (edge) => [
      `${edge.x},${edge.y},${edge.out}`,
      edge,
    ])
  );

  const straight = Arr.flatMap(stubsOf(search, from, to), (stub) => {
    const end = targets.get(
      `${stub.tip.x},${stub.tip.y},${opposite(stub.edge.out)}`
    );

    return end === undefined ? [] : [{ stub, cost: stub.cost + end.cost }];
  });

  if (!Arr.isReadonlyArrayNonEmpty(straight)) {
    return undefined;
  }

  const { stub } = Arr.min(
    straight,
    Order.mapInput(Order.Number, ({ cost }: (typeof straight)[number]) => cost)
  );

  return [{ x: stub.edge.x, y: stub.edge.y }, stub.tip];
};

/**
 * What `points`, a route's corners in half units, costs against the routes
 * recorded now: each step as the search would price it, the first and last
 * legs as stubs, plus what its two ends cost.
 */
const pricePath = (
  grid: Grid,
  pair: { readonly usage: Usage; readonly key: string },
  ends: RouteEnds,
  points: readonly Cell[]
) => {
  const search = searchOf(grid, pair, ends);
  const first = points[0];
  const last = points.at(-1);
  const legs = points.length - 1;
  let total = 0;
  let heading = noDirection;

  for (let index = 0; index < legs; index++) {
    const start = points[index];
    const end = points[index + 1];

    if (start === undefined || end === undefined) {
      continue;
    }

    const direction = directionOf(start, end);
    const count = Math.abs(end.x - start.x) + Math.abs(end.y - start.y);
    const stub = index === 0 || index === legs - 1;

    for (let step = 0; step < count; step++) {
      const price = stepPrice(
        search,
        {
          from: stepFrom(start, direction, step),
          heading: heading === noDirection ? direction : heading,
          stub,
        },
        direction
      );

      total += price ?? Number.POSITIVE_INFINITY;
      heading = direction;
    }
  }

  const endCost = (cell: Cell | undefined, points: readonly EdgePoint[]) =>
    cell === undefined
      ? 0
      : Math.min(
          Number.POSITIVE_INFINITY,
          ...Arr.flatMap(points, (point) =>
            point.x === cell.x && point.y === cell.y ? [point.cost] : []
          )
        );

  return (
    total +
    endCost(first, startsOf(search, ends.from, ends.to)) +
    endCost(last, finishesOf(search, ends.to, ends.from, backEndCost))
  );
};

/** A route a search found, and what it cost. */
interface Found {
  readonly points: readonly Cell[];
  readonly cost: number;
}

/**
 * The cheapest route from `from`'s edge to `to`'s edge, by A* over the
 * half-unit grid with a cost for each bend. Each end runs straight out of
 * its box for a stub before it may turn. Running under a box costs more
 * than any clear route, so the route runs under the fewest boxes it can.
 */
const searchRoute = (
  grid: Grid,
  pair: { readonly usage: Usage; readonly key: string },
  ends: RouteEnds
): Found => {
  const search = searchOf(grid, pair, ends);
  const across = straightAcross(search, ends);

  if (across !== undefined) {
    return { points: across, cost: 0 };
  }

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

  return best === undefined
    ? { points: [], cost: Number.POSITIVE_INFINITY }
    : { points: routeOf(grid, frontier, best), cost: best.cost };
};

/**
 * An end on an edge a tier worse than the one assigned to it. Above any
 * detour, below `shareCost`: a route takes a worse edge rather than share
 * a point.
 */
const unassignedCost = 5e5;


/** How many times clashing routes are routed again around the others. */
const reroutePasses = 3;

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
 * `windowMargin`. The shorter of the two is kept, unless only the shorter
 * one touches an outline or another route, or runs under a box.
 */
const cappedRoute = (
  grid: Grid,
  pair: { readonly usage: Usage; readonly key: string },
  ends: Omit<RouteEnds, "window">
): Found => {
  const { from, to } = ends;
  const free = searchRoute(grid, pair, { ...ends, window: undefined });

  if (free.points.length === 0 || withinCap(free.points)) {
    return free;
  }

  const tight = searchRoute(grid, pair, {
    ...ends,
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

  // A shorter route that only fits by touching an outline or another
  // route, or running under a box, reads worse than a long clear one.
  const shorter =
    tight.points.length > 0 &&
    lengthOfCells(tight.points).length < lengthOfCells(free.points).length;

  const clashes = (found: Found) => found.cost >= touchCost;

  return shorter && (clashes(free) || !clashes(tight)) ? tight : free;
};

/**
 * Routes every hop whose ends both have a placement. A hop with a route
 * override in `layout.routes` follows it as given. Every other hop gets a
 * route at right angles on the half-unit grid, from the edge of one
 * footprint to the edge of the other, going around every footprint
 * whenever a clear route exists.
 *
 * A route costs its length, a fixed cost per bend, more for each bend
 * outside the screen area its two boxes span, and a little for each bend's
 * distance from the line between them, so routes stay between their boxes
 * as the reader sees them. Each end leaves or enters by an edge facing the
 * other end unless something blocks it, and runs straight out of its box
 * for at least a half unit. Routes keep out of name tags and other groups'
 * zones when they can, stay inside the zones' bounds plus a margin, and
 * hops sharing a structure avoid crossing each other. A route longer than
 * `routeCap` allows is searched again close to its ends.
 *
 * Hops between the same two structures, in either direction, never share a
 * step, so they run side by side. Overrides go first, then the longest
 * hops, then data.mjs order for ties, and the same map always gives the
 * same routes. A hop from a structure to itself gets no route.
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
      points: new Map(),
      axes: new Map(),
      pairs: new Map(),
    };

    const routes: Record<string, HopRoute> = {};

    /** Each routed hop's points in half units, and what its search cost. */
    const found = new Map<string, Found>();

    const automaticHops = Arr.filter(
      data.hops,
      (hop) =>
        !Rec.has(overrides, hop.id) &&
        hop.from !== hop.to &&
        byId.has(hop.from) &&
        byId.has(hop.to)
    );

    const spanOf = (a: Box, b: Box) =>
      Math.abs(a.x0 + a.x1 - b.x0 - b.x1) + Math.abs(a.y0 + a.y1 - b.y0 - b.y1);

    // Every end gets its own point on its box before any route is searched.
    // A point is usable when it's clear of route overrides and its stub, a
    // unit straight out, runs clear of name tags and other boxes.
    const overrideCells = new Set(
      Arr.map(overridePoints, (point) => pointIndex(grid, point))
    );

    const usable = (point: EdgePoint) =>
      !overrideCells.has(pointIndex(grid, point)) &&
      Arr.every([0, 1], (count) => {
        const from = stepFrom(point, point.out, count);
        const step = stepKey(grid, from, point.out);

        return (
          inside(grid, stepFrom(from, point.out)) &&
          (grid.inTags[step] ?? []).length === 0 &&
          (grid.touches[step] ?? []).length <= (count === 0 ? 1 : 0)
        );
      });
    const ends = assignEnds(
      Arr.flatMap(automaticHops, (hop) => {
        const from = byId.get(hop.from);
        const to = byId.get(hop.to);

        return from === undefined || to === undefined
          ? []
          : [
              {
                key: `${hop.id}:from`,
                box: from,
                other: to,
                span: spanOf(from, to),
              },
              {
                key: `${hop.id}:to`,
                box: to,
                other: from,
                span: spanOf(from, to),
              },
            ];
      }),
      usable
    );

    const endsOf = (hop: Hop) => ({
      start: ends.get(`${hop.id}:from`),
      finish: ends.get(`${hop.id}:to`),
    });

    const recordAll = (except: string) => {
      usage.steps.clear();
      usage.points.clear();
      usage.axes.clear();
      usage.pairs.clear();

      for (const hop of data.hops) {
        const points = found.get(hop.id)?.points;

        if (hop.id !== except && points !== undefined) {
          record(
            grid,
            { usage, key: pairKey(hop.from, hop.to), ends: [hop.from, hop.to] },
            points
          );
        }
      }
    };

    const keep = (hop: Hop, result: Found) => {
      const from = byId.get(hop.from);
      const to = byId.get(hop.to);
      const override = overrides[hop.id];

      if (from === undefined || to === undefined) {
        return;
      }

      found.set(hop.id, result);

      const points =
        override ??
        Arr.map(result.points, (point) => ({
          x: point.x / scale,
          y: point.y / scale,
        }));

      const { length, distance } = routeLength(points);

      routes[hop.id] = {
        points,
        crosses: crossesOf(boxes, new Set([hop.from, hop.to]), result.points),
        overridden: override !== undefined,
        tooLong: length > routeCap(distance),
      };
    };

    const routeOne = (hop: Hop) => {
      const from = byId.get(hop.from);
      const to = byId.get(hop.to);

      if (from === undefined || to === undefined || hop.from === hop.to) {
        return;
      }

      const key = pairKey(hop.from, hop.to);
      const override = overrides[hop.id];

      const result =
        override === undefined
          ? cappedRoute(grid, { usage, key }, { from, to, ...endsOf(hop) })
          : { points: Arr.map(override, toHalfUnits), cost: 0 };

      if (result.points.length === 0) {
        return;
      }

      record(grid, { usage, key, ends: [hop.from, hop.to] }, result.points);
      keep(hop, result);
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

    // Hops whose ends face each other by one edge each have the fewest
    // edge points to choose from, so they go before diagonal ones.
    const facingCount = (hop: Hop) => {
      const from = byId.get(hop.from);
      const to = byId.get(hop.to);

      return from === undefined || to === undefined
        ? 0
        : Arr.filter(
            facingEdges(placementOf(from), placementOf(to)),
            (faces) => faces
          ).length;
    };

    const automatic = Arr.sort(
      Arr.filter(data.hops, (hop) => !Rec.has(overrides, hop.id)),
      Order.combine(
        Order.mapInput(Order.Number, facingCount),
        Order.mapInput(Order.Number, span)
      )
    );

    for (const hop of automatic) {
      routeOne(hop);
    }

    // A route placed early can take the only clear way for one placed
    // later. So every route is routed again around all the others, and
    // takes the new route when it costs less than its own does now, until
    // a pass improves nothing or `reroutePasses` run out.
    for (let pass = 0; pass < reroutePasses; pass++) {
      let improved = false;

      for (const hop of automatic) {
        const before = found.get(hop.id);
        const from = byId.get(hop.from);
        const to = byId.get(hop.to);

        if (before !== undefined && from !== undefined && to !== undefined) {
          recordAll(hop.id);

          const pair = { usage, key: pairKey(hop.from, hop.to) };
          const ends = { from, to, window: undefined, ...endsOf(hop) };
          const now = pricePath(grid, pair, ends, before.points);
          const after =
            now >= touchCost ? cappedRoute(grid, pair, ends) : undefined;

          if (
            after !== undefined &&
            after.points.length > 0 &&
            after.cost < now - 1e-6
          ) {
            keep(hop, after);
            improved = true;
          } else {
            found.set(hop.id, { points: before.points, cost: now });
          }
        }
      }

      if (!improved) {
        break;
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

/** What `routeRevealed` routes. */
interface RevealedSource {
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
