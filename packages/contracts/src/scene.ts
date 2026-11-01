import { Array as Arr, Option, Order, String as Str } from "effect";
import { dual } from "effect/Function";

import {
  boundsOfPoints,
  growRect,
  clipToConvex,
  convexOverlap,
  distanceToPolyline,
  lerp,
  rectPolygon,
  segmentCrosses,
  segmentLength,
  segmentsOf,
} from "./geometry.ts";
import type { Segment } from "./geometry.ts";
import { isoHeights } from "./iso-heights.ts";
import {
  boxOutline,
  corners,
  nameTagRect,
  nameTagText,
  project,
  tagCharWidth,
  tagPadding,
  gridOnScreen,
  tileHeight,
  tileWidth,
} from "./iso.ts";
import type { GridPosition, ScreenPoint, ScreenRect } from "./iso.ts";
import type { Layout, Placement } from "./layout.ts";
import type { Hop, MapData, Shape, Structure } from "./map-data.ts";
import { planRect, planTagSpots, projectPlan } from "./plan.ts";
import type { View } from "./plan.ts";
import { routeRevealed } from "./routing.ts";
import type { HopRoute } from "./routing.ts";
import { zonesOf } from "./zones.ts";
import type { Zone } from "./zones.ts";

// The scene: everything a view draws for one set of revealed structures, in
// screen space, for the iso view or Plan view. The editor draws from it, and
// `check` runs the same overlap test over both views, so the page and
// `check` can't disagree. The views differ only in their geometry: how the
// ground projects, each box's outline, where tags, chips and zone titles may
// go. Placing text in clear spots is shared.

/** Approximate width of one character of the code chip's font. */
const chipCharWidth = 6.4;

/** The code chip is this much wider than its text. */
const chipPadding = 8;

const chipHeight = 14;

/** Shapes with no flat top to hold the code chip. */
const chipless: ReadonlySet<Shape> = new Set(["person", "document"]);

/** How far past its footprint a shape may draw, in grid units. */
const overhang: Partial<Record<Shape, number>> = { external: 0.2 };

/** How far above its top an external shape's halo reaches. */
const haloLift = 4;

/** One structure as a view draws it. */
export interface SceneStructure {
  readonly structure: Structure;
  readonly placement: Placement;
  /**
   * The outline of everything the shape draws, as a convex polygon: in the
   * iso view its silhouette to its iso height, in Plan view its footprint's
   * rectangle, halo included.
   */
  readonly outline: readonly ScreenPoint[];
  readonly tag: ScreenRect;
  /** The code chip's box, or `undefined` when the top has no room for it. */
  readonly chip: ScreenRect | undefined;
}

/** Room around the code chip inside a box in Plan view. */
const planChipInset = 6;

/** Approximate width of one character of a zone title, tracking included. */
const titleCharWidth = 7.2;

/** How far the title's text reaches above and below its baseline. */
const titleAscent = 10;

const titleDescent = 3;

/** Clear space kept around a title. */
const titleMargin = 3;

/** How far apart the candidate title spots are, in screen units. */
const titleStep = 3;

/** The screen direction of a grid unit along x: the front-left edge. */
const alongX = {
  sx: tileWidth / 2 / gridOnScreen,
  sy: tileHeight / 2 / gridOnScreen,
};

/**
 * The screen direction up the front-right edge, from the front corner
 * towards the right corner: a grid unit along -y.
 */
const upFrontRight = {
  sx: tileWidth / 2 / gridOnScreen,
  sy: -tileHeight / 2 / gridOnScreen,
};

/** A zone as a view draws it. */
export interface SceneZone {
  readonly zone: Zone;
  /**
   * The plate's ground corners: in the iso view back, right, front and left;
   * in Plan view clockwise from the top left.
   */
  readonly plate: readonly ScreenPoint[];
  /**
   * Where the title's baseline starts, or `undefined` when no spot on the
   * plate is clear and the title is left out.
   */
  readonly titleAt: ScreenPoint | undefined;
  /** The title's outline on screen, skewed along the edge it lies on. */
  readonly title: readonly ScreenPoint[] | undefined;
  /** The SVG transform that skews the title's text onto its edge. */
  readonly titleTransform: string | undefined;
}

/** A stretch of a route that a box is drawn over. */
export interface HiddenStretch {
  readonly points: readonly ScreenPoint[];
  /** Whether the stretch runs to the route's end, so it needs the arrowhead. */
  readonly reachesEnd: boolean;
}

/** How tall a hop label's box is, in screen units. */
const labelHeight = 15;

/** Room either side of a label's text, in screen units. */
const labelPadding = 3;

/** One hop as a view draws it. */
export interface SceneHop {
  readonly hop: Hop;
  readonly route: HopRoute;
  /** The route on screen, from the source's edge to the target's edge. */
  readonly points: readonly ScreenPoint[];
  /**
   * Where the label goes, or `undefined` when no clear spot at the route
   * exists. A hop without a spot shows its label only on hover or while its
   * packet is selected, at `hoverLabel`.
   */
  readonly label: ScreenRect | undefined;
  /** Where the label shows on hover or when its packet is selected. */
  readonly hoverLabel: ScreenRect | undefined;
  /**
   * The stretches of the route that boxes are drawn over and that the view
   * redraws faintly on top: those under other structures' boxes, and the
   * last stretch under the target's box when the arrowhead is there.
   */
  readonly hidden: readonly HiddenStretch[];
}

/** Everything a view draws for one set of revealed structures. */
export interface Scene {
  readonly view: View;
  /** In painter's order: every box after the boxes it stands in front of. */
  readonly structures: readonly SceneStructure[];
  readonly zones: readonly SceneZone[];
  /** In data.mjs order. */
  readonly hops: readonly SceneHop[];
}

/** The width of a hop label's box for `text`, in screen units. */
const labelWidth = (text: string) =>
  text.length * tagCharWidth + 2 * labelPadding;

const centreOf = ({ x, y, w, d }: Placement, z: number) =>
  project({ x: x + w / 2, y: y + d / 2, z });

type ChipSource = Pick<Structure, "code" | "shape">;

const chipWidth = (structure: ChipSource) =>
  structure.code.length * chipCharWidth + chipPadding;

/**
 * Where a structure's code chip goes in Plan view: inside the box's top
 * left corner, or nothing when the box is too narrow for it.
 */
const planChipRect = (
  structure: ChipSource,
  placement: Placement
): ScreenRect | undefined => {
  const box = planRect(placement);
  const width = chipWidth(structure);
  const left = box.left + planChipInset;

  return box.right - box.left < width * 3
    ? undefined
    : {
        left,
        right: left + width,
        top: box.top + planChipInset,
        bottom: box.top + planChipInset + chipHeight,
      };
};

/**
 * Where a structure's code chip goes: the middle of its shape's top, or
 * nothing when the shape has no top or the top is too small for the chip.
 */
const chipRect: {
  (placement: Placement): (structure: ChipSource) => ScreenRect | undefined;
  (structure: ChipSource, placement: Placement): ScreenRect | undefined;
} = dual(
  2,
  (structure: ChipSource, placement: Placement): ScreenRect | undefined => {
    const width = chipWidth(structure);
    const topWidth = ((placement.w + placement.d) * tileWidth) / 2;
    const at = centreOf(placement, isoHeights[structure.shape]);

    return chipless.has(structure.shape) || topWidth < width * 1.6
      ? undefined
      : {
          left: at.sx - width / 2,
          right: at.sx + width / 2,
          top: at.sy - chipHeight / 2,
          bottom: at.sy + chipHeight / 2,
        };
  }
);

/** The full silhouette a shape draws, halo included. */
export const silhouette: {
  (shape: Shape): (placement: Placement) => readonly ScreenPoint[];
  (placement: Placement, shape: Shape): readonly ScreenPoint[];
} = dual(2, (placement: Placement, shape: Shape): readonly ScreenPoint[] => {
  const by = overhang[shape] ?? 0;

  if (by === 0) {
    return boxOutline(placement, shape);
  }

  const grown = {
    x: placement.x - by,
    y: placement.y - by,
    w: placement.w + 2 * by,
    d: placement.d + 2 * by,
  };

  const ground = corners(grown, 0);
  const top = corners(grown, isoHeights[shape] + haloLift);

  return [
    top.back,
    top.right,
    ground.right,
    ground.front,
    ground.left,
    top.left,
  ];
});

/** The rectangle a shape draws in Plan view, halo included. */
const planOutline = (
  placement: Placement,
  shape: Shape
): readonly ScreenPoint[] => {
  const by = overhang[shape] ?? 0;

  return rectPolygon(
    planRect({
      x: placement.x - by,
      y: placement.y - by,
      w: placement.w + 2 * by,
      d: placement.d + 2 * by,
    })
  );
};

const byDepth = Order.mapInput(
  Order.Number,
  ({ placement }: SceneStructure) =>
    placement.x + placement.y + placement.w + placement.d
);

/**
 * Whether `a` sits behind `b`, so `b` must be drawn over it: `a` ends
 * before `b` starts along one axis and they share some of the other.
 */
const behind = (
  { placement: a }: SceneStructure,
  { placement: b }: SceneStructure
) =>
  (a.x + a.w <= b.x && a.y < b.y + b.d) ||
  (a.y + a.d <= b.y && a.x < b.x + b.w);

/**
 * Painter's order: every box is drawn after the boxes it sits in front of.
 * Of the boxes ready to draw, the one whose front corner is furthest back
 * goes first.
 */
const paintOrder = (
  items: readonly SceneStructure[]
): readonly SceneStructure[] => {
  if (!Arr.isReadonlyArrayNonEmpty(items)) {
    return [];
  }

  const sorted = Arr.sort(items, byDepth);

  const ready = Arr.findFirst(sorted, (item) =>
    Arr.every(sorted, (other) => other === item || !behind(other, item))
  );

  // Overlapping footprints can make a cycle; fall back to depth order.
  const next = Option.getOrElse(ready, () => sorted[0]);

  return [next, ...paintOrder(Arr.filter(sorted, (item) => item !== next))];
};

/**
 * The four corners of a title of `width` skewed along an edge, grown by
 * `margin`: its baseline runs from `start` in the direction `along`, and its
 * upright strokes stay vertical.
 */
const titleQuad = (
  { start, along }: Pick<TitleSpot, "start" | "along">,
  width: number,
  margin: number
): readonly ScreenPoint[] => {
  const at = (x: number, y: number) => ({
    sx: start.sx + x * along.sx,
    sy: start.sy + x * along.sy + y,
  });

  const top = -titleAscent - margin;
  const bottom = titleDescent + margin;

  return [
    at(-margin, top),
    at(width + margin, top),
    at(width + margin, bottom),
    at(-margin, bottom),
  ];
};

const plateOf = (zone: Zone): readonly ScreenPoint[] => {
  const { back, right, front, left } = corners(zone.box, 0);

  return [back, right, front, left];
};

const planPlateOf = (zone: Zone): readonly ScreenPoint[] =>
  rectPolygon(planRect(zone.box));

/** Whether every point is inside a convex polygon, edges included. */
const insideConvex = (
  polygon: readonly ScreenPoint[],
  points: readonly ScreenPoint[]
) => {
  const sides = Arr.map(polygon, (corner, index) => {
    const next = polygon[(index + 1) % polygon.length] ?? corner;

    return (point: ScreenPoint) =>
      (next.sx - corner.sx) * (point.sy - corner.sy) -
      (next.sy - corner.sy) * (point.sx - corner.sx);
  });

  return Arr.every(points, (point) => {
    const signs = Arr.map(sides, (side) => side(point));

    return (
      Arr.every(signs, (sign) => sign >= -1e-6) ||
      Arr.every(signs, (sign) => sign <= 1e-6)
    );
  });
};

/** Where a title's baseline starts and the way it runs. */
interface TitleSpot {
  readonly start: ScreenPoint;
  readonly along: ScreenPoint;
  /** Whether the spot is outside the plate, below its edge. */
  readonly outside: boolean;
}

/**
 * The offsets along an edge of `length` a title of `width` may start at,
 * from the edge's start. A title longer than the edge is centred on it.
 */
const runsAlong = (length: number, width: number) =>
  length >= width
    ? Arr.map(
        Arr.range(0, Math.floor((length - width) / titleStep)),
        (step) => step * titleStep
      )
    : [(length - width) / 2];

/**
 * The offsets a title outside the plate may start at: anywhere it still
 * overlaps at least half its width with the edge, middle first.
 */
const runsBeside = (length: number, width: number) => {
  const steps = Arr.range(0, Math.floor(length / titleStep));
  const runs = Arr.map(steps, (step) => step * titleStep - width / 2);

  const middleFirst = Order.mapInput(Order.Number, (run: number) =>
    Math.abs(run + width / 2 - length / 2)
  );

  return Arr.sort(runs, middleFirst);
};

/**
 * Baseline starts for a zone's title, best first. A title lies along one of
 * the plate's edges, reading left to right: first on the plate's strip
 * along a front edge (front-left from the left corner, then front-right
 * from the front corner), then on the strip along a back edge, then just
 * outside the plate beyond a front edge and beyond a back edge. On each,
 * spots nearest the edge come first.
 */
const titleSpots = (zone: Zone, width: number): readonly TitleSpot[] => {
  const { back, front, left } = corners(zone.box, 0);
  const wide = zone.box.w * gridOnScreen;
  const deep = zone.box.d * gridOnScreen;

  const fronts = [
    { start: left, along: alongX, length: wide, room: wide, inward: 1 },
    { start: front, along: upFrontRight, length: deep, room: deep, inward: 1 },
  ];

  const backs = [
    { start: left, along: upFrontRight, length: deep, room: deep, inward: -1 },
    { start: back, along: alongX, length: wide, room: wide, inward: -1 },
  ];

  return [
    ...spotsBy(fronts, width, false),
    ...spotsBy(backs, width, false),
    ...spotsBy(fronts, width, true),
    ...spotsBy(backs, width, true),
  ];
};

/** How round a zone's corners are in Plan view, in screen units. */
export const planZoneRadius = 10;

/** The screen direction along a horizontal edge in Plan view. */
const across = { sx: 1, sy: 0 };

/**
 * Baseline starts for a zone's title in Plan view, best first: inside the
 * plate along its top edge, then along its bottom edge, then just outside
 * above the top edge and below the bottom edge.
 */
const planTitleSpots = (zone: Zone, width: number): readonly TitleSpot[] => {
  const plate = planRect(zone.box);
  // Titles keep off the plate's rounded corners.
  const wide = plate.right - plate.left - 2 * planZoneRadius;
  const deep = plate.bottom - plate.top;
  const topLeft = { sx: plate.left + planZoneRadius, sy: plate.top };
  const bottomLeft = { sx: plate.left + planZoneRadius, sy: plate.bottom };

  const tops = [
    { start: topLeft, along: across, length: wide, room: deep, inward: -1 },
  ];

  const bottoms = [
    { start: bottomLeft, along: across, length: wide, room: deep, inward: 1 },
  ];

  return [
    ...spotsBy(tops, width, false),
    ...spotsBy(bottoms, width, false),
    ...spotsBy(tops, width, true),
    ...spotsBy(bottoms, width, true),
  ];
};

/** An edge a title may lie along. */
interface TitleEdge {
  readonly start: ScreenPoint;
  readonly along: ScreenPoint;
  readonly length: number;
  /** How far into the plate titles may move off the edge, doubled. */
  readonly room: number;
  /** +1 when the plate lies above the edge on screen. */
  readonly inward: number;
}

/**
 * Title spots along `edges`: on the plate's strip by each edge, or just
 * outside it. On each, spots nearest the edge come first.
 */
const spotsBy = (
  edges: readonly TitleEdge[],
  width: number,
  outside: boolean
): readonly TitleSpot[] =>
  Arr.flatMap(edges, (edge) => {
    const depth = outside ? 3 : Math.floor(edge.room / 2 / titleStep);
    const up = edge.inward > 0 !== outside;
    const lifts = up ? liftsAbove(depth) : liftsBelow(depth);

    return Arr.flatMap(lifts, (lift) =>
      Arr.map(
        outside
          ? runsBeside(edge.length, width)
          : runsAlong(edge.length, width),
        (run) => ({
          start: {
            sx: edge.start.sx + run * edge.along.sx,
            sy: edge.start.sy + run * edge.along.sy - lift,
          },
          along: edge.along,
          outside,
        })
      )
    );
  });

/** Lifts off an edge towards the screen's top, nearest first. */
const liftsAbove = (count: number) =>
  Arr.map(
    Arr.range(0, count),
    (step) => titleDescent + titleMargin + step * titleStep
  );

/** Lifts off an edge towards the screen's bottom, nearest first. */
const liftsBelow = (count: number) =>
  Arr.map(
    Arr.range(0, count),
    (step) => -(titleAscent + titleMargin) - step * titleStep
  );

/** The SVG transform that skews a title's baseline onto its edge. */
const transformOf = ({ start, along }: TitleSpot) =>
  `matrix(${along.sx} ${along.sy} 0 1 ${start.sx} ${start.sy})`;

/** Something text must keep clear of, with its bounds for a quick test. */
interface Obstacle {
  readonly polygon: readonly ScreenPoint[];
  readonly bounds: ScreenRect;
}

interface LineObstacle extends Segment {
  readonly bounds: ScreenRect;
}

/** What text must keep clear of. */
interface Obstacles {
  /** Boxes, zone titles, plates of other zones, tags, chips and labels. */
  readonly shapes: readonly Obstacle[];
  /** Route segments. */
  readonly lines: readonly LineObstacle[];
}

const obstacle = (polygon: readonly ScreenPoint[]): Obstacle => ({
  polygon,
  bounds: boundsOfPoints(polygon),
});

const lineObstacle = (segment: Segment): LineObstacle => ({
  ...segment,
  bounds: boundsOfPoints([segment.start, segment.end]),
});

/** Whether two bounds share area or touch. */
const boundsMeet = (a: ScreenRect, b: ScreenRect) =>
  a.left <= b.right &&
  b.left <= a.right &&
  a.top <= b.bottom &&
  b.top <= a.bottom;

const clearOf = (polygon: readonly ScreenPoint[], avoid: Obstacles) => {
  const bounds = boundsOfPoints(polygon);

  return (
    Arr.every(
      avoid.shapes,
      (other) =>
        !boundsMeet(bounds, other.bounds) ||
        !convexOverlap(polygon, other.polygon)
    ) &&
    Arr.every(
      avoid.lines,
      (line) =>
        !boundsMeet(bounds, line.bounds) || !segmentCrosses(line, polygon)
    )
  );
};

const withShapes = (
  avoid: Obstacles,
  polygons: readonly (readonly ScreenPoint[])[]
): Obstacles => ({
  ...avoid,
  shapes: [...avoid.shapes, ...Arr.map(polygons, obstacle)],
});

/** What differs between the iso view and Plan view. */
interface ViewGeometry {
  readonly project: (point: GridPosition) => ScreenPoint;
  readonly outline: (
    placement: Placement,
    shape: Shape
  ) => readonly ScreenPoint[];
  /** Where the name tag may go, best first. */
  readonly tagSpots: (
    placed: Pick<SceneStructure, "placement" | "outline">,
    text: string
  ) => readonly ScreenRect[];
  readonly chip: (
    structure: ChipSource,
    placement: Placement
  ) => ScreenRect | undefined;
  readonly plate: (zone: Zone) => readonly ScreenPoint[];
  readonly titleSpots: (zone: Zone, width: number) => readonly TitleSpot[];
  /** Puts the structures in the order they're drawn. */
  readonly order: (
    items: readonly SceneStructure[]
  ) => readonly SceneStructure[];
}

const tagWidth = (text: string) => text.length * tagCharWidth + tagPadding;

const geometries: Readonly<Record<View, ViewGeometry>> = {
  iso: {
    project,
    outline: silhouette,
    tagSpots: ({ placement }, text) => [nameTagRect(placement, text)],
    chip: chipRect,
    plate: plateOf,
    titleSpots,
    order: paintOrder,
  },
  plan: {
    project: projectPlan,
    outline: planOutline,
    tagSpots: ({ outline }, text) =>
      planTagSpots(boundsOfPoints(outline), tagWidth(text)),
    chip: planChipRect,
    plate: planPlateOf,
    titleSpots: planTitleSpots,
    order: (items) => items,
  },
};

/**
 * Places every zone's title along one of its plate's front edges, in the
 * first spot clear of `avoid`, the other plates and the titles placed
 * before it. A title with no clear spot is left out.
 */
const placeZones = (
  zones: readonly Zone[],
  avoid: Obstacles,
  geometry: ViewGeometry
): readonly SceneZone[] => {
  const plates = Arr.map(zones, geometry.plate);

  return Arr.reduce(zones, Arr.empty<SceneZone>(), (done, zone, index) => {
    const plate = plates[index] ?? geometry.plate(zone);
    const width = zone.group.title.length * titleCharWidth;

    const around = withShapes(avoid, [
      ...Arr.filter(plates, (_, other) => other !== index),
      ...Arr.flatMap(done, ({ title }) => (title === undefined ? [] : [title])),
    ]);

    const spot = Arr.findFirst(
      geometry.titleSpots(zone, width),
      (candidate) => {
        const padded = titleQuad(candidate, width, titleMargin);

        return (
          (candidate.outside || insideConvex(plate, padded)) &&
          clearOf(padded, around)
        );
      }
    );

    return [
      ...done,
      Option.match(spot, {
        onNone: () => ({
          zone,
          plate,
          titleAt: undefined,
          title: undefined,
          titleTransform: undefined,
        }),
        onSome: (found) => ({
          zone,
          plate,
          titleAt: found.start,
          title: titleQuad(found, width, 0),
          titleTransform: transformOf(found),
        }),
      }),
    ];
  });
};

/** Stretches shorter than this, in screen units, aren't worth redrawing. */
const shortestStretch = 1;

interface Piece {
  readonly leg: number;
  readonly from: number;
  readonly to: number;
  readonly a: ScreenPoint;
  readonly b: ScreenPoint;
}

interface Stretch {
  readonly points: readonly ScreenPoint[];
  readonly last: Piece;
}

const byStart = Order.mapInput(
  Order.Number,
  ({ from }: { readonly from: number }) => from
);

/** Merges overlapping intervals, in order. */
const merge = (
  intervals: readonly { readonly from: number; readonly to: number }[]
) =>
  Arr.reduce(
    Arr.sort(intervals, byStart),
    Arr.empty<{ readonly from: number; readonly to: number }>(),
    (merged, interval) => {
      const last = merged.at(-1);

      return last !== undefined && interval.from <= last.to
        ? [
            ...merged.slice(0, -1),
            { from: last.from, to: Math.max(last.to, interval.to) },
          ]
        : [...merged, interval];
    }
  );

/** Joins pieces that meet at a bend into one stretch. */
const joinPieces = (pieces: readonly Piece[]) =>
  Arr.reduce(pieces, Arr.empty<Stretch>(), (stretches, piece) => {
    const last = stretches.at(-1);

    const continues =
      last !== undefined &&
      last.last.leg === piece.leg - 1 &&
      last.last.to === 1 &&
      piece.from === 0;

    return continues
      ? [
          ...stretches.slice(0, -1),
          { points: [...last.points, piece.b], last: piece },
        ]
      : [...stretches, { points: [piece.a, piece.b], last: piece }];
  });

/**
 * The stretches of a route on the ground that boxes are drawn over: the
 * parts of its polyline inside a box's outline. Routes are drawn on the
 * ground before every box, so in the painter's order any box whose outline
 * reaches over a stretch hides it.
 */
const hiddenStretches = ({
  points,
  outlines,
}: {
  readonly points: readonly ScreenPoint[];
  readonly outlines: readonly (readonly ScreenPoint[])[];
}): readonly HiddenStretch[] => {
  const pieces = Arr.flatMap(segmentsOf(points), (segment) => {
    const length = segmentLength(segment);

    const inside = merge(
      Arr.flatMap(outlines, (outline) =>
        Option.toArray(Option.fromNullishOr(clipToConvex(segment, outline)))
      )
    );

    return Arr.flatMap(inside, ({ from, to }) =>
      (to - from) * length < shortestStretch
        ? []
        : [
            {
              leg: segment.index,
              from,
              to,
              a: lerp({ from: segment.start, to: segment.end, t: from }),
              b: lerp({ from: segment.start, to: segment.end, t: to }),
            },
          ]
    );
  });

  const lastLeg = points.length - 2;

  return Arr.map(joinPieces(pieces), (stretch) => ({
    points: stretch.points,
    reachesEnd: stretch.last.leg === lastLeg && stretch.last.to === 1,
  }));
};

/** How far a label's nearest edge may sit from its leg, in screen units. */
const labelGaps = [3, 10, 18] as const;

/** Clear space a label keeps from everything but its own line. */
const labelClearance = 3;

/** Clear space a name tag in Plan view keeps from everything else. */
const tagClearance = 2;

/** Where along a leg a label may sit, most preferred first: the middle. */
const labelShares = Arr.sort(
  Arr.map(Arr.range(2, 18), (step) => step / 20),
  Order.mapInput(Order.Number, (share: number) => Math.abs(share - 0.5))
);

interface Leg extends Segment {
  readonly index: number;
  readonly length: number;
}

/**
 * The spots a label of `width` may take at a point `share` of the way along
 * a leg: beside it, its centre on the leg's perpendicular with its nearest
 * edge one of `labelGaps` from the line, on either side; or on the line itself,
 * centred on it, where its paper backing breaks the line.
 */
const spotsAt = (leg: Leg, share: number, width: number) => {
  const at = lerp({ from: leg.start, to: leg.end, t: share });
  const unit = Math.max(leg.length, 1e-9);

  const normal = {
    sx: -(leg.end.sy - leg.start.sy) / unit,
    sy: (leg.end.sx - leg.start.sx) / unit,
  };

  const reach =
    (Math.abs(normal.sx) * width) / 2 + (Math.abs(normal.sy) * labelHeight) / 2;

  const rectAround = (centre: ScreenPoint) => ({
    left: centre.sx - width / 2,
    right: centre.sx + width / 2,
    top: centre.sy - labelHeight / 2,
    bottom: centre.sy + labelHeight / 2,
  });

  // A leg's slope on screen and which way it leans, for the spots straight
  // above and below it, whose nearest corner sits `gap` from the line.
  const slope =
    (leg.end.sy - leg.start.sy) / (leg.end.sx - leg.start.sx || 1e-9);

  const lean = Math.sign(slope);

  const upright = (gap: number, side: -1 | 1) => {
    // How far the label's centre sits above or below the line so that its
    // corner nearest the line clears it by `gap` along the vertical.
    const lift = labelHeight / 2 + (Math.abs(slope) * width) / 2 + gap;

    return rectAround({ sx: at.sx, sy: at.sy + side * lift });
  };

  const rectAt = (offset: number) => {
    const centre = {
      sx: at.sx + normal.sx * offset,
      sy: at.sy + normal.sy * offset,
    };

    return {
      left: centre.sx - width / 2,
      right: centre.sx + width / 2,
      top: centre.sy - labelHeight / 2,
      bottom: centre.sy + labelHeight / 2,
    };
  };

  return {
    beside: [
      ...Arr.flatMap(labelGaps, (gap) => [
        rectAt(-(reach + gap)),
        rectAt(reach + gap),
      ]),
      // A vertical leg, which only Plan view draws, has no spots straight
      // above and below it; the spots beside it sit level with it.
      ...(leg.end.sx === leg.start.sx
        ? []
        : Arr.flatMap(labelGaps, (gap) => [upright(gap, -1), upright(gap, 1)])),
    ],
    on: rectAt(0),
    lean,
  };
};

/** How far along itself a label of `width` reaches. */
const roomNeeded = (leg: Leg, width: number) =>
  (Math.abs(leg.end.sx - leg.start.sx) * width +
    Math.abs(leg.end.sy - leg.start.sy) * labelHeight) /
  Math.max(leg.length, 1e-9);

/** Where a hop's label goes, and whether it fits there. */
interface LabelPlacement {
  /** The clear spot, or `undefined` when there's none. */
  readonly spot: ScreenRect | undefined;
  /** Where to show the label on hover: the clear spot or the best try. */
  readonly fallback: ScreenRect | undefined;
}

/**
 * The first clear spot for a hop's label at one of its legs. Legs long
 * enough for it come first, longest first; on each, spots nearest the
 * middle first, beside the line before on it.
 */
const labelSpot = (
  points: readonly ScreenPoint[],
  text: string,
  avoid: Obstacles
): LabelPlacement => {
  const width = labelWidth(text);

  const legs: readonly Leg[] = Arr.map(segmentsOf(points), (segment) => ({
    ...segment,
    length: segmentLength(segment),
  }));

  const order = Order.combine(
    Order.mapInput(Order.Number, (leg: Leg) =>
      leg.length >= roomNeeded(leg, width) ? 0 : 1
    ),
    Order.combine(
      Order.mapInput(Order.Number, (leg: Leg) => -leg.length),
      Order.mapInput(Order.Number, (leg: Leg) => leg.index)
    )
  );

  const sorted = Arr.sort(legs, order);

  const candidates = Arr.flatMap(sorted, (leg: Leg) =>
    Arr.flatMap(labelShares, (share) => {
      const { beside, on } = spotsAt(leg, share, width);

      return [...beside, on];
    })
  );

  const spot = Option.getOrUndefined(
    Arr.findFirst(candidates, (rect) =>
      clearOf(rectPolygon(growRect(rect, labelClearance)), avoid)
    )
  );

  const [longest] = sorted;

  const fallback =
    longest === undefined ? undefined : spotsAt(longest, 0.5, width).on;

  return { spot, fallback: spot ?? fallback };
};

/** What a scene is computed from. */
export interface SceneSource {
  readonly data: MapData;
  readonly layout: Layout;
  /** The structures drawn, such as those revealed so far. */
  readonly revealed: ReadonlySet<string>;
  /**
   * The routes, when the caller has them already. Defaults to the hops
   * routed around the revealed structures only.
   */
  readonly routes?: Readonly<Record<string, HopRoute>> | undefined;
  /**
   * Hops whose labels are placed first, such as the hops the chapter plays,
   * in order. The rest follow in data.mjs order.
   */
  readonly labelFirst?: readonly string[] | undefined;
  /** Which view to draw. Defaults to the iso view. */
  readonly view?: View | undefined;
}

/**
 * Lays out everything a view draws for `revealed`: the structures in
 * painter's order with their tags and chips, the zones with their titles,
 * and the hops between revealed structures with their labels. Zone titles
 * are placed first, clear of boxes, tags, chips and routes. Then labels go
 * one by one, `labelFirst` first and the rest in data.mjs order, each in
 * the first free spot at its own route: clear of every box, tag, chip,
 * zone title, other route and label placed before it. A label with no free
 * spot is hidden, and shows on hover at `hoverLabel`.
 */
export const sceneOf = ({
  data,
  layout,
  revealed,
  routes = routeRevealed({ data, layout, revealed }),
  labelFirst = [],
  view = "iso",
}: SceneSource): Scene => {
  const geometry = geometries[view];

  const boxes = Arr.flatMap(data.structures, (structure) => {
    const placement = layout.structures[structure.id];

    return placement === undefined || !revealed.has(structure.id)
      ? []
      : [
          {
            structure,
            placement,
            outline: geometry.outline(placement, structure.shape),
            chip: geometry.chip(structure, placement),
          },
        ];
  });

  const outlines = Arr.map(boxes, ({ outline }) => outline);

  const routed = Arr.flatMap(data.hops, (hop) => {
    const route = routes[hop.id];

    return route === undefined ||
      !revealed.has(hop.from) ||
      !revealed.has(hop.to)
      ? []
      : [{ hop, route, points: Arr.map(route.points, geometry.project) }];
  });

  const lines = Arr.map(routed, ({ hop, points }) => ({
    id: hop.id,
    segments: Arr.map(segmentsOf(points), lineObstacle),
  }));

  const allLines = Arr.flatMap(lines, ({ segments }) => segments);

  const chips = Arr.flatMap(boxes, ({ chip }) =>
    chip === undefined ? [] : [rectPolygon(chip)]
  );

  // Each tag takes its first spot clear of the boxes, chips, routes and the
  // tags placed before it, or else its first spot. The iso view has one.
  const tagged = Arr.reduce(
    boxes,
    Arr.empty<SceneStructure>(),
    (done, item) => {
      const spots = geometry.tagSpots(item, nameTagText(item.structure));
      const [first = { left: 0, top: 0, right: 0, bottom: 0 }] = spots;

      const avoid = {
        shapes: Arr.map(
          [
            ...outlines,
            ...chips,
            ...Arr.map(done, ({ tag }) => rectPolygon(tag)),
          ],
          obstacle
        ),
        lines: allLines,
      };

      const tag =
        spots.length === 1
          ? first
          : Option.getOrElse(
              Arr.findFirst(spots, (spot) =>
                clearOf(rectPolygon(growRect(spot, tagClearance)), avoid)
              ),
              () => first
            );

      return [...done, { ...item, tag }];
    }
  );

  const structures = geometry.order(tagged);

  const tagsAndChips = [
    ...Arr.map(structures, ({ tag }) => rectPolygon(tag)),
    ...chips,
  ];

  const zones = placeZones(
    zonesOf({ data, layout, revealed }),
    {
      shapes: Arr.map([...outlines, ...tagsAndChips], obstacle),
      lines: allLines,
    },
    geometry
  );

  const fixed = Arr.map(
    [
      ...outlines,
      ...tagsAndChips,
      ...Arr.flatMap(zones, ({ title }) =>
        title === undefined ? [] : [title]
      ),
    ],
    obstacle
  );

  const outlineOf = new Map(
    Arr.map(structures, ({ structure, outline }) => [structure.id, outline])
  );

  // A route is drawn behind its own source box where it leaves a back edge,
  // which reads as leaving from behind, so that stretch isn't redrawn. Over
  // the target box only the stretch carrying the arrowhead is redrawn.
  const hiddenOf = (hop: Hop, points: readonly ScreenPoint[]) => {
    const others = Arr.flatMap(structures, ({ structure, outline }) =>
      structure.id === hop.from || structure.id === hop.to ? [] : [outline]
    );

    const target = outlineOf.get(hop.to);

    const atHead =
      target === undefined
        ? []
        : Arr.filter(
            hiddenStretches({ points, outlines: [target] }),
            ({ reachesEnd }) => reachesEnd
          );

    return [...hiddenStretches({ points, outlines: others }), ...atHead];
  };

  const rank = new Map(Arr.map(labelFirst, (id, index) => [id, index]));

  const labelOrder = Arr.sort(
    routed,
    Order.mapInput(
      Order.Number,
      ({ hop }: (typeof routed)[number]) =>
        rank.get(hop.id) ?? labelFirst.length
    )
  );

  const labelled = Arr.reduce(
    labelOrder,
    Arr.empty<SceneHop>(),
    (done, item) => {
      const { spot, fallback } = labelSpot(item.points, item.hop.label, {
        shapes: [
          ...fixed,
          ...Arr.flatMap(done, ({ label }) =>
            label === undefined ? [] : [obstacle(rectPolygon(label))]
          ),
        ],
        lines: Arr.flatMap(lines, ({ id, segments }) =>
          id === item.hop.id ? [] : segments
        ),
      });

      return [
        ...done,
        {
          ...item,
          label: spot,
          hoverLabel: fallback,
          hidden: hiddenOf(item.hop, item.points),
        },
      ];
    }
  );

  const byHop = new Map(Arr.map(labelled, (item) => [item.hop.id, item]));

  const hops = Arr.flatMap(routed, ({ hop }) =>
    Option.toArray(Option.fromNullishOr(byHop.get(hop.id)))
  );

  return { view, structures, zones, hops };
};

/** One way a scene breaks the overlap rule. */
export interface SceneClash {
  /** What's drawn over what, such as `["tag:a", "box:b"]`. */
  readonly between: readonly [string, string];
}

/** How long a hop's arrowhead is, from its base to its tip, on screen. */
export const arrowLength = 10;

/**
 * The tip and the middle of the base of the arrowhead drawn at a route's
 * end: the tip on the route's last point, the base `arrowLength` back along
 * the last leg.
 */
export const arrowheadOf = (
  points: readonly ScreenPoint[]
): { readonly tip: ScreenPoint; readonly base: ScreenPoint } | undefined => {
  const tip = points.at(-1);
  const before = points.at(-2);

  if (tip === undefined || before === undefined) {
    return undefined;
  }

  const length = Math.hypot(tip.sx - before.sx, tip.sy - before.sy);

  return {
    tip,
    base: lerp({
      from: tip,
      to: before,
      t: arrowLength / Math.max(length, 1e-9),
    }),
  };
};

interface Shape2d {
  readonly id: string;
  readonly polygon: readonly ScreenPoint[];
}

const rectShape = (id: string, rect: ScreenRect): Shape2d => ({
  id,
  polygon: rectPolygon(rect),
});

/** Whether a scene item's id names a code chip. */
const isChip = Str.startsWith("chip:");

/**
 * Every pair of things in a scene drawn over each other, by the overlap
 * rule: no two of the name tags, hop labels, zone titles, code chips and
 * box outlines overlap (a chip sits on its own box), and no route runs
 * through a name tag, a zone title or a label other than its own. A
 * route may run through the tag of a structure it starts or ends at only
 * where it can't avoid it, so that counts too.
 */
export const sceneClashes = (scene: Scene): readonly SceneClash[] => {
  const boxes = Arr.map(scene.structures, ({ structure, outline }) => ({
    id: `box:${structure.id}`,
    polygon: outline,
    owner: structure.id,
  }));

  const text = [
    ...Arr.map(scene.structures, ({ structure, tag }) => ({
      ...rectShape(`tag:${structure.id}`, tag),
      owner: structure.id,
    })),
    ...Arr.flatMap(scene.structures, ({ structure, chip }) =>
      chip === undefined
        ? []
        : [{ ...rectShape(`chip:${structure.id}`, chip), owner: structure.id }]
    ),
    ...Arr.flatMap(scene.zones, ({ zone, title }) =>
      title === undefined
        ? []
        : [{ id: `title:${zone.group.id}`, polygon: title, owner: "" }]
    ),
    ...Arr.flatMap(scene.hops, ({ hop, label }) =>
      label === undefined
        ? []
        : [{ ...rectShape(`label:${hop.id}`, label), owner: "" }]
    ),
  ];

  const solids = [...boxes, ...text];

  const pairs = Arr.flatMap(solids, (first, index) =>
    Arr.flatMap(solids.slice(index + 1), (second) => {
      const ownChip =
        first.owner !== "" &&
        first.owner === second.owner &&
        (isChip(first.id) || isChip(second.id));

      return !ownChip && convexOverlap(first.polygon, second.polygon)
        ? [{ between: [first.id, second.id] as const }]
        : [];
    })
  );

  const crossings = Arr.flatMap(scene.hops, ({ hop, points }) =>
    Arr.flatMap(text, (shape) =>
      shape.id === `label:${hop.id}` ||
      isChip(shape.id) ||
      !Arr.some(segmentsOf(points), (segment) =>
        segmentCrosses(segment, shape.polygon)
      )
        ? []
        : [{ between: [`route:${hop.id}`, shape.id] as const }]
    )
  );

  return [...pairs, ...crossings];
};

/** How far a point may sit from where it should be, in screen units. */
const onTolerance = 0.5;

/** Whether a route's last point sits on its target's ground outline. */
export const endsOnTarget: {
  (target: Placement): (hop: SceneHop) => boolean;
  (hop: SceneHop, target: Placement): boolean;
} = dual(2, (hop: SceneHop, target: Placement) => {
  const { back, right, front, left } = corners(target, 0);
  const tip = hop.points.at(-1);

  return (
    tip !== undefined &&
    distanceToPolyline([back, right, front, left, back], tip) <= onTolerance
  );
});

/** A label's centre and how far it sits from its own route. */
export const labelReach = (hop: SceneHop) =>
  hop.label === undefined
    ? undefined
    : distanceToPolyline(hop.points, {
        sx: (hop.label.left + hop.label.right) / 2,
        sy: (hop.label.top + hop.label.bottom) / 2,
      });
