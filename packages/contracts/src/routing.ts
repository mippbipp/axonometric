import { Array as Arr, Option, Order, Record as Rec } from "effect";
import { dual } from "effect/Function";

import { fitsEdge } from "./ends.ts";
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
 * Running alongside the route of a hop that shares a structure with this
 * one costs this much more per step. Such hops form a bundle, which the
 * scene draws as parallel lines, so sharing a trunk is cheap.
 */
const sharedStepCost = 1;

/**
 * Running alongside or touching the route of a hop that shares no
 * structure with this one, per step. A short detour beats it, an extra
 * bend doesn't.
 */
const strangerStepCost = 20;

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
   * An edge facing away, a side edge. It must outweigh two bends, the
   * detour round to a facing edge, so a route takes it only when every
   * facing edge is blocked or full.
   */
  facingAway: 600,
  /**
   * An edge facing away that is the far side of a facing edge, the back
   * edge: a little more than a side edge, so a full facing edge spills to
   * the sides first, then the back.
   */
  facingBack: 100,
  /**
   * Taking an edge with no room left for another end at the spacing the
   * scene needs. It must outweigh `facingAway` and `facingBack`, so an end
   * leaves a full facing edge for a side edge, then the back edge, and
   * never crowds into a full one.
   */
  full: 800,
  /**
   * An end on a back edge (-x or -y), which the Iso view hides behind the
   * box itself. It only breaks ties between edges the facing, side, back
   * order already allows, so it stays well under the gap between those.
   */
  hidden: 40,
  /**
   * Each end already on an edge, so ends spread over the facing edges
   * before one fills and a later end has to take another.
   */
  perEnd: 6,
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
const zoneStepCost = 100;

/**
 * Each step that lies on a zone's outline. Like a name tag, it must outweigh
 * any detour, so a route lies on a zone's outline only when nothing else
 * gets through; crossing the outline at a right angle costs nothing.
 */
const zoneLineCost = 1e4;

/**
 * Each step onto a box's corner. A route through a corner reads as part of
 * the box's outline, so it costs as much as a name tag.
 */
const cornerCost = 1e4;

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
  /** Like `touches`, for steps that lie on a zone's outline. */
  readonly onZoneLines: readonly (readonly number[] | undefined)[];
  /** The points on a box's corner, by point index. */
  readonly corners: ReadonlySet<number>;
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
  const onZoneLines: (number[] | undefined)[] = [];

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

  // A step lies on a zone's outline when it runs along one of its edges.
  Arr.forEach(zones, (zone, zoneIndex) => {
    for (let x = zone.x0; x < zone.x1; x++) {
      push(onZoneLines, keyOf(x, zone.y0, 0), zoneIndex);
      push(onZoneLines, keyOf(x, zone.y1, 0), zoneIndex);
    }

    for (let y = zone.y0; y < zone.y1; y++) {
      push(onZoneLines, keyOf(zone.x0, y, 1), zoneIndex);
      push(onZoneLines, keyOf(zone.x1, y, 1), zoneIndex);
    }
  });

  const corners = new Set(
    Arr.flatMap(boxes, (box) =>
      Arr.map(
        [
          [box.x0, box.y0],
          [box.x1, box.y0],
          [box.x0, box.y1],
          [box.x1, box.y1],
        ] as const,
        ([x, y]) => (y - top) * width + (x - left)
      )
    )
  );

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
    onZoneLines,
    corners,
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
      return (
        edgeCosts.facingAway +
        (faces[(edge + 2) % 4] === true ? edgeCosts.facingBack : 0)
      );
    }

    return ranked.indexOf(edge) === 0 ? 0 : edgeCosts.facingAside;
  };

  return Arr.map(Arr.range(0, 3), costOf);
};

const edgeKey = (id: string, out: number) => `${id}:${out}`;

/** Whether an end is a line's start or its arrowhead. */
type EndKind = "heads" | "starts";

/**
 * What using an edge as one more end costs: `edgeCosts.full` when the ends
 * on it already leave no room for one more at the spacing the scene draws
 * them, so the end spills to the next edge instead.
 */
const crowded = (usage: Usage, box: Box, kind: EndKind) => (out: number) => {
  const placed = usage.edgeEnds.get(edgeKey(box.id, out)) ?? {
    heads: 0,
    starts: 0,
  };

  const length = (alongXAxis(out) ? box.y1 - box.y0 : box.x1 - box.x0) / scale;

  const fits = fitsEdge(length, { ...placed, [kind]: placed[kind] + 1 });

  return (
    (fits ? 0 : edgeCosts.full) +
    edgeCosts.perEnd * (placed.heads + placed.starts)
  );
};

/** What `edgePoints` adds to an edge's cost. */
interface EdgeOptions {
  /** More cost for entering by a back edge (-x or -y). */
  readonly backCost?: number;
  /** More cost for using the edge in a direction out of the box. */
  readonly extra?: (out: number) => number;
}

/**
 * The half-unit points along an edge from `start` to `end` a route may
 * start or end at: every one at least a half unit from both corners, or
 * every one, corners included, on an edge shorter than a unit or when
 * `corners` allows them.
 */
const alongEdge = (start: number, end: number, corners: boolean) =>
  end - start >= 2 && !corners
    ? Arr.range(start + 1, end - 1)
    : Arr.range(start, end);

/** Whether two footprints share ground, as `check` warns they mustn't. */
const overlapping = (a: Box, b: Box) =>
  a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/**
 * The points on a footprint's edge a route may start or end at, kept off
 * the corners where the edge is long enough, unless the two footprints
 * overlap and so leave too few points outside each other. Each comes with what it costs to use it: the edge's
 * facing cost towards `other`, `backCost` more on a back edge (-x or -y),
 * and a little for points away from the middle of their edge, so a lone
 * route leaves from the middle.
 */
const edgePoints = (
  box: Box,
  other: Box,
  { backCost = 0, extra = () => 0 }: EdgeOptions = {}
): readonly EdgePoint[] => {
  const midX = (box.x0 + box.x1) / 2;
  const midY = (box.y0 + box.y1) / 2;
  const facing = facingOf(box, other);
  const corners = overlapping(box, other);

  const costOf = (out: number) =>
    (facing[out] ?? 0) +
    (out === minusX || out === minusY ? backCost + edgeCosts.hidden : 0) +
    extra(out);

  return [
    ...Arr.map(alongEdge(box.x0, box.x1, corners), (x) => ({
      x,
      y: box.y1,
      out: plusY,
      cost: costOf(plusY) + offCentreCost * Math.abs(x - midX),
    })),
    ...Arr.map(alongEdge(box.y0, box.y1, corners), (y) => ({
      x: box.x1,
      y,
      out: plusX,
      cost: costOf(plusX) + offCentreCost * Math.abs(y - midY),
    })),
    ...Arr.map(alongEdge(box.x0, box.x1, corners), (x) => ({
      x,
      y: box.y0,
      out: minusY,
      cost: costOf(minusY) + offCentreCost * Math.abs(x - midX),
    })),
    ...Arr.map(alongEdge(box.y0, box.y1, corners), (y) => ({
      x: box.x0,
      y,
      out: minusX,
      cost: costOf(minusX) + offCentreCost * Math.abs(y - midY),
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
  /**
   * Every route so far: its two structures, its steps, and the axes its
   * legs run along at each point it passes, 3 at its ends and bends.
   */
  /**
   * How many arrowheads and line starts the routes so far put on each
   * structure's edge, keyed by structure and the direction out of the edge.
   */
  readonly edgeEnds: Map<string, { heads: number; starts: number }>;
  readonly routes: {
    readonly ends: readonly string[];
    readonly steps: ReadonlySet<number>;
    readonly points: ReadonlyMap<number, number>;
  }[];
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

/** Counts a route's end on a structure's edge. */
const countEnd = (
  usage: Usage,
  {
    id,
    out,
    kind,
  }: { readonly id: string; readonly out: number; readonly kind: EndKind },
  by = 1
) => {
  const key = edgeKey(id, out);
  const placed = usage.edgeEnds.get(key) ?? { heads: 0, starts: 0 };

  usage.edgeEnds.set(key, { ...placed, [kind]: placed[kind] + by });
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
  const steps = new Set<number>();
  const passes = new Map<number, number>();

  Arr.forEach(cornersOf(points), (point) => {
    passes.set(pointIndex(grid, point), 3);
  });

  for (const { a, b } of stepsAlong(points)) {
    const step = stepKey(grid, a, directionOf(a, b));
    const axis = alongXAxis(directionOf(a, b)) ? 1 : 2;

    for (const map of maps) {
      for (const point of [pointIndex(grid, a), pointIndex(grid, b)]) {
        map.set(point, (map.get(point) ?? 0) | axis);
      }
    }

    usage.steps.add(step);
    steps.add(step);

    for (const point of [pointIndex(grid, a), pointIndex(grid, b)]) {
      passes.set(point, (passes.get(point) ?? 0) | axis);
    }

    pair.steps.add(step);
    pair.points.add(pointIndex(grid, a));
    pair.points.add(pointIndex(grid, b));
  }

  const corners = cornersOf(points);
  const [first, second] = corners;
  const last = corners.at(-1);
  const before = corners.at(-2);

  if (first !== undefined && second !== undefined) {
    countEnd(usage, {
      id: ends[0] ?? "",
      out: directionOf(first, second),
      kind: "starts",
    });
  }

  if (last !== undefined && before !== undefined) {
    countEnd(usage, {
      id: ends[1] ?? "",
      out: directionOf(last, before),
      kind: "heads",
    });
  }

  usage.routes.push({ ends, steps, points: passes });
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
  /**
   * The steps and points of routes that share neither of this hop's
   * structures, which it must keep off except to cross them squarely.
   */
  readonly strangers: {
    readonly steps: ReadonlySet<number>;
    readonly points: ReadonlyMap<number, number>;
  };
  /**
   * Whether the hop's two footprints overlap, which leaves too little room
   * outside both to keep its route off their corners and their zone's
   * outline. `check` warns about the overlap instead.
   */
  readonly cornersFree: boolean;
  /** Whether the strangers' steps and points are barred, not just dear. */
  readonly apart: boolean;
  /**
   * When set, steps outside this box aren't allowed at all, and bends cost
   * nothing for straying from the route's area: the search is after a route
   * short enough for `routeCap`, wherever it bends.
   */
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

  const reverse = heading !== noDirection && opposite(heading) === direction;

  const outside =
    search.window !== undefined && distanceTo(search.window, next) > 0;

  // Over the cap, a hop may share a step with a hop between the same two
  // structures: the scene still draws the two as separate lines.
  const pairStep = search.pair.steps.has(step);

  if (
    !inside(grid, next) ||
    outside ||
    (pairStep && search.window === undefined) ||
    ownEnd ||
    reverse ||
    (search.apart &&
      (search.strangers.steps.has(step) ||
        ((search.strangers.points.get(pointIndex(grid, next)) ?? 0) &
          (alongXAxis(direction) ? 1 : 2)) !==
          0))
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

  return (
    stepCost +
    bend +
    outlinePrice(search, { step, next: nextIndex, direction }) +
    touched.length * crossCost +
    zones * zoneStepCost +
    crossings * siblingCrossCost +
    (grid.inTags[step] ?? []).length * tagCost +
    (search.usage.steps.has(step) ? sharedStepCost : 0) +
    // Over the cap, the pair's points cost no more than any shared step.
    (search.pair.points.has(nextIndex) && search.window === undefined
      ? pairPointCost
      : 0)
  );
};

/**
 * What a step costs for running along or onto something it should keep off:
 * the route of a hop that shares no structure with this one, a zone's
 * outline, or a box's corner. Between overlapping footprints only the
 * first counts.
 */
const outlinePrice = (
  { grid, strangers, cornersFree }: Search,
  {
    step,
    next,
    direction,
  }: {
    readonly step: number;
    readonly next: number;
    readonly direction: number;
  }
) => {
  const stranger =
    strangers.steps.has(step) ||
    ((strangers.points.get(next) ?? 0) & (alongXAxis(direction) ? 1 : 2)) !== 0;

  return (
    (stranger ? strangerStepCost : 0) +
    (cornersFree
      ? 0
      : (grid.onZoneLines[step] ?? []).length * zoneLineCost +
        (grid.corners.has(next) ? cornerCost : 0))
  );
};

/** What a bend at `cell` costs for sitting outside the route's area. */
const strayOf = (search: Search, cell: Cell) => {
  if (search.window !== undefined) {
    return 0;
  }

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
  Arr.flatMap(
    edgePoints(box, other, { extra: crowded(search.usage, box, "starts") }),
    (edge) =>
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

/**
 * Every stub into `box`, for a route's end: from each edge point, straight
 * out for each of `stubLengths`, priced for the run back in towards the
 * edge, with what the edge point costs (back edges `backEndCost` more).
 */
const inwardStubsOf = (search: Search, box: Box, other: Box): readonly Stub[] =>
  Arr.flatMap(
    edgePoints(box, other, {
      backCost: backEndCost,
      extra: crowded(search.usage, box, "heads"),
    }),
    (edge) =>
      Arr.flatMap(stubLengths, (count, index) => {
        const tip = stepFrom(edge, edge.out, count);

        const price = runPrice(search, tip, {
          direction: opposite(edge.out),
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

/**
 * How far from a structure two hops share, in half units, their routes may
 * run together without being strangers: a bundle's trunk, with the jogs
 * that spread its ends along the edge. Past it they must keep apart.
 */
const trunkReach = 16;

/**
 * The steps and points of the routes the hop between `ends` must keep off:
 * those of routes that share none of its structures, and those of routes
 * that share one, beyond `trunkReach` of it.
 */
const strangersOf = (grid: Grid, usage: Usage, ends: readonly Box[]) => {
  const steps = new Set<number>();
  const points = new Map<number, number>();

  const near = (route: Usage["routes"][number], point: number) => {
    const cell = cellOf(grid, point * directions);

    return Arr.some(
      ends,
      (box) =>
        route.ends.includes(box.id) && distanceTo(box, cell) <= trunkReach
    );
  };

  for (const route of usage.routes) {
    for (const step of route.steps) {
      if (!near(route, Math.floor(step / 2))) {
        steps.add(step);
      }
    }

    for (const [point, axes] of route.points) {
      if (!near(route, point)) {
        points.set(point, (points.get(point) ?? 0) | axes);
      }
    }
  }

  return { steps, points };
};

const searchOf = (
  grid: Grid,
  { usage, key }: { readonly usage: Usage; readonly key: string },
  {
    from,
    to,
    window,
    apart = false,
  }: {
    readonly from: Box;
    readonly to: Box;
    readonly window: Box | undefined;
    readonly apart?: boolean;
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
  strangers: strangersOf(grid, usage, [from, to]),
  cornersFree: overlapping(from, to),
  apart,
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
        heading === opposite(stub.edge.out)
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
 * The cheapest straight leg from `from`'s edge to a facing point on `to`'s
 * edge, when the two face each other across a gap no wider than a stub:
 * there the search's stubs would overlap, so it's found directly.
 */
const straightAcross = (
  search: Search,
  { from, to }: { readonly from: Box; readonly to: Box }
): readonly Cell[] | undefined => {
  const entries = edgePoints(to, from, {
    extra: crowded(search.usage, to, "heads"),
  });

  const targets = new Map(
    Arr.map(entries, (edge) => [`${edge.x},${edge.y},${edge.out}`, edge])
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
    readonly apart?: boolean;
  }
): readonly Cell[] => {
  const search = searchOf(grid, pair, ends);
  const across = straightAcross(search, ends);

  if (across !== undefined) {
    return across;
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

/** How far a bend may sit outside a route's area before it counts as stray. */
const strayLimit = 3;

// WIP: with the guards on, a route that avoids strangers must be as good as
// the one it replaces, which leaves 11 shared pairs in chapter 8. Off, only a
// bend allowance applies: 0 shared pairs, but five scene tests fail.
const guarded = false;

/**
 * The fewest bends any route between two footprints needs with nothing in
 * the way: 1 when they're apart on both axes, 0 when a straight leg fits
 * between them, and 2 otherwise.
 */
const fewestBends = (from: Box, to: Box) => {
  const apartX = from.x1 <= to.x0 || to.x1 <= from.x0;
  const apartY = from.y1 <= to.y0 || to.y1 <= from.y0;

  const overlap = (a0: number, a1: number, b0: number, b1: number) =>
    Math.min(a1, b1) - Math.max(a0, b0) >= scale;

  if (apartX && apartY) {
    return 1;
  }

  return (apartX && overlap(from.y0, from.y1, to.y0, to.y1)) ||
    (apartY && overlap(from.x0, from.x1, to.x0, to.x1))
    ? 0
    : 2;
};

/** What a route is judged on besides sharing, to compare two for one hop. */
const qualityOf = (
  grid: Grid,
  { from, to }: { readonly from: Box; readonly to: Box },
  cells: readonly Cell[]
) => {
  const corners = cornersOf(cells);
  const area = routeArea(from, to);
  const [first, second] = corners;
  const last = corners.at(-1);
  const before = corners.at(-2);

  const faces = (box: Box, other: Box, out: number) =>
    facingEdges(placementOf(box), placementOf(other))[out] === true;

  return {
    bends: Math.max(0, corners.length - 2),
    awayEnds:
      (first !== undefined &&
      second !== undefined &&
      !faces(from, to, directionOf(first, second))
        ? 1
        : 0) +
      (last !== undefined &&
      before !== undefined &&
      !faces(to, from, directionOf(last, before))
        ? 1
        : 0),
    tagSteps: Arr.reduce(
      stepsAlong(cells),
      0,
      (sum, { a, b }) =>
        sum + (grid.inTags[stepKey(grid, a, directionOf(a, b))] ?? []).length
    ),
    stray: Math.max(
      0,
      ...Arr.map(corners.slice(1, -1), (corner) =>
        outsideArea(area, project({ x: corner.x / scale, y: corner.y / scale }))
      )
    ),
  };
};

/**
 * Whether a route that keeps off strangers is as good a route as the one
 * it would replace: no more bends than the hop needs plus one, or than the
 * old route had, and leaving by no worse edges, crossing no more name tags
 * and straying no further than the old route or `strayLimit`.
 */
const asGood = (
  grid: Grid,
  ends: { readonly from: Box; readonly to: Box },
  {
    next,
    old,
    slack,
  }: {
    readonly next: readonly Cell[];
    readonly old: readonly Cell[];
    readonly slack: number;
  }
) => {
  const after = qualityOf(grid, ends, next);
  const before = qualityOf(grid, ends, old);

  if (!guarded) {
    return after.bends <= before.bends + slack;
  }

  return (
    after.bends <=
      Math.max(fewestBends(ends.from, ends.to) + 1, before.bends) &&
    after.awayEnds <= before.awayEnds &&
    after.tagSteps <= before.tagSteps &&
    (after.stray <= strayLimit || after.stray <= before.stray)
  );
};

/**
 * How many more grid units of length a route that keeps off strangers'
 * routes may have than the cheapest route, which may share them.
 */
const apartLength = 20;

/**
 * The cheapest route that keeps clear of strangers' routes, if it doesn't
 * cost much more, else the cheapest route; unless that is longer than
 * `routeCap` allows. Then the route is searched again inside the box around both ends, grown by
 * `windowMargin`, which may mean running under a box; the shorter of the
 * two is kept.
 */
const cappedRoute = (
  grid: Grid,
  pair: { readonly usage: Usage; readonly key: string },
  { from, to }: { readonly from: Box; readonly to: Box }
): readonly Cell[] => {
  const soft = searchRoute(grid, pair, { from, to, window: undefined });

  // First try a route that keeps off every stranger's steps; it wins unless
  // it needs much more than the cheapest route.
  const clear = searchRoute(grid, pair, {
    from,
    to,
    window: undefined,
    apart: true,
  });

  const free =
    clear.length > 0 &&
    withinCap(clear) &&
    asGood(grid, { from, to }, { next: clear, old: soft, slack: 1 }) &&
    lengthOfCells(clear).length <= lengthOfCells(soft).length + apartLength
      ? clear
      : soft;

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

/** A routed hop as the track pass sees it. */
interface Laid {
  readonly hop: Hop;
  /** The route's ends and bends, in half units. */
  readonly corners: readonly Cell[];
  /** Every half-unit point the route passes, in order. */
  readonly cells: readonly Cell[];
  /** For each point, its index in `cells` and the axes the route runs along there. */
  readonly points: ReadonlyMap<
    number,
    { readonly at: number; readonly axes: number }
  >;
  /** Each end's structure and the direction it leaves or enters by. */
  readonly edges: readonly [string, string];
}

const laidOf = (grid: Grid, hop: Hop, corners: readonly Cell[]): Laid => {
  const [first] = corners;

  const cells =
    first === undefined
      ? []
      : [first, ...Arr.map(stepsAlong(corners), ({ b }) => b)];

  const points = new Map<number, { at: number; axes: number }>();

  Arr.forEach(cells, (cell, at) => {
    const before = cells[at - 1];
    const after = cells[at + 1];

    const axes =
      before === undefined ||
      after === undefined ||
      (before.x === cell.x) !== (cell.x === after.x)
        ? 3
        : before.y === cell.y
          ? 1
          : 2;

    points.set(pointIndex(grid, cell), { at, axes });
  });

  const second = corners[1];
  const last = corners.at(-1);
  const before = corners.at(-2);

  return {
    hop,
    corners,
    cells,
    points,
    edges: [
      `${hop.from}:${first === undefined || second === undefined ? "" : directionOf(first, second)}`,
      `${hop.to}:${last === undefined || before === undefined ? "" : directionOf(last, before)}`,
    ],
  };
};

/**
 * How far along a route from the structure it shares with another hop,
 * leaving it by the same edge, the two may first meet and still be a bundle,
 * in half units: far enough to take in the jogs that spread their ends.
 */
const approachReach = 8;

/**
 * Whether two routes may share the points at `mine` in `p` (and the same
 * points in `q`) as a bundle: they leave or enter one structure by the same
 * edge, and the points are one stretch of both that starts near that end.
 */
const bundled = (p: Laid, q: Laid, mine: readonly number[]) => {
  const sorted = Arr.sort(mine, Order.Number);
  const first = sorted[0] ?? 0;
  const last = sorted.at(-1) ?? 0;

  const theirs = Arr.sort(
    Arr.map(sorted, (at) => {
      const cell = p.cells[at];

      return cell === undefined
        ? -1
        : q.cells.findIndex((c) => c.x === cell.x && c.y === cell.y);
    }),
    Order.Number
  );

  const qFirst = theirs[0] ?? 0;
  const qLast = theirs.at(-1) ?? 0;

  const run = (indexes: readonly number[]) =>
    (indexes.at(-1) ?? 0) - (indexes[0] ?? 0) + 1 === indexes.length;

  if (!run(sorted) || !run(theirs)) {
    return false;
  }

  return Arr.some([0, 1] as const, (mineEnd) =>
    Arr.some([0, 1] as const, (theirEnd) => {
      const same =
        p.edges[mineEnd] === q.edges[theirEnd] &&
        p.edges[mineEnd] !== undefined;

      const approach = mineEnd === 0 ? first : p.cells.length - 1 - last;
      const theirApproach =
        theirEnd === 0 ? qFirst : q.cells.length - 1 - qLast;

      return (
        same && approach <= approachReach && theirApproach <= approachReach
      );
    })
  );
};

/** How many times the hops that share with strangers are routed again. */
const ripUpRounds = 2;

/** How many hops are routed again in a round: the ones that share most. */
const ripUpHops = 6;

const samePair = (p: Hop, q: Hop) =>
  pairKey(p.from, p.to) === pairKey(q.from, q.to);

/** The routes so far, by the points they pass. */
type Occupancy = Map<number, { readonly laid: Laid; readonly axes: number }[]>;

const occupy = (occupancy: Occupancy, laid: Laid) => {
  for (const [point, { axes }] of laid.points) {
    const list = occupancy.get(point) ?? [];

    list.push({ laid, axes });
    occupancy.set(point, list);
  }
};

const vacate = (occupancy: Occupancy, laid: Laid) => {
  for (const point of laid.points.keys()) {
    const list = occupancy.get(point);

    if (list !== undefined) {
      occupancy.set(
        point,
        Arr.filter(list, (entry) => entry.laid !== laid)
      );
    }
  }
};

/**
 * How many points `p` shares with other routes that it mustn't: those where
 * the axes meet, other than a bundle's. Crossing squarely shares nothing.
 */
const clashes = (occupancy: Occupancy, p: Laid) => {
  const shared = new Map<Laid, number[]>();

  for (const [point, { at, axes }] of p.points) {
    for (const entry of occupancy.get(point) ?? []) {
      if (entry.laid.hop.id !== p.hop.id && (entry.axes & axes) !== 0) {
        shared.set(entry.laid, [...(shared.get(entry.laid) ?? []), at]);
      }
    }
  }

  let total = 0;

  for (const [q, mine] of shared) {
    total += !samePair(p.hop, q.hop) && bundled(p, q, mine) ? 0 : mine.length;
  }

  return total;
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

    const freshUsage = (): Usage => ({
      steps: new Set(),
      axes: new Map(),
      pairs: new Map(),
      routes: [],
      edgeEnds: new Map(),
    });

    const usage = freshUsage();

    const routes: Record<string, HopRoute> = {};
    const halves = new Map<string, readonly Cell[]>();

    // A hop with one edge facing the other end has no other good way out,
    // so its end keeps room on that edge, and hops with a choice take
    // another edge once it fills.
    const reserved = new Map<string, readonly [string, number, EndKind]>();

    for (const hop of data.hops) {
      const from = byId.get(hop.from);
      const to = byId.get(hop.to);

      if (from !== undefined && to !== undefined && hop.from !== hop.to) {
        for (const [end, box, other, kind] of [
          [`${hop.id}:from`, from, to, "starts"],
          [`${hop.id}:to`, to, from, "heads"],
        ] as const) {
          const faces = facingEdges(placementOf(box), placementOf(other));
          const only = faces.indexOf(true);

          if (Arr.filter(faces, Boolean).length === 1) {
            countEnd(usage, { id: box.id, out: only, kind });
            reserved.set(end, [box.id, only, kind]);
          }
        }
      }
    }

    const release = (hop: Hop) => {
      for (const end of [`${hop.id}:from`, `${hop.id}:to`]) {
        const held = reserved.get(end);

        if (held !== undefined) {
          countEnd(usage, { id: held[0], out: held[1], kind: held[2] }, -1);
          reserved.delete(end);
        }
      }
    };

    const routeFrom = (hop: Hop, halfUnits: readonly Cell[]): HopRoute => {
      const override = overrides[hop.id];

      const points =
        override ??
        Arr.map(halfUnits, (point) => ({
          x: point.x / scale,
          y: point.y / scale,
        }));

      const { length, distance } = routeLength(points);

      return {
        points,
        crosses: crossesOf(boxes, new Set([hop.from, hop.to]), halfUnits),
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

      release(hop);

      const key = pairKey(hop.from, hop.to);
      const override = overrides[hop.id];

      const halfUnits =
        override === undefined
          ? cappedRoute(grid, { usage, key }, { from, to })
          : Arr.map(override, toHalfUnits);

      if (halfUnits.length === 0) {
        return;
      }

      record(grid, { usage, key, ends: [hop.from, hop.to] }, halfUnits);
      halves.set(hop.id, halfUnits);

      routes[hop.id] = routeFrom(hop, halfUnits);
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

    // Each search above saw only the routes before it. A route that shares
    // points with a stranger's, beyond a bundle's trunk, is routed again
    // around everyone else's routes as they stand, and kept if it shares
    // less, stays within the cap and is `asGood`. Only
    // the `ripUpHops` that share most are tried, so a crowded map costs a
    // few more searches, not one per hop.
    const occupancy: Occupancy = new Map();
    const laid = new Map<string, Laid>();

    for (const hop of data.hops) {
      const cells = halves.get(hop.id);

      if (cells !== undefined) {
        const one = laidOf(grid, hop, cornersOf(cells));

        laid.set(hop.id, one);
        occupy(occupancy, one);
      }
    }

    const withoutHop = (hop: Hop) => {
      const others = freshUsage();

      for (const other of data.hops) {
        const cells = halves.get(other.id);

        if (other.id !== hop.id && cells !== undefined) {
          record(
            grid,
            {
              usage: others,
              key: pairKey(other.from, other.to),
              ends: [other.from, other.to],
            },
            cells
          );
        }
      }

      return others;
    };

    for (let round = 0; round < ripUpRounds; round++) {
      const crowded = Arr.take(
        Arr.sort(
          Arr.filter(
            Arr.flatMap(automatic, (hop) => {
              const mine = laid.get(hop.id);

              return mine === undefined
                ? []
                : [{ hop, shared: clashes(occupancy, mine) }];
            }),
            ({ shared }) => shared > 0
          ),
          Order.mapInput(
            Order.Number,
            ({ shared }: { readonly shared: number }) => -shared
          )
        ),
        ripUpHops
      );

      for (const { hop } of crowded) {
        const mine = laid.get(hop.id);
        const from = byId.get(hop.from);
        const to = byId.get(hop.to);

        if (mine !== undefined && from !== undefined && to !== undefined) {
          const next = searchRoute(
            grid,
            { usage: withoutHop(hop), key: pairKey(hop.from, hop.to) },
            { from, to, window: undefined, apart: true }
          );

          const candidate =
            next.length === 0 ? undefined : laidOf(grid, hop, cornersOf(next));

          if (
            candidate !== undefined &&
            withinCap(next) &&
            asGood(grid, { from, to }, { next, old: mine.cells, slack: 2 }) &&
            clashes(occupancy, candidate) < clashes(occupancy, mine)
          ) {
            vacate(occupancy, mine);
            occupy(occupancy, candidate);
            laid.set(hop.id, candidate);
            halves.set(hop.id, candidate.corners);
          }
        }
      }
    }

    for (const hop of automatic) {
      const cells = halves.get(hop.id);

      if (cells !== undefined) {
        routes[hop.id] = routeFrom(hop, cells);
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
