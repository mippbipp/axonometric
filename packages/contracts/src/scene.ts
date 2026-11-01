import { Array as Arr, Option, Order } from "effect";
import { dual } from "effect/Function";

import {
  boundsOfPoints,
  emptyRect,
  gapBetween,
  slideOffsets,
  tiny,
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
  nameTagText,
  project,
  tagCharWidth,
  tagOffset,
  tagPadding,
  gridOnScreen,
  tileHeight,
  tileWidth,
} from "./iso.ts";
import type { GridPosition, ScreenPoint, ScreenRect } from "./iso.ts";
import type { Layout, Placement } from "./layout.ts";
import type { Hop, MapData, Shape, Structure } from "./map-data.ts";
import { planRect, planTagSpots, planUnit, projectPlan } from "./plan.ts";
import type { TagSize, View } from "./plan.ts";
import { routeRevealed } from "./routing.ts";
import type { HopRoute } from "./routing.ts";
import { textGrowthAt, textSizes } from "./text-size.ts";
import type { TextGrowth } from "./text-size.ts";
import { zonesOf } from "./zones.ts";
import type { Zone } from "./zones.ts";

// The scene: everything a view draws for one set of revealed structures, in
// screen space, for the Iso view or Plan view. The editor draws from it, and
// `check` runs the same overlap test over both views, so the page and
// `check` can't disagree. The views differ only in their geometry: how the
// ground projects, each box's outline, where tags, chips and zone titles may
// go. Placing text in clear spots is shared.

/** Approximate width of one character of the code chip's font. */
const chipCharWidth = 6.4;

/** The code chip is this much wider than its text. */
const chipPadding = 8;

const chipHeight = textSizes.chip.height;

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
   * Iso view its silhouette to its iso height, in Plan view its footprint's
   * rectangle, halo included.
   */
  readonly outline: readonly ScreenPoint[];
  /** The smallest rect holding `outline`. */
  readonly bounds: ScreenRect;
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
   * The plate's ground corners: in the Iso view back, right, front and left;
   * in Plan view clockwise from the top left.
   */
  readonly plate: readonly ScreenPoint[];
  /** The smallest rect holding `plate`: in Plan view, the plate itself. */
  readonly bounds: ScreenRect;
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
const labelHeight = textSizes.label.height;

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
  /** How much the text is grown, from the zoom the scene is drawn for. */
  readonly growth: TextGrowth;
  /** In painter's order: every box after the boxes it stands in front of. */
  readonly structures: readonly SceneStructure[];
  readonly zones: readonly SceneZone[];
  /** In data.mjs order. */
  readonly hops: readonly SceneHop[];
}

/** The width of a hop label's box for `text`, in screen units. */
const labelWidth = (text: string, grow: number) =>
  (text.length * tagCharWidth + 2 * labelPadding) * grow;

const centreOf = ({ x, y, w, d }: Placement, z: number) =>
  project({ x: x + w / 2, y: y + d / 2, z });

type ChipSource = Pick<Structure, "code" | "shape">;

const chipWidth = (structure: ChipSource, grow: number) =>
  (structure.code.length * chipCharWidth + chipPadding) * grow;

/**
 * Where a structure's code chip goes in Plan view: inside the box's top
 * left corner, or nothing when the box is too narrow for it.
 */
const planChipRect = (
  structure: ChipSource,
  placement: Placement,
  grow: number
): ScreenRect | undefined => {
  const box = planRect(placement);
  const width = chipWidth(structure, grow);
  const left = box.left + planChipInset;

  return box.right - box.left < width * 3
    ? undefined
    : {
        left,
        right: left + width,
        top: box.top + planChipInset,
        bottom: box.top + planChipInset + chipHeight * grow,
      };
};

/**
 * Where a structure's code chip goes: the middle of its shape's top, or
 * nothing when the shape has no top or the top is too small for the chip.
 */
const chipRect = (
  structure: ChipSource,
  placement: Placement,
  grow: number
): ScreenRect | undefined => {
  const width = chipWidth(structure, grow);
  const height = chipHeight * grow;
  const topWidth = ((placement.w + placement.d) * tileWidth) / 2;
  const at = centreOf(placement, isoHeights[structure.shape]);

  return chipless.has(structure.shape) || topWidth < width * 1.6
    ? undefined
    : {
        left: at.sx - width / 2,
        right: at.sx + width / 2,
        top: at.sy - height / 2,
        bottom: at.sy + height / 2,
      };
};

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
  { width, grow }: TitleSize,
  margin: number
): readonly ScreenPoint[] => {
  const at = (x: number, y: number) => ({
    sx: start.sx + x * along.sx,
    sy: start.sy + x * along.sy + y,
  });

  const top = -titleAscent * grow - margin;
  const bottom = titleDescent * grow + margin;

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

/** A zone title's width on screen, and how much its text is grown. */
interface TitleSize {
  readonly width: number;
  readonly grow: number;
}

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
const titleSpots = (zone: Zone, size: TitleSize): readonly TitleSpot[] => {
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
    ...spotsBy(fronts, size, false),
    ...spotsBy(backs, size, false),
    ...spotsBy(fronts, size, true),
    ...spotsBy(backs, size, true),
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
const planTitleSpots = (zone: Zone, size: TitleSize): readonly TitleSpot[] => {
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
    ...spotsBy(tops, size, false),
    ...spotsBy(bottoms, size, false),
    ...spotsBy(tops, size, true),
    ...spotsBy(bottoms, size, true),
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
  { width, grow }: TitleSize,
  outside: boolean
): readonly TitleSpot[] =>
  Arr.flatMap(edges, (edge) => {
    const depth = outside ? 3 : Math.floor(edge.room / 2 / titleStep);
    const up = edge.inward > 0 !== outside;
    const lifts = up ? liftsAbove(depth, grow) : liftsBelow(depth, grow);

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
const liftsAbove = (count: number, grow: number) =>
  Arr.map(
    Arr.range(0, count),
    (step) => titleDescent * grow + titleMargin + step * titleStep
  );

/** Lifts off an edge towards the screen's bottom, nearest first. */
const liftsBelow = (count: number, grow: number) =>
  Arr.map(
    Arr.range(0, count),
    (step) => -(titleAscent * grow + titleMargin) - step * titleStep
  );

/**
 * The SVG transform that skews a title's baseline onto its edge, and grows
 * its text by `grow`.
 */
const transformOf = ({ start, along }: TitleSpot, grow: number) =>
  `matrix(${along.sx * grow} ${along.sy * grow} 0 ${grow} ${start.sx} ${start.sy})`;

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

/** What differs between the Iso view and Plan view. */
interface ViewGeometry {
  readonly project: (point: GridPosition) => ScreenPoint;
  readonly outline: (
    placement: Placement,
    shape: Shape
  ) => readonly ScreenPoint[];
  /**
   * Whether the tag goes in the first of `tagSpots` that's clear, or always
   * in the first. At base size the Iso view keeps every tag under its box's
   * front corner, where `check` warns about it; grown, it moves tags to find
   * room, as Plan view always does.
   */
  readonly tagPlacement: "fixed" | "first-clear";
  /** Where the name tag may go, best first. */
  readonly tagSpots: (
    placed: Pick<SceneStructure, "placement" | "outline">,
    size: TagSize
  ) => readonly ScreenRect[];
  readonly chip: (
    structure: ChipSource,
    placement: Placement,
    grow: number
  ) => ScreenRect | undefined;
  readonly plate: (zone: Zone) => readonly ScreenPoint[];
  readonly titleSpots: (zone: Zone, size: TitleSize) => readonly TitleSpot[];
  /** Puts the structures in the order they're drawn. */
  readonly order: (
    items: readonly SceneStructure[]
  ) => readonly SceneStructure[];
}

/** How long one grid unit is on screen, in each view. */
const groundUnit: Readonly<Record<View, number>> = {
  iso: gridOnScreen,
  plan: planUnit,
};

/** A name tag's size for `text`, grown by `grow`. */
const tagSizeOf = (text: string, grow: number): TagSize => ({
  width: (text.length * tagCharWidth + tagPadding) * grow,
  height: textSizes.tag.height * grow,
});

/**
 * How many tag heights further down a grown Iso tag may drop below its
 * front corner, nearest first, to clear a neighbour.
 */
const isoTagRows = [0, 0.5, 1] as const;

/**
 * Where a grown name tag may go in the Iso view, best first: under the
 * front corner, as at base size, sliding sideways while it still spans the
 * corner, then a little lower; then under the left and right corners; then
 * beside them; then above the box.
 */
const isoTagSpots = (
  { placement, outline }: Pick<SceneStructure, "placement" | "outline">,
  { width, height }: TagSize
): readonly ScreenRect[] => {
  const ground = corners(placement, 0);
  const under = ground.front.sy + tagOffset;
  const shifts = slideOffsets(width / 2);

  const rectAt = (left: number, top: number): ScreenRect => ({
    left,
    right: left + width,
    top,
    bottom: top + height,
  });

  const highest = boundsOfPoints(outline).top;

  return [
    ...Arr.flatMap(isoTagRows, (row) =>
      Arr.map(shifts, (shift) =>
        rectAt(ground.front.sx - width / 2 + shift, under + row * height)
      )
    ),
    rectAt(ground.left.sx - width / 2, ground.left.sy + tagOffset),
    rectAt(ground.right.sx - width / 2, ground.right.sy + tagOffset),
    rectAt(ground.left.sx - width - tagOffset, ground.left.sy - height / 2),
    rectAt(ground.right.sx + tagOffset, ground.right.sy - height / 2),
    rectAt(ground.back.sx - width / 2, highest - tagOffset - height),
  ];
};

const geometries: Readonly<Record<View, ViewGeometry>> = {
  iso: {
    project,
    outline: silhouette,
    tagPlacement: "fixed",
    tagSpots: isoTagSpots,
    chip: chipRect,
    plate: plateOf,
    titleSpots,
    order: paintOrder,
  },
  plan: {
    project: projectPlan,
    outline: planOutline,
    tagPlacement: "first-clear",
    tagSpots: ({ outline }, size) =>
      planTagSpots(boundsOfPoints(outline), size),
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
const placeZones = ({
  zones,
  avoid,
  geometry,
  grow,
}: {
  readonly zones: readonly Zone[];
  readonly avoid: Obstacles;
  readonly geometry: ViewGeometry;
  /** How much the titles' text is grown. */
  readonly grow: number;
}): readonly SceneZone[] => {
  const plates = Arr.map(zones, geometry.plate);

  return Arr.reduce(zones, Arr.empty<SceneZone>(), (done, zone, index) => {
    const plate = plates[index] ?? geometry.plate(zone);

    const size = {
      width: zone.group.title.length * titleCharWidth * grow,
      grow,
    };

    const around = withShapes(avoid, [
      ...Arr.filter(plates, (_, other) => other !== index),
      ...Arr.flatMap(done, ({ title }) => (title === undefined ? [] : [title])),
    ]);

    const spot = Arr.findFirst(geometry.titleSpots(zone, size), (candidate) => {
      const padded = titleQuad(candidate, size, titleMargin);

      return (
        (candidate.outside || insideConvex(plate, padded)) &&
        clearOf(padded, around)
      );
    });

    return [
      ...done,
      Option.match(spot, {
        onNone: () => ({
          zone,
          plate,
          bounds: boundsOfPoints(plate),
          titleAt: undefined,
          title: undefined,
          titleTransform: undefined,
        }),
        onSome: (found) => ({
          zone,
          plate,
          bounds: boundsOfPoints(plate),
          titleAt: found.start,
          title: titleQuad(found, size, 0),
          titleTransform: transformOf(found, size.grow),
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
const spotsAt = (leg: Leg, share: number, { width, height: tall }: TagSize) => {
  const at = lerp({ from: leg.start, to: leg.end, t: share });
  const unit = Math.max(leg.length, tiny);

  const normal = {
    sx: -(leg.end.sy - leg.start.sy) / unit,
    sy: (leg.end.sx - leg.start.sx) / unit,
  };

  const reach =
    (Math.abs(normal.sx) * width) / 2 + (Math.abs(normal.sy) * tall) / 2;

  const rectAround = (centre: ScreenPoint) => ({
    left: centre.sx - width / 2,
    right: centre.sx + width / 2,
    top: centre.sy - tall / 2,
    bottom: centre.sy + tall / 2,
  });

  // A leg's slope on screen and which way it leans, for the spots straight
  // above and below it, whose nearest corner sits `gap` from the line.
  const slope =
    (leg.end.sy - leg.start.sy) / (leg.end.sx - leg.start.sx || tiny);

  const lean = Math.sign(slope);

  const upright = (gap: number, side: -1 | 1) => {
    // How far the label's centre sits above or below the line so that its
    // corner nearest the line clears it by `gap` along the vertical.
    const lift = tall / 2 + (Math.abs(slope) * width) / 2 + gap;

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
      top: centre.sy - tall / 2,
      bottom: centre.sy + tall / 2,
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
const roomNeeded = (leg: Leg, { width, height }: TagSize) =>
  (Math.abs(leg.end.sx - leg.start.sx) * width +
    Math.abs(leg.end.sy - leg.start.sy) * height) /
  Math.max(leg.length, tiny);

/**
 * How far a label's box sits from its route, in screen units: from the
 * nearest point on the box's edge, 0 when the route runs through it.
 */
export const labelGap: {
  (label: ScreenRect): (points: readonly ScreenPoint[]) => number;
  (points: readonly ScreenPoint[], label: ScreenRect): number;
} = dual(2, (points: readonly ScreenPoint[], label: ScreenRect): number => {
  const middle = {
    sx: (label.left + label.right) / 2,
    sy: (label.top + label.bottom) / 2,
  };

  const edge = [
    ...rectPolygon(label),
    { sx: middle.sx, sy: label.top },
    { sx: middle.sx, sy: label.bottom },
    { sx: label.left, sy: middle.sy },
    { sx: label.right, sy: middle.sy },
  ];

  const crosses = Arr.some(segmentsOf(points), (segment) =>
    segmentCrosses(segment, rectPolygon(label))
  );

  return crosses
    ? 0
    : Math.min(...Arr.map(edge, (point) => distanceToPolyline(points, point)));
});

/**
 * The farthest a label's box may sit from its own route, in grid units.
 * A label with no clear spot that close shows only on hover.
 */
export const labelReachLimit = 1.5;

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
const labelSpot = ({
  points,
  text,
  avoid,
  reach,
  grow,
}: {
  readonly points: readonly ScreenPoint[];
  readonly text: string;
  readonly avoid: Obstacles;
  /** How far the label may sit from the route, in screen units. */
  readonly reach: number;
  /** How much the label's text is grown. */
  readonly grow: number;
}): LabelPlacement => {
  const size = { width: labelWidth(text, grow), height: labelHeight * grow };

  const legs: readonly Leg[] = Arr.map(segmentsOf(points), (segment) => ({
    ...segment,
    length: segmentLength(segment),
  }));

  const order = Order.combine(
    Order.mapInput(Order.Number, (leg: Leg) =>
      leg.length >= roomNeeded(leg, size) ? 0 : 1
    ),
    Order.combine(
      Order.mapInput(Order.Number, (leg: Leg) => -leg.length),
      Order.mapInput(Order.Number, (leg: Leg) => leg.index)
    )
  );

  const sorted = Arr.sort(legs, order);

  const candidates = Arr.flatMap(sorted, (leg: Leg) =>
    Arr.flatMap(labelShares, (share) => {
      const { beside, on } = spotsAt(leg, share, size);

      return [...beside, on];
    })
  );

  const spot = Option.getOrUndefined(
    Arr.findFirst(
      candidates,
      (rect) =>
        labelGap(points, rect) <= reach &&
        clearOf(rectPolygon(growRect(rect, labelClearance)), avoid)
    )
  );

  const [longest] = sorted;

  const fallback =
    longest === undefined ? undefined : spotsAt(longest, 0.5, size).on;

  return { spot, fallback: spot ?? fallback };
};

/** Whether a name tag at a spot keeps clear of `around`. */
const tagClearIn = (around: Obstacles) => (spot: ScreenRect) =>
  clearOf(rectPolygon(growRect(spot, tagClearance)), around);

/** A box that gets a name tag. */
export interface TaggedBox {
  readonly placement: Placement;
  /** Everything the box draws, as a convex polygon. */
  readonly outline: readonly ScreenPoint[];
  readonly text: string;
}

/** What placing name tags is given, besides the boxes. */
interface TagPlacing {
  readonly boxes: readonly TaggedBox[];
  readonly chips?: readonly ScreenRect[] | undefined;
  readonly lines?: readonly Segment[] | undefined;
  readonly view?: View | undefined;
  readonly zoom?: number | undefined;
}

/**
 * Places each box's name tag at the size it's drawn at `zoom` (see
 * `textGrowthAt`), in `boxes`' order. A tag prefers the first spot that is
 * nearer its own box than any other, clear of the boxes, `chips`, `lines`
 * and the tags placed before it; then such a spot clear of all but the
 * lines; then those two again wherever it sits; then its first spot.
 * `moves` is false to keep every tag in its first spot.
 */
const placeTags = (
  { boxes, chips = [], lines = [], view = "iso", zoom = 1 }: TagPlacing,
  moves: boolean
): readonly ScreenRect[] => {
  const geometry = geometries[view];
  const grow = textGrowthAt(zoom).tag;

  const fixed = Arr.map(
    [
      ...Arr.map(boxes, ({ outline }) => outline),
      ...Arr.map(chips, rectPolygon),
    ],
    obstacle
  );

  const segments = Arr.map(lines, lineObstacle);

  return Arr.reduce(boxes, Arr.empty<ScreenRect>(), (done, box, index) => {
    const spots = geometry.tagSpots(box, tagSizeOf(box.text, grow));
    const [first = emptyRect] = spots;

    if (!moves) {
      return [...done, first];
    }

    const avoid = {
      shapes: [...fixed, ...Arr.map(done, (tag) => obstacle(rectPolygon(tag)))],
      lines: segments,
    };

    const ownBox = (spot: ScreenRect) =>
      Arr.every(
        boxes,
        (other, at) =>
          at === index ||
          gapBetween(spot, box.outline) <= gapBetween(spot, other.outline)
      );

    const shapesOnly = { ...avoid, lines: [] };

    const preferences = [
      (spot: ScreenRect) => ownBox(spot) && tagClearIn(avoid)(spot),
      (spot: ScreenRect) => ownBox(spot) && tagClearIn(shapesOnly)(spot),
      tagClearIn(avoid),
      tagClearIn(shapesOnly),
    ];

    // Each preference is tried over every spot before the next is.
    const tag = Option.getOrElse(
      Arr.reduce(preferences, Option.none<ScreenRect>(), (found, prefer) =>
        Option.orElse(found, () => Arr.findFirst(spots, prefer))
      ),
      () => first
    );

    return [...done, tag];
  });
};

/**
 * Where each box's name tag goes at `zoom`. At base size the Iso view keeps
 * every tag in its first spot, under the front corner, where `check` warns
 * about it; Plan view, and any view with grown text, moves tags to find room.
 */
export const placeNameTags = (placing: TagPlacing): readonly ScreenRect[] => {
  const view = placing.view ?? "iso";

  return placeTags(
    placing,
    geometries[view].tagPlacement === "first-clear" ||
      textGrowthAt(placing.zoom ?? 1).tag > 1
  );
};

/** Like `placeNameTags`, with tags looking for room even at base size. */
export const placeMovingNameTags = (
  placing: TagPlacing
): readonly ScreenRect[] => placeTags(placing, true);

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
  /** Which view to draw. Defaults to the Iso view. */
  readonly view?: View | undefined;
  /**
   * The zoom the view is drawn at on screen, so text is placed at the size
   * it's drawn: zoomed out, each kind of text grows to stay readable (see
   * `textGrowthAt`). Defaults to 1, at which nothing grows, as `check`
   * measures.
   */
  readonly zoom?: number | undefined;
}

/** A hop that has a route, with its route on screen. */
interface RoutedHop {
  readonly hop: Hop;
  readonly route: HopRoute;
  readonly points: readonly ScreenPoint[];
}

interface Frame {
  readonly geometry: ViewGeometry;
  readonly growth: TextGrowth;
  readonly structures: readonly SceneStructure[];
  readonly outlines: readonly (readonly ScreenPoint[])[];
  readonly chips: readonly (readonly ScreenPoint[])[];
  readonly routed: readonly RoutedHop[];
  readonly lines: readonly {
    readonly id: string;
    readonly segments: readonly LineObstacle[];
  }[];
  readonly allLines: readonly LineObstacle[];
  readonly zoneList: readonly Zone[];
}

/** What a scene is built on: boxes with tags and chips, and routes. */
const frameOf = ({
  data,
  layout,
  revealed,
  routes = routeRevealed({ data, layout, revealed }),
  view = "iso",
  zoom = 1,
}: SceneSource): Frame => {
  const geometry = geometries[view];
  const growth = textGrowthAt(zoom);

  const boxes = Arr.flatMap(data.structures, (structure) => {
    const placement = layout.structures[structure.id];

    if (placement === undefined || !revealed.has(structure.id)) {
      return [];
    }

    const outline = geometry.outline(placement, structure.shape);

    return [
      {
        structure,
        placement,
        outline,
        bounds: boundsOfPoints(outline),
        chip: geometry.chip(structure, placement, growth.chip),
      },
    ];
  });

  const outlines = Arr.map(boxes, ({ outline }) => outline);

  // A grown chip that reaches over another box doesn't fit, and is left out.
  const fitted = Arr.map(boxes, (item, index) =>
    item.chip === undefined ||
    growth.chip === 1 ||
    Arr.every(
      outlines,
      (other, at) =>
        at === index ||
        !convexOverlap(rectPolygon(item.chip ?? emptyRect), other)
    )
      ? item
      : { ...item, chip: undefined }
  );

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

  const chips = Arr.flatMap(fitted, ({ chip }) =>
    chip === undefined ? [] : [rectPolygon(chip)]
  );

  const tags = placeNameTags({
    boxes: Arr.map(fitted, (item) => ({
      ...item,
      text: nameTagText(item.structure),
    })),
    chips: Arr.flatMap(fitted, ({ chip }) =>
      chip === undefined ? [] : [chip]
    ),
    lines: allLines,
    view,
    zoom,
  });

  const tagged = Arr.map(fitted, (item, index) => ({
    ...item,
    tag: tags[index] ?? emptyRect,
  }));

  const structures = geometry.order(tagged);

  return {
    geometry,
    growth,
    structures,
    outlines,
    chips,
    routed,
    lines,
    allLines,
    zoneList: zonesOf({ data, layout, revealed }),
  };
};

/**
 * The scene's bare drawing, `frame`: the boxes with their tags and chips,
 * the zones as plates and the hops as routes, with no zone titles, hop
 * labels or hidden stretches. It places quickly, so callers can try many
 * zooms to see where tags go and how far the drawing reaches.
 */
export const tagScene = (source: SceneSource): Scene => {
  const { geometry, growth, structures, routed, zoneList } = frameOf(source);

  return {
    view: source.view ?? "iso",
    growth,
    structures,
    zones: Arr.map(zoneList, (zone) => {
      const plate = geometry.plate(zone);

      return {
        zone,
        plate,
        bounds: boundsOfPoints(plate),
        titleAt: undefined,
        title: undefined,
        titleTransform: undefined,
      };
    }),
    hops: Arr.map(routed, (item) => ({
      ...item,
      label: undefined,
      hoverLabel: undefined,
      hidden: [],
    })),
  };
};

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
export const sceneOf = (source: SceneSource): Scene => {
  const { labelFirst = [], view = "iso" } = source;

  const {
    geometry,
    growth,
    structures,
    outlines,
    chips,
    routed,
    lines,
    allLines,
    zoneList,
  } = frameOf(source);

  const tagsAndChips = [
    ...Arr.map(structures, ({ tag }) => rectPolygon(tag)),
    ...chips,
  ];

  const zones = placeZones({
    zones: zoneList,
    avoid: {
      shapes: Arr.map([...outlines, ...tagsAndChips], obstacle),
      lines: allLines,
    },
    geometry,
    grow: growth.title,
  });

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
      const { spot, fallback } = labelSpot({
        points: item.points,
        text: item.hop.label,
        avoid: {
          shapes: [
            ...fixed,
            ...Arr.flatMap(done, ({ label }) =>
              label === undefined ? [] : [obstacle(rectPolygon(label))]
            ),
          ],
          lines: Arr.flatMap(lines, ({ id, segments }) =>
            id === item.hop.id ? [] : segments
          ),
        },
        reach: labelReachLimit * groundUnit[view],
        grow: growth.label,
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

  return { view, growth, structures, zones, hops };
};

/** One way a scene breaks the overlap rule. */
export interface SceneClash {
  /** What's drawn over what, such as `["tag:a", "box:b"]`. */
  readonly between: readonly [string, string];
  /** The same two things, by kind and the id of what they belong to. */
  readonly parts: readonly [ClashPart, ClashPart];
}

/** One side of a clash. */
export interface ClashPart {
  readonly kind: "box" | "tag" | "chip" | "title" | "label" | "route";
  /** The structure, group or hop it belongs to. */
  readonly id: string;
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
      t: arrowLength / Math.max(length, tiny),
    }),
  };
};

interface Shape2d extends ClashPart {
  readonly polygon: readonly ScreenPoint[];
}

const rectShape = (part: ClashPart, rect: ScreenRect): Shape2d => ({
  ...part,
  polygon: rectPolygon(rect),
});

/** A shape's name in a clash, such as `tag:a`. */
const nameOf = ({ kind, id }: ClashPart) => `${kind}:${id}`;

const clashOf = (first: ClashPart, second: ClashPart): SceneClash => ({
  between: [nameOf(first), nameOf(second)],
  parts: [first, second],
});

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
    kind: "box" as const,
    id: structure.id,
    polygon: outline,
    owner: structure.id,
  }));

  const text = [
    ...Arr.map(scene.structures, ({ structure, tag }) => ({
      ...rectShape({ kind: "tag", id: structure.id }, tag),
      owner: structure.id,
    })),
    ...Arr.flatMap(scene.structures, ({ structure, chip }) =>
      chip === undefined
        ? []
        : [
            {
              ...rectShape({ kind: "chip", id: structure.id }, chip),
              owner: structure.id,
            },
          ]
    ),
    ...Arr.flatMap(scene.zones, ({ zone, title }) =>
      title === undefined
        ? []
        : [
            {
              kind: "title" as const,
              id: zone.group.id,
              polygon: title,
              owner: "",
            },
          ]
    ),
    ...Arr.flatMap(scene.hops, ({ hop, label }) =>
      label === undefined
        ? []
        : [
            {
              ...rectShape({ kind: "label", id: hop.id }, label),
              owner: "",
            },
          ]
    ),
  ];

  const solids = [...boxes, ...text];

  const pairs = Arr.flatMap(solids, (first, index) =>
    Arr.flatMap(solids.slice(index + 1), (second) => {
      const ownChip =
        first.owner !== "" &&
        first.owner === second.owner &&
        (first.kind === "chip" || second.kind === "chip");

      return !ownChip && convexOverlap(first.polygon, second.polygon)
        ? [clashOf(first, second)]
        : [];
    })
  );

  const crossings = Arr.flatMap(scene.hops, ({ hop, points }) =>
    Arr.flatMap(text, (shape) =>
      (shape.kind === "label" && shape.id === hop.id) ||
      shape.kind === "chip" ||
      !Arr.some(segmentsOf(points), (segment) =>
        segmentCrosses(segment, shape.polygon)
      )
        ? []
        : [clashOf({ kind: "route", id: hop.id }, shape)]
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
