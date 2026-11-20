import { Array as Arr, Option, Order, Record as Rec } from "effect";
import { dual } from "effect/Function";

import { arrowHalfWidth } from "./ends.ts";
import { drawnRoutes } from "./fans.ts";
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
import { laneGap, laneRoutes, laneWidths, routeCorners } from "./lanes.ts";
import type { GridPoint, Layout, Placement } from "./layout.ts";
import type { Hop, MapData, Shape, Structure } from "./map-data.ts";
import {
  groundProjections,
  planRect,
  planTagSpots,
  planUnit,
  projectPlan,
} from "./plan.ts";
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
  /** The smallest rect holding `outline`. */
  readonly bounds: ScreenRect;
  /** The code chip's box, or `undefined` when the top has no room for it. */
  readonly chip: ScreenRect | undefined;
  /**
   * The outline of everything the shape draws, as a convex polygon: in the
   * Iso view its silhouette to its iso height, in Plan view its footprint's
   * rectangle, halo included.
   */
  readonly outline: ReadonlyArray<ScreenPoint>;
  readonly placement: Placement;
  readonly structure: Structure;
  readonly tag: ScreenRect;
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
  /** The smallest rect holding `plate`: in Plan view, the plate itself. */
  readonly bounds: ScreenRect;
  /**
   * The plate's ground corners: in the Iso view back, right, front and left;
   * in Plan view clockwise from the top left.
   */
  readonly plate: ReadonlyArray<ScreenPoint>;
  /** The title's outline on screen, skewed along the edge it lies on. */
  readonly title: ReadonlyArray<ScreenPoint> | undefined;
  /**
   * Where the title's baseline starts, or `undefined` when no spot on the
   * plate is clear and the title is left out.
   */
  readonly titleAt: ScreenPoint | undefined;
  /** The SVG transform that skews the title's text onto its edge. */
  readonly titleTransform: string | undefined;
  readonly zone: Zone;
}

/** A stretch of a route that a box is drawn over. */
export interface HiddenStretch {
  readonly points: ReadonlyArray<ScreenPoint>;
  /**
   * Whether the stretch runs to the route's end, which is hidden under a
   * box, so the stretch carries a faint arrowhead. At most one stretch of a
   * hop does.
   */
  readonly reachesEnd: boolean;
}

/** How tall a hop label's box is, in screen units. */
const labelHeight = textSizes.label.height;

/** Room either side of a label's text, in screen units. */
const labelPadding = 3;

/** One hop as a view draws it. */
export interface SceneHop {
  /**
   * Where the route turns, which the Iso view marks with diamonds: one per
   * turn a bundle's hops share, drawn by the first of them, and none for the
   * jogs that spread its ends along an edge or for any turn within a unit of
   * either end.
   */
  readonly bends: ReadonlyArray<ScreenPoint>;
  /**
   * The stretches of the route that boxes are drawn over and that the view
   * redraws faintly on top: those under other structures' boxes, and the
   * last stretch under the target's box when the end is there. The stretch
   * that reaches a hidden end carries a faint arrowhead, so every hop shows
   * one head, solid where its end is visible and faint where it is not.
   */
  readonly hidden: ReadonlyArray<HiddenStretch>;
  readonly hop: Hop;
  /** Where the label shows on hover or when its packet is selected. */
  readonly hoverLabel: ScreenRect | undefined;
  /**
   * Where the label goes, or `undefined` when no clear spot at the route
   * exists. A hop without a spot shows its label only on hover or while its
   * packet is selected, at `hoverLabel`.
   */
  readonly label: ScreenRect | undefined;
  /**
   * The hop's own line on screen, from the source's edge to the target's
   * edge: its route, moved sideways into its own lane where it runs on the
   * same grid line as another route, so no two hops' lines coincide.
   */
  readonly points: ReadonlyArray<ScreenPoint>;
  readonly route: HopRoute;
}

/** Everything a view draws for one set of revealed structures. */
export interface Scene {
  /** How much the text is grown, from the zoom the scene is drawn for. */
  readonly growth: TextGrowth;
  /** In data.mjs order. */
  readonly hops: ReadonlyArray<SceneHop>;
  /** In painter's order: every box after the boxes it stands in front of. */
  readonly structures: ReadonlyArray<SceneStructure>;
  readonly view: View;
  readonly zones: ReadonlyArray<SceneZone>;
  /**
   * The zoom the scene is drawn for. The view's own scale is never below it,
   * so a length of `n` screen pixels is at most `n / zoom` drawing units.
   */
  readonly zoom: number;
}

/** The width of a hop label's box for `text`, in screen units. */
const labelWidth = (text: string, grow: number) =>
  (text.length * tagCharWidth + 2 * labelPadding) * grow;

const centreOf = ({ d, w, x, y }: Placement, z: number) =>
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
        bottom: box.top + planChipInset + chipHeight * grow,
        left,
        right: left + width,
        top: box.top + planChipInset,
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
        bottom: at.sy + height / 2,
        left: at.sx - width / 2,
        right: at.sx + width / 2,
        top: at.sy - height / 2,
      };
};

/** The full silhouette a shape draws, halo included. */
export const silhouette: {
  (shape: Shape): (placement: Placement) => ReadonlyArray<ScreenPoint>;
  (placement: Placement, shape: Shape): ReadonlyArray<ScreenPoint>;
} = dual(
  2,
  (placement: Placement, shape: Shape): ReadonlyArray<ScreenPoint> => {
    const by = overhang[shape] ?? 0;

    if (by === 0) {
      return boxOutline(placement, shape);
    }

    const grown = {
      d: placement.d + 2 * by,
      w: placement.w + 2 * by,
      x: placement.x - by,
      y: placement.y - by,
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
  }
);

/** The rectangle a shape draws in Plan view, halo included. */
const planOutline = (
  placement: Placement,
  shape: Shape
): ReadonlyArray<ScreenPoint> => {
  const by = overhang[shape] ?? 0;

  return rectPolygon(
    planRect({
      d: placement.d + 2 * by,
      w: placement.w + 2 * by,
      x: placement.x - by,
      y: placement.y - by,
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
  items: ReadonlyArray<SceneStructure>
): ReadonlyArray<SceneStructure> => {
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
  { along, start }: Pick<TitleSpot, "start" | "along">,
  { grow, width }: TitleSize,
  margin: number
): ReadonlyArray<ScreenPoint> => {
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

const plateOf = (zone: Zone): ReadonlyArray<ScreenPoint> => {
  const { back, front, left, right } = corners(zone.box, 0);

  return [back, right, front, left];
};

const planPlateOf = (zone: Zone): ReadonlyArray<ScreenPoint> =>
  rectPolygon(planRect(zone.box));

/** Whether every point is inside a convex polygon, edges included. */
const insideConvex = (
  polygon: ReadonlyArray<ScreenPoint>,
  points: ReadonlyArray<ScreenPoint>
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
  readonly grow: number;
  readonly width: number;
}

/** Where a title's baseline starts and the way it runs. */
interface TitleSpot {
  readonly along: ScreenPoint;
  /** Whether the spot is outside the plate, below its edge. */
  readonly outside: boolean;
  readonly start: ScreenPoint;
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
const titleSpots = (zone: Zone, size: TitleSize): ReadonlyArray<TitleSpot> => {
  const { back, front, left } = corners(zone.box, 0);
  const wide = zone.box.w * gridOnScreen;
  const deep = zone.box.d * gridOnScreen;

  const fronts = [
    { along: alongX, inward: 1, length: wide, room: wide, start: left },
    { along: upFrontRight, inward: 1, length: deep, room: deep, start: front },
  ];

  const backs = [
    { along: upFrontRight, inward: -1, length: deep, room: deep, start: left },
    { along: alongX, inward: -1, length: wide, room: wide, start: back },
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
const planTitleSpots = (
  zone: Zone,
  size: TitleSize
): ReadonlyArray<TitleSpot> => {
  const plate = planRect(zone.box);
  // Titles keep off the plate's rounded corners.
  const wide = plate.right - plate.left - 2 * planZoneRadius;
  const deep = plate.bottom - plate.top;
  const topLeft = { sx: plate.left + planZoneRadius, sy: plate.top };
  const bottomLeft = { sx: plate.left + planZoneRadius, sy: plate.bottom };

  const tops = [
    { along: across, inward: -1, length: wide, room: deep, start: topLeft },
  ];

  const bottoms = [
    { along: across, inward: 1, length: wide, room: deep, start: bottomLeft },
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
  readonly along: ScreenPoint;
  /** +1 when the plate lies above the edge on screen. */
  readonly inward: number;
  readonly length: number;
  /** How far into the plate titles may move off the edge, doubled. */
  readonly room: number;
  readonly start: ScreenPoint;
}

/**
 * Title spots along `edges`: on the plate's strip by each edge, or just
 * outside it. On each, spots nearest the edge come first.
 */
const spotsBy = (
  edges: ReadonlyArray<TitleEdge>,
  { grow, width }: TitleSize,
  outside: boolean
): ReadonlyArray<TitleSpot> =>
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
          along: edge.along,
          outside,
          start: {
            sx: edge.start.sx + run * edge.along.sx,
            sy: edge.start.sy + run * edge.along.sy - lift,
          },
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
const transformOf = ({ along, start }: TitleSpot, grow: number) =>
  `matrix(${along.sx * grow} ${along.sy * grow} 0 ${grow} ${start.sx} ${start.sy})`;

/** Something text must keep clear of, with its bounds for a quick test. */
interface Obstacle {
  readonly bounds: ScreenRect;
  readonly polygon: ReadonlyArray<ScreenPoint>;
}

interface LineObstacle extends Segment {
  readonly bounds: ScreenRect;
}

/** What text must keep clear of. */
interface Obstacles {
  /** Route segments. */
  readonly lines: ReadonlyArray<LineObstacle>;
  /** Boxes, zone titles, plates of other zones, tags, chips and labels. */
  readonly shapes: ReadonlyArray<Obstacle>;
}

const obstacle = (polygon: ReadonlyArray<ScreenPoint>): Obstacle => ({
  bounds: boundsOfPoints(polygon),
  polygon,
});

const lineObstacle = (segment: Segment): LineObstacle => ({
  ...segment,
  bounds: boundsOfPoints([segment.start, segment.end]),
});

/** Whether `rect` lies inside `bounds`. */
const isInside = (rect: ScreenRect, bounds: ScreenRect) =>
  rect.left >= bounds.left &&
  rect.right <= bounds.right &&
  rect.top >= bounds.top &&
  rect.bottom <= bounds.bottom;

/** Whether two bounds share area or touch. */
const boundsMeet = (a: ScreenRect, b: ScreenRect) =>
  a.left <= b.right &&
  b.left <= a.right &&
  a.top <= b.bottom &&
  b.top <= a.bottom;

const clearOf = (polygon: ReadonlyArray<ScreenPoint>, avoid: Obstacles) => {
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
  polygons: ReadonlyArray<ReadonlyArray<ScreenPoint>>
): Obstacles => ({
  ...avoid,
  shapes: [...avoid.shapes, ...Arr.map(polygons, obstacle)],
});

/** A spot a label may take, and what it offers. */
interface AssessedSpot {
  /** The most clearance it keeps from other text, boxes and routes. */
  readonly clearance: number;
  /** How much nearer it sits to its own route than to any other. */
  readonly margin: number;
  readonly rect: ScreenRect;
}

/** What differs between the Iso view and Plan view. */
interface ViewGeometry {
  readonly chip: (
    structure: ChipSource,
    placement: Placement,
    grow: number
  ) => ScreenRect | undefined;
  /** Puts the structures in the order they're drawn. */
  readonly order: (
    items: ReadonlyArray<SceneStructure>
  ) => ReadonlyArray<SceneStructure>;
  readonly outline: (
    placement: Placement,
    shape: Shape
  ) => ReadonlyArray<ScreenPoint>;
  readonly plate: (zone: Zone) => ReadonlyArray<ScreenPoint>;
  readonly project: (point: GridPosition) => ScreenPoint;
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
  ) => ReadonlyArray<ScreenRect>;
  readonly titleSpots: (
    zone: Zone,
    size: TitleSize
  ) => ReadonlyArray<TitleSpot>;
}

/** How long one grid unit is on screen, in each view. */
const groundUnit: Readonly<Record<View, number>> = {
  iso: gridOnScreen,
  plan: planUnit,
};

/** A name tag's size for `text`, grown by `grow`. */
const tagSizeOf = (text: string, grow: number): TagSize => ({
  height: textSizes.tag.height * grow,
  width: (text.length * tagCharWidth + tagPadding) * grow,
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
  { outline, placement }: Pick<SceneStructure, "placement" | "outline">,
  { height, width }: TagSize
): ReadonlyArray<ScreenRect> => {
  const ground = corners(placement, 0);
  const under = ground.front.sy + tagOffset;
  const shifts = slideOffsets(width / 2);

  const rectAt = (left: number, top: number): ScreenRect => ({
    bottom: top + height,
    left,
    right: left + width,
    top,
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
    chip: chipRect,
    order: paintOrder,
    outline: silhouette,
    plate: plateOf,
    project,
    tagPlacement: "fixed",
    tagSpots: isoTagSpots,
    titleSpots,
  },
  plan: {
    chip: planChipRect,
    order: (items) => items,
    outline: planOutline,
    plate: planPlateOf,
    project: projectPlan,
    tagPlacement: "first-clear",
    tagSpots: ({ outline }, size) =>
      planTagSpots(boundsOfPoints(outline), size),
    titleSpots: planTitleSpots,
  },
};

/**
 * Places every zone's title along one of its plate's front edges, in the
 * first spot clear of `avoid`, the other plates and the titles placed
 * before it. A title with no clear spot is left out.
 */
const placeZones = ({
  avoid,
  geometry,
  grow,
  zones,
}: {
  readonly avoid: Obstacles;
  readonly geometry: ViewGeometry;
  /** How much the titles' text is grown. */
  readonly grow: number;
  readonly zones: ReadonlyArray<Zone>;
}): ReadonlyArray<SceneZone> => {
  const plates = Arr.map(zones, geometry.plate);

  return Arr.reduce(zones, Arr.empty<SceneZone>(), (done, zone, index) => {
    const plate = plates[index] ?? geometry.plate(zone);

    const size = {
      grow,
      width: zone.group.title.length * titleCharWidth * grow,
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
          bounds: boundsOfPoints(plate),
          plate,
          title: undefined,
          titleAt: undefined,
          titleTransform: undefined,
          zone,
        }),
        onSome: (found) => ({
          bounds: boundsOfPoints(plate),
          plate,
          title: titleQuad(found, size, 0),
          titleAt: found.start,
          titleTransform: transformOf(found, size.grow),
          zone,
        }),
      }),
    ];
  });
};

/** A hop's turns on the ground, as its grid corners and its laned ones. */
interface Turning {
  readonly corners: ReadonlyArray<GridPoint>;
  readonly id: string;
  readonly laned: ReadonlyArray<GridPosition>;
}

/**
 * The turns the Iso view marks with a diamond, by hop id. Hops that turn the
 * same way at the same grid corner, as the lanes of a bundle do, share one
 * diamond: the first of them draws it, on the middle of their lanes. A lone
 * hop's diamond sits on its own line. Turns within `bendMargin` of either
 * end of a route get none.
 */
const turnsOf = ({
  hops,
}: {
  readonly hops: ReadonlyArray<Turning>;
}): ReadonlyMap<string, ReadonlyArray<GridPosition>> => {
  const turns = Arr.flatMap(hops, ({ corners: grid, id, laned }) => {
    const [first] = grid;
    const last = grid.at(-1);

    return Arr.flatMap(grid.slice(1, -1), (corner, index) => {
      const at = laned[index + 1];
      const before = grid[index];
      const after = grid[index + 2];

      return first === undefined ||
        last === undefined ||
        at === undefined ||
        before === undefined ||
        after === undefined ||
        Math.hypot(corner.x - first.x, corner.y - first.y) < bendMargin ||
        Math.hypot(corner.x - last.x, corner.y - last.y) < bendMargin
        ? []
        : [
            {
              at,
              id,
              key: `${Arr.join(
                Arr.sort(
                  [
                    `${Math.sign(before.x - corner.x)},${Math.sign(before.y - corner.y)}`,
                    `${Math.sign(after.x - corner.x)},${Math.sign(after.y - corner.y)}`,
                  ],
                  Order.String
                ),
                "|"
              )}@${corner.x},${corner.y}`,
            },
          ];
    });
  });

  const groups = Arr.groupBy(turns, ({ key }) => key);

  return new Map(
    Arr.map(hops, ({ id }) => [
      id,
      Arr.flatMap(Rec.values(groups), (group) => {
        const [owner] = group;

        return owner?.id === id
          ? [
              {
                x:
                  Arr.reduce(group, 0, (sum, { at }) => sum + at.x) /
                  group.length,
                y:
                  Arr.reduce(group, 0, (sum, { at }) => sum + at.y) /
                  group.length,
              },
            ]
          : [];
      }),
    ])
  );
};

/** How far from a route's end a bend must be to get a diamond, in grid units. */
const bendMargin = 1;

/** Stretches shorter than this, in screen units, aren't worth redrawing. */
const shortestStretch = 1;

interface Piece {
  readonly a: ScreenPoint;
  readonly b: ScreenPoint;
  readonly from: number;
  readonly leg: number;
  readonly to: number;
}

interface Stretch {
  readonly last: Piece;
  readonly points: ReadonlyArray<ScreenPoint>;
}

const byStart = Order.mapInput(
  Order.Number,
  ({ from }: { readonly from: number }) => from
);

/** Merges overlapping intervals, in order. */
const merge = (
  intervals: ReadonlyArray<{ readonly from: number; readonly to: number }>
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
const joinPieces = (pieces: ReadonlyArray<Piece>) =>
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
          { last: piece, points: [...last.points, piece.b] },
        ]
      : [...stretches, { last: piece, points: [piece.a, piece.b] }];
  });

/**
 * The stretches of a route on the ground that boxes are drawn over: the
 * parts of its polyline inside a box's outline. Routes are drawn on the
 * ground before every box, so in the painter's order any box whose outline
 * reaches over a stretch hides it.
 */
const hiddenStretches = ({
  outlines,
  points,
}: {
  readonly outlines: ReadonlyArray<ReadonlyArray<ScreenPoint>>;
  readonly points: ReadonlyArray<ScreenPoint>;
}): ReadonlyArray<HiddenStretch> => {
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
              a: lerp({ from: segment.start, t: from, to: segment.end }),
              b: lerp({ from: segment.start, t: to, to: segment.end }),
              from,
              leg: segment.index,
              to,
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

const farthestLabelGap = Math.max(...labelGaps);

/**
 * Every gap a label of `height` may keep from its leg within `reach`: the
 * `labelGaps`, then one label height further at a time.
 */
const gapsWithin = (reach: number, height: number) => [
  ...labelGaps,
  ...Arr.makeBy(
    Math.max(Math.floor((reach - farthestLabelGap) / height), 0),
    (step) => farthestLabelGap + (step + 1) * height
  ),
];

/** Clear space a label keeps from everything but its own line. */
const labelClearance = 3;

/**
 * The clear space a label keeps, tried in turn: a label with no spot at one
 * keeps less, down to touching, before it hides.
 */
const labelClearances = [labelClearance, 1, 0] as const;

const leastFirst = Arr.reverse(labelClearances);

/**
 * How much nearer a label's box sits to its own route than to any other,
 * tried in turn so the reader can tell whose it is: a label's height, then
 * `labelClearance`, then no farther.
 */
const labelOwnMargins = (height: number) => [height, labelClearance, 0];

/**
 * Whether a view lets a label with no spot nearer its own route than any
 * other take one that isn't, if it is clear of every box, text and route.
 * The Iso view does, because its crowded maps would hide many more labels
 * otherwise. Plan view never does, because there the reader would have to
 * guess whose label it is.
 */
const labelMayBeNearerAnother: Readonly<Record<View, boolean>> = {
  iso: true,
  plan: false,
};

/** Clear space a name tag in Plan view keeps from everything else. */
const tagClearance = 2;

/** A leg is divided into this many steps for where a label may sit on it. */
const shareSteps = 20;

/** How many steps in from a leg's end the nearest label centre sits. */
const shareInset = 2;

/** How many steps past a leg's end a label's centre may go, with an overhang. */
const shareOverhang = 12;

/**
 * Where along a leg a label may sit, as a share of its length, the middle
 * first and then outwards. With an overhang a share may fall outside the
 * leg, which puts the label beside the route's previous or next leg.
 */
const labelShares = ({
  overhangAfter,
  overhangBefore,
}: {
  readonly overhangAfter: boolean;
  readonly overhangBefore: boolean;
}) =>
  Arr.sort(
    Arr.map(
      Arr.range(
        overhangBefore ? shareInset - shareOverhang : shareInset,
        shareSteps - (overhangAfter ? shareInset - shareOverhang : shareInset)
      ),
      (step) => step / shareSteps
    ),
    Order.mapInput(Order.Number, (share: number) => Math.abs(share - 0.5))
  );

interface Leg extends Segment {
  readonly index: number;
  readonly length: number;
}

/** The rect of `size` centred on `centre`. */
const rectAround = (centre: ScreenPoint, { height, width }: TagSize) => ({
  bottom: centre.sy + height / 2,
  left: centre.sx - width / 2,
  right: centre.sx + width / 2,
  top: centre.sy - height / 2,
});

/**
 * The spots a label of `size` may take at a point `share` of the way along
 * a leg: beside it, its centre on the leg's perpendicular with its nearest
 * edge one of `gaps` from the line, on either side, and straight above and
 * below it.
 */
const spotsBeside = (
  { leg, share }: { readonly leg: Leg; readonly share: number },
  size: TagSize,
  gaps: ReadonlyArray<number>
) => {
  const { height: tall, width } = size;
  const at = lerp({ from: leg.start, t: share, to: leg.end });
  const unit = Math.max(leg.length, tiny);

  const normal = {
    sx: -(leg.end.sy - leg.start.sy) / unit,
    sy: (leg.end.sx - leg.start.sx) / unit,
  };

  const halfDepth =
    (Math.abs(normal.sx) * width) / 2 + (Math.abs(normal.sy) * tall) / 2;

  // A leg's slope on screen, for the spots straight above and below it,
  // whose nearest corner sits `gap` from the line.
  const slope =
    (leg.end.sy - leg.start.sy) / (leg.end.sx - leg.start.sx || tiny);

  const upright = (gap: number, side: -1 | 1) => {
    // How far the label's centre sits above or below the line so that its
    // corner nearest the line clears it by `gap` along the vertical.
    const lift = tall / 2 + (Math.abs(slope) * width) / 2 + gap;

    return rectAround({ sx: at.sx, sy: at.sy + side * lift }, size);
  };

  const alongNormal = (offset: number) =>
    rectAround(
      { sx: at.sx + normal.sx * offset, sy: at.sy + normal.sy * offset },
      size
    );

  return [
    ...Arr.flatMap(gaps, (gap) => [
      alongNormal(-(halfDepth + gap)),
      alongNormal(halfDepth + gap),
    ]),
    // A vertical leg, which only Plan view draws, has no spots straight
    // above and below it; the spots beside it sit level with it.
    ...(leg.end.sx === leg.start.sx
      ? []
      : Arr.flatMap(gaps, (gap) => [upright(gap, -1), upright(gap, 1)])),
  ];
};

/** The spot of `size` centred on the middle of `leg`, for the hover fallback. */
const spotOnLeg = (leg: Leg, size: TagSize) =>
  rectAround(lerp({ from: leg.start, t: 0.5, to: leg.end }), size);

/** How far along itself a label of `width` reaches. */
const roomNeeded = (leg: Leg, { height, width }: TagSize) =>
  (Math.abs(leg.end.sx - leg.start.sx) * width +
    Math.abs(leg.end.sy - leg.start.sy) * height) /
  Math.max(leg.length, tiny);

/**
 * How far a label's box sits from its route, in screen units: from the
 * nearest point on the box's edge, 0 when the route runs through it.
 */
const labelGap: {
  (label: ScreenRect): (points: ReadonlyArray<ScreenPoint>) => number;
  (points: ReadonlyArray<ScreenPoint>, label: ScreenRect): number;
} = dual(2, (points: ReadonlyArray<ScreenPoint>, label: ScreenRect): number => {
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
 * The farthest a label's box may sit from its own route, in grid units. A
 * label with no clear spot that close shows only on hover.
 *
 * Plan view looks further than Iso, because a label there only takes a spot
 * nearer its own route than any other. Iso reaches the farthest of
 * `labelGaps` plus two label heights, and stays inside `within`.
 */
const labelReachLimit: Readonly<Record<View, number>> = {
  iso: (farthestLabelGap + 2 * labelHeight) / gridOnScreen,
  plan: 2.5,
};

/**
 * Whether a view lets a label sit past either end of a leg, beside the
 * route's next or previous leg. Only Plan view does, as the Iso view keeps
 * labels inside `within`.
 */
const labelMayOverhang: Readonly<Record<View, boolean>> = {
  iso: false,
  plan: true,
};

/** Where a hop's label goes, and whether it fits there. */
interface LabelPlacement {
  /** Where to show the label on hover: the clear spot or the best try. */
  readonly fallback: ScreenRect | undefined;
  /** The clear spot, or `undefined` when there's none. */
  readonly spot: ScreenRect | undefined;
}

/**
 * The first clear spot for a hop's label, or none. A spot sits beside the
 * route, within `reach` of it, off every route including its own, and clear
 * of `avoid`. Nearer spots come first. At each distance, legs long enough
 * for the label come before the rest, longer legs first, and on each leg
 * the spots nearest the middle come first.
 *
 * The search relaxes `labelClearances` and `labelOwnMargins` in turn before
 * it gives up. `mayBeNearerAnother` lets a label with no spot that is
 * nearer its own route take any clear one.
 */
const labelSpot = ({
  avoid,
  grow,
  mayBeNearerAnother,
  mayOverhang,
  points,
  reach,
  text,
  within,
}: {
  readonly avoid: Obstacles;
  /** How much the label's text is grown. */
  readonly grow: number;
  /** Whether the label may sit nearer another route than its own. */
  readonly mayBeNearerAnother: boolean;
  /** Whether the label may sit past either end of a leg. */
  readonly mayOverhang: boolean;
  readonly points: ReadonlyArray<ScreenPoint>;
  /** How far the label may sit from the route, in screen units. */
  readonly reach: number;
  readonly text: string;
  /**
   * The rect the label stays inside: the extent of everything but labels. A
   * label past it stretches the drawing, so the page fits it at a smaller
   * zoom and every other text grows.
   */
  readonly within: ScreenRect;
}): LabelPlacement => {
  const size = { height: labelHeight * grow, width: labelWidth(text, grow) };

  const legs: ReadonlyArray<Leg> = Arr.map(segmentsOf(points), (segment) => ({
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

  const ownRoute: Obstacles = {
    lines: Arr.map(legs, lineObstacle),
    shapes: [],
  };

  const otherShapes: Obstacles = { lines: [], shapes: avoid.shapes };
  const otherRoutes: Obstacles = { lines: avoid.lines, shapes: [] };

  const isClear = (rect: ScreenRect, clearance: number) => {
    const grown = rectPolygon(growRect(rect, clearance));

    return clearOf(grown, otherShapes) && clearOf(grown, otherRoutes);
  };

  const lastLegIndex = Math.max(...Arr.map(legs, (leg) => leg.index));

  const sharesOf = (leg: Leg) =>
    labelShares({
      overhangAfter: mayOverhang && leg.index < lastLegIndex,
      overhangBefore: mayOverhang && leg.index > 0,
    });

  const rects = function* () {
    for (const gap of gapsWithin(reach, size.height)) {
      for (const leg of sorted) {
        for (const share of sharesOf(leg)) {
          yield* spotsBeside({ leg, share }, size, [gap]);
        }
      }
    }
  };

  const assess = (rect: ScreenRect): Option.Option<AssessedSpot> => {
    const away = labelGap(points, rect);

    if (
      away > reach ||
      !isInside(rect, within) ||
      !clearOf(rectPolygon(rect), ownRoute)
    ) {
      return Option.none();
    }

    // Most spots fail the least clearance, so test upwards and stop there.
    const kept = Arr.takeWhile(leastFirst, (by) => isClear(rect, by));

    if (!Arr.isReadonlyArrayNonEmpty(kept)) {
      return Option.none();
    }

    const rivalArea = growRect(rect, away + size.height);

    const closestRival = Arr.reduce(
      avoid.lines,
      Number.POSITIVE_INFINITY,
      (closest, line) =>
        boundsMeet(rivalArea, line.bounds)
          ? Math.min(closest, labelGap([line.start, line.end], rect))
          : closest
    );

    return Option.some({
      clearance: Arr.lastNonEmpty(kept),
      margin: closestRival - away,
      rect,
    });
  };

  // Rects are assessed as the search reaches them, so a label that finds
  // room near its route never looks further.
  const candidates = rects();
  const assessed: Array<AssessedSpot> = [];

  const assessedAt = (index: number): Option.Option<AssessedSpot> => {
    while (assessed.length <= index) {
      const next = candidates.next();

      if (next.done === true) {
        return Option.none();
      }

      const assessment = assess(next.value);

      if (Option.isSome(assessment)) {
        assessed.push(assessment.value);
      }
    }

    return Option.fromNullishOr(assessed[index]);
  };

  const firstSpot = (wanted: Pick<AssessedSpot, "clearance" | "margin">) => {
    for (let index = 0; ; index += 1) {
      const next = assessedAt(index);

      if (Option.isNone(next)) {
        return Option.none<ScreenRect>();
      }

      const { clearance, margin, rect } = next.value;

      if (clearance >= wanted.clearance && margin >= wanted.margin) {
        return Option.some(rect);
      }
    }
  };

  const margins = mayBeNearerAnother
    ? [...labelOwnMargins(size.height), Number.NEGATIVE_INFINITY]
    : labelOwnMargins(size.height);

  const spot = Option.getOrUndefined(
    Arr.reduce(labelClearances, Option.none<ScreenRect>(), (soFar, clearance) =>
      Arr.reduce(margins, soFar, (earlier, margin) =>
        Option.orElse(earlier, () => firstSpot({ clearance, margin }))
      )
    )
  );

  const [longest] = sorted;

  const onLongest =
    longest === undefined ? undefined : spotOnLeg(longest, size);

  return { fallback: spot ?? onLongest, spot };
};

/** Whether a name tag at a spot keeps clear of `around`. */
const tagClearIn = (around: Obstacles) => (spot: ScreenRect) =>
  clearOf(rectPolygon(growRect(spot, tagClearance)), around);

/** A box that gets a name tag. */
export interface TaggedBox {
  /** Everything the box draws, as a convex polygon. */
  readonly outline: ReadonlyArray<ScreenPoint>;
  readonly placement: Placement;
  readonly text: string;
}

/** What placing name tags is given, besides the boxes. */
interface TagPlacing {
  readonly boxes: ReadonlyArray<TaggedBox>;
  readonly chips?: ReadonlyArray<ScreenRect> | undefined;
  readonly lines?: ReadonlyArray<Segment> | undefined;
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
): ReadonlyArray<ScreenRect> => {
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
      lines: segments,
      shapes: [...fixed, ...Arr.map(done, (tag) => obstacle(rectPolygon(tag)))],
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
export const placeNameTags = (
  placing: TagPlacing
): ReadonlyArray<ScreenRect> => {
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
): ReadonlyArray<ScreenRect> => placeTags(placing, true);

/** What a scene is computed from. */
export interface SceneSource {
  readonly data: MapData;
  /**
   * Hops whose labels are placed first, such as the hops the chapter plays,
   * in order. The rest follow in data.mjs order.
   */
  readonly labelFirst?: ReadonlyArray<string> | undefined;
  readonly layout: Layout;
  /** The structures drawn, such as those revealed so far. */
  readonly revealed: ReadonlySet<string>;
  /**
   * The routes, when the caller has them already. Defaults to the hops
   * routed around the revealed structures only.
   */
  readonly routes?: Readonly<Record<string, HopRoute>> | undefined;
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
  readonly bends: ReadonlyArray<ScreenPoint>;
  readonly hop: Hop;
  readonly points: ReadonlyArray<ScreenPoint>;
  readonly route: HopRoute;
}

interface Frame {
  readonly allLines: ReadonlyArray<LineObstacle>;
  readonly chips: ReadonlyArray<ReadonlyArray<ScreenPoint>>;
  readonly geometry: ViewGeometry;
  readonly growth: TextGrowth;
  readonly lines: ReadonlyArray<{
    readonly id: string;
    readonly segments: ReadonlyArray<LineObstacle>;
  }>;
  readonly outlines: ReadonlyArray<ReadonlyArray<ScreenPoint>>;
  readonly routed: ReadonlyArray<RoutedHop>;
  readonly structures: ReadonlyArray<SceneStructure>;
  readonly zoneList: ReadonlyArray<Zone>;
  readonly zoom: number;
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
        bounds: boundsOfPoints(outline),
        chip: geometry.chip(structure, placement, growth.chip),
        outline,
        placement,
        structure,
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

  const shown = Arr.filter(
    data.hops,
    (hop) =>
      routes[hop.id] !== undefined &&
      revealed.has(hop.from) &&
      revealed.has(hop.to)
  );

  const drawn = drawnRoutes({
    hops: shown,
    placements: layout.structures,
    routes: Rec.fromEntries(
      Arr.flatMap(shown, ({ id }) => {
        const route = routes[id];

        return route === undefined ? [] : [[id, route] as const];
      })
    ),
    view,
  });

  const bent = laneRoutes(
    Rec.fromEntries(
      Arr.flatMap(shown, ({ id }) => {
        const route = routes[id];

        return route === undefined ? [] : [[id, route] as const];
      })
    ),
    laneWidths[view]
  );

  const turns = turnsOf({
    hops: Arr.flatMap(shown, ({ id }) => {
      const route = routes[id];

      return route === undefined
        ? []
        : [{ corners: routeCorners(route.points), id, laned: bent[id] ?? [] }];
    }),
  });

  const routed = Arr.flatMap(shown, (hop) => {
    const route = routes[hop.id];

    return route === undefined
      ? []
      : [
          {
            bends: Arr.map(turns.get(hop.id) ?? [], geometry.project),
            hop,
            points: Arr.map(drawn[hop.id] ?? route.points, geometry.project),
            route,
          },
        ];
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
    allLines,
    chips,
    geometry,
    growth,
    lines,
    outlines,
    routed,
    structures,
    zoneList: zonesOf({ data, layout, revealed }),
    zoom,
  };
};

/**
 * The scene's bare drawing, `frame`: the boxes with their tags and chips,
 * the zones as plates and the hops as routes, with no zone titles, hop
 * labels or hidden stretches. It places quickly, so callers can try many
 * zooms to see where tags go and how far the drawing reaches.
 */
export const tagScene = (source: SceneSource): Scene => {
  const { geometry, growth, routed, structures, zoneList, zoom } =
    frameOf(source);

  return {
    growth,
    hops: Arr.map(routed, (item) => ({
      ...item,
      hidden: [],
      hoverLabel: undefined,
      label: undefined,
    })),
    structures,
    view: source.view ?? "iso",
    zones: Arr.map(zoneList, (zone) => {
      const plate = geometry.plate(zone);

      return {
        bounds: boundsOfPoints(plate),
        plate,
        title: undefined,
        titleAt: undefined,
        titleTransform: undefined,
        zone,
      };
    }),
    zoom,
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
    allLines,
    chips,
    geometry,
    growth,
    lines,
    outlines,
    routed,
    structures,
    zoneList,
    zoom,
  } = frameOf(source);

  const tagsAndChips = [
    ...Arr.map(structures, ({ tag }) => rectPolygon(tag)),
    ...chips,
  ];

  const zones = placeZones({
    avoid: {
      lines: allLines,
      shapes: Arr.map([...outlines, ...tagsAndChips], obstacle),
    },
    geometry,
    grow: growth.title,
    zones: zoneList,
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
    Arr.map(structures, ({ outline, structure }) => [structure.id, outline])
  );

  // A route is drawn behind its own source box where it leaves a back edge,
  // which reads as leaving from behind, so that stretch isn't redrawn. Over
  // the target box only the stretch that reaches the route's end is
  // redrawn. Routes are drawn under every box, so a solid head whose tip is
  // inside a box's outline is hidden; the stretch that reaches the end then
  // carries a faint head, once. A head on a visible edge is solid already.
  const hiddenOf = (hop: Hop, points: ReadonlyArray<ScreenPoint>) => {
    const others = Arr.flatMap(structures, ({ outline, structure }) =>
      structure.id === hop.from || structure.id === hop.to ? [] : [outline]
    );

    const target = outlineOf.get(hop.to);

    const atHead =
      target === undefined
        ? []
        : Arr.filter(
            hiddenStretches({ outlines: [target], points }),
            ({ reachesEnd }) => reachesEnd
          );

    const stretches = [
      ...hiddenStretches({ outlines: others, points }),
      ...atHead,
    ];

    const carrier = Arr.findLastIndex(
      stretches,
      ({ reachesEnd }) => reachesEnd
    );

    return Arr.map(stretches, (stretch, index) => ({
      ...stretch,
      reachesEnd: Option.contains(carrier, index),
    }));
  };

  const drawnExtent = boundsOfPoints([
    ...Arr.flatMap(structures, ({ outline, tag }) => [
      ...outline,
      ...rectPolygon(tag),
    ]),
    ...chips.flat(),
    ...Arr.flatMap(zones, ({ plate, title }) => [...plate, ...(title ?? [])]),
    ...Arr.flatMap(routed, ({ points }) => points),
  ]);

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
      const { fallback, spot } = labelSpot({
        avoid: {
          lines: Arr.flatMap(lines, ({ id, segments }) =>
            id === item.hop.id ? [] : segments
          ),
          shapes: [
            ...fixed,
            ...Arr.flatMap(done, ({ label }) =>
              label === undefined ? [] : [obstacle(rectPolygon(label))]
            ),
          ],
        },
        grow: growth.label,
        mayBeNearerAnother: labelMayBeNearerAnother[view],
        mayOverhang: labelMayOverhang[view],
        points: item.points,
        reach: labelReachLimit[view] * groundUnit[view],
        text: item.hop.label,
        within: drawnExtent,
      });

      return [
        ...done,
        {
          ...item,
          hidden: hiddenOf(item.hop, item.points),
          hoverLabel: fallback,
          label: spot,
        },
      ];
    }
  );

  const byHop = new Map(Arr.map(labelled, (item) => [item.hop.id, item]));

  const hops = Arr.flatMap(routed, ({ hop }) =>
    Option.toArray(Option.fromNullishOr(byHop.get(hop.id)))
  );

  return { growth, hops, structures, view, zones, zoom };
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
  /** The structure, group or hop it belongs to. */
  readonly id: string;
  readonly kind:
    | "box"
    | "tag"
    | "chip"
    | "title"
    | "label"
    | "route"
    | "zone"
    | "corner"
    | "arrow";
}

/** How long a hop's arrowhead is, from its base to its tip, on screen. */
export const arrowLength = 10;

/**
 * The tip and the middle of the base of the arrowhead drawn at a route's
 * end: the tip on the route's last point, the base `arrowLength` back along
 * the last leg.
 */
export const arrowheadOf = (
  points: ReadonlyArray<ScreenPoint>
): { readonly base: ScreenPoint; readonly tip: ScreenPoint } | undefined => {
  const tip = points.at(-1);
  const before = points.at(-2);

  if (tip === undefined || before === undefined) {
    return undefined;
  }

  const length = Math.hypot(tip.sx - before.sx, tip.sy - before.sy);

  return {
    base: lerp({
      from: tip,
      t: arrowLength / Math.max(length, tiny),
      to: before,
    }),
    tip,
  };
};

/**
 * The triangle drawn at a route's end: its tip on the last point, its base
 * `arrowLength` back along the last leg and `arrowHalfWidth` either side.
 */
export const arrowPolygon = (
  points: ReadonlyArray<ScreenPoint>
): ReadonlyArray<ScreenPoint> | undefined => {
  const head = arrowheadOf(points);

  if (head === undefined) {
    return undefined;
  }

  const { base, tip } = head;
  const length = Math.max(Math.hypot(tip.sx - base.sx, tip.sy - base.sy), 1e-9);

  const wing = {
    sx: (-(tip.sy - base.sy) / length) * arrowHalfWidth,
    sy: ((tip.sx - base.sx) / length) * arrowHalfWidth,
  };

  return [
    tip,
    { sx: base.sx + wing.sx, sy: base.sy + wing.sy },
    { sx: base.sx - wing.sx, sy: base.sy - wing.sy },
  ];
};

interface Shape2d extends ClashPart {
  readonly polygon: ReadonlyArray<ScreenPoint>;
}

const rectShape = (part: ClashPart, rect: ScreenRect): Shape2d => ({
  ...part,
  polygon: rectPolygon(rect),
});

/**
 * How close a route may come to a box or zone outline on screen, other than
 * at its own ends, and how far a crossing's lines may run on past each
 * other. Half the gap between a bundle's lines.
 */
const outlineClearance = laneGap * 0.75;

/**
 * How far apart two hops' lines must stay, outside a crossing: a little
 * less than half the bundle gap, which is as close as a line's lanes come
 * where more lines share it than fit at the full gap.
 */
const lineClearance = laneGap * 0.4;

/** How near a route's end may sit to a box's corner, in grid units. */
const cornerClearance = 0.5;

const pointToSegment = (point: ScreenPoint, { end, start }: Segment) =>
  distanceToPolyline([start, end], point);

/** Which side of the line from `p` to `q` the point `r` is on, or 0. */
const side = (p: ScreenPoint, q: ScreenPoint, r: ScreenPoint) =>
  Math.sign((q.sx - p.sx) * (r.sy - p.sy) - (q.sy - p.sy) * (r.sx - p.sx));

/** Whether two segments cross or touch. */
const segmentsMeet = (a: Segment, b: Segment) => {
  const overlap = (pick: (point: ScreenPoint) => number) =>
    Math.max(
      Math.min(pick(a.start), pick(a.end)),
      Math.min(pick(b.start), pick(b.end))
    ) <=
    Math.min(
      Math.max(pick(a.start), pick(a.end)),
      Math.max(pick(b.start), pick(b.end))
    ) +
      1e-9;

  return (
    overlap(({ sx }) => sx) &&
    overlap(({ sy }) => sy) &&
    side(a.start, a.end, b.start) * side(a.start, a.end, b.end) <= 0 &&
    side(b.start, b.end, a.start) * side(b.start, b.end, a.end) <= 0
  );
};

/** The least distance between two segments on screen. */
const segmentGap = (a: Segment, b: Segment) =>
  segmentsMeet(a, b)
    ? 0
    : Math.min(
        pointToSegment(a.start, b),
        pointToSegment(a.end, b),
        pointToSegment(b.start, a),
        pointToSegment(b.end, a)
      );

const unitOf = ({ end, start }: Segment) => {
  const length = Math.max(
    Math.hypot(end.sx - start.sx, end.sy - start.sy),
    1e-9
  );

  return { sx: (end.sx - start.sx) / length, sy: (end.sy - start.sy) / length };
};

const parallel = (a: Segment, b: Segment) => {
  const u = unitOf(a);
  const v = unitOf(b);

  return Math.abs(u.sx * v.sy - u.sy * v.sx) < 1e-6;
};

/** How far two parallel segments run alongside each other. */
const sideBySide = (a: Segment, b: Segment) => {
  const u = unitOf(a);
  const along = (point: ScreenPoint) => point.sx * u.sx + point.sy * u.sy;
  const [a0, a1] = [along(a.start), along(a.end)];
  const [b0, b1] = [along(b.start), along(b.end)];

  return (
    Math.min(Math.max(a0, a1), Math.max(b0, b1)) -
    Math.max(Math.min(a0, a1), Math.min(b0, b1))
  );
};

/** A segment with `by` cut off its start, its end, or both. */
const trim = (
  { end, start }: Segment,
  {
    atEnd,
    atStart,
    by,
  }: { readonly atEnd: boolean; readonly atStart: boolean; readonly by: number }
): Segment => {
  const u = unitOf({ end, start });

  return {
    end: atEnd ? { sx: end.sx - u.sx * by, sy: end.sy - u.sy * by } : end,
    start: atStart
      ? { sx: start.sx + u.sx * by, sy: start.sy + u.sy * by }
      : start,
  };
};

const closedEdges = (
  polygon: ReadonlyArray<ScreenPoint>
): ReadonlyArray<Segment> =>
  Arr.map(polygon, (start, index) => ({
    end: polygon[(index + 1) % polygon.length] ?? start,
    start,
  }));

/** The four corners of a footprint on the ground, in a view. */
const groundCorners = (view: View, { d, w, x, y }: Placement) =>
  Arr.map(
    [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + d },
      { x, y: y + d },
    ],
    groundProjections[view].toScreen
  );

/** How far a route's end sits from the nearer corner along its edge, in grid units. */
const cornerGap = (end: GridPoint, { d, w, x, y }: Placement) => {
  const onX = end.x === x || end.x === x + w;
  const onY = end.y === y || end.y === y + d;
  const fromX = Math.min(Math.abs(end.x - x), Math.abs(end.x - x - w));
  const fromY = Math.min(Math.abs(end.y - y), Math.abs(end.y - y - d));

  // On a vertical edge (x fixed) the end slides along y, and the reverse.
  if (onX && !onY) {
    return d >= 1 ? fromY : Number.POSITIVE_INFINITY;
  }

  if (onY && !onX) {
    return w >= 1 ? fromX : Number.POSITIVE_INFINITY;
  }

  return onX && onY ? 0 : Number.POSITIVE_INFINITY;
};

/**
 * The clashes on the ground, in the view's screen space: a route that comes
 * within `outlineClearance` of a box's outline other than at its own ends,
 * or lies along a zone's outline; a route's end within half a unit of its
 * box's corner on an edge at least a unit long; and two hops' lines closer
 * than `laneGap`, other than where they cross. A route that runs under a
 * box counts only as running under it, and a hop between overlapping
 * footprints not at all: `check` reports both already.
 */
const groundClashes = (scene: Scene): ReadonlyArray<SceneClash> => {
  const placements = new Map(
    Arr.map(scene.structures, ({ placement, structure }) => [
      structure.id,
      placement,
    ])
  );

  // Overlapping footprints leave a hop between them no clear way out,
  // and `check` warns about the overlap itself.
  const apart = ({ from, to }: Hop) => {
    const a = placements.get(from);
    const b = placements.get(to);

    return (
      a === undefined ||
      b === undefined ||
      a.x >= b.x + b.w ||
      b.x >= a.x + a.w ||
      a.y >= b.y + b.d ||
      b.y >= a.y + a.d
    );
  };

  const lines = Arr.flatMap(scene.hops, ({ hop, points, route }) =>
    apart(hop) ? [{ hop, route, segments: segmentsOf(points) }] : []
  );

  const boxes = Arr.flatMap(lines, ({ hop, route, segments }) =>
    Arr.flatMap(scene.structures, ({ placement, structure }) => {
      if (route.crosses.includes(structure.id)) {
        return [];
      }

      const edges = closedEdges(groundCorners(scene.view, placement));

      const near = Arr.some(segments, (segment, index) => {
        const trimmed = trim(segment, {
          atEnd: index === segments.length - 1 && structure.id === hop.to,
          atStart: index === 0 && structure.id === hop.from,
          // In the Iso view a leg leaves its edge at a slant on screen, so
          // it needs to run further to clear it.
          by: laneGap,
        });

        return Arr.some(
          edges,
          (edge) => segmentGap(trimmed, edge) < outlineClearance - 1e-6
        );
      });

      return near
        ? [
            clashOf(
              { id: hop.id, kind: "route" },
              { id: structure.id, kind: "box" }
            ),
          ]
        : [];
    })
  );

  const zones = Arr.flatMap(lines, ({ hop, segments }) =>
    Arr.flatMap(scene.zones, ({ plate, zone }) =>
      Arr.some(segments, (segment) =>
        Arr.some(
          closedEdges(plate),
          (edge) =>
            parallel(segment, edge) &&
            segmentGap(segment, edge) < outlineClearance - 1e-6 &&
            sideBySide(segment, edge) > outlineClearance
        )
      )
        ? [
            clashOf(
              { id: hop.id, kind: "route" },
              { id: zone.group.id, kind: "zone" }
            ),
          ]
        : []
    )
  );

  const nearCorners = Arr.flatMap(lines, ({ hop, route }) =>
    Arr.flatMap(
      [
        [route.points[0], hop.from],
        [route.points.at(-1), hop.to],
      ] as const,
      ([end, id]) => {
        const placement = placements.get(id);

        return end !== undefined &&
          placement !== undefined &&
          cornerGap(end, placement) < cornerClearance - 1e-9
          ? [clashOf({ id: hop.id, kind: "route" }, { id, kind: "corner" })]
          : [];
      }
    )
  );

  const routes = Arr.flatMap(lines, (first, index) =>
    Arr.flatMap(lines.slice(index + 1), (second) => {
      const close = Arr.some(first.segments, (a) =>
        Arr.some(second.segments, (b) => {
          if (parallel(a, b)) {
            return (
              segmentGap(a, b) < lineClearance &&
              sideBySide(a, b) > -lineClearance
            );
          }

          // Lines that cross may meet, as long as each runs on well past
          // the other: a crossing, not one ending or turning on the other.
          if (!segmentsMeet(a, b)) {
            return segmentGap(a, b) < lineClearance;
          }

          return (
            Math.min(pointToSegment(a.start, b), pointToSegment(a.end, b)) <
              lineClearance ||
            Math.min(pointToSegment(b.start, a), pointToSegment(b.end, a)) <
              lineClearance
          );
        })
      );

      return close
        ? [
            clashOf(
              { id: first.hop.id, kind: "route" },
              { id: second.hop.id, kind: "route" }
            ),
          ]
        : [];
    })
  );

  return [...boxes, ...zones, ...nearCorners, ...routes];
};

/** Every pair of hops whose arrowheads overlap. */
const arrowClashes = (scene: Scene): ReadonlyArray<SceneClash> => {
  const heads = Arr.flatMap(scene.hops, ({ hop, points }) => {
    const polygon = arrowPolygon(points);

    return polygon === undefined
      ? []
      : [{ part: { id: hop.id, kind: "arrow" as const }, polygon }];
  });

  return Arr.flatMap(heads, (first, index) =>
    Arr.flatMap(heads.slice(index + 1), (second) =>
      convexOverlap(first.polygon, second.polygon)
        ? [clashOf(first.part, second.part)]
        : []
    )
  );
};

/** A shape's name in a clash, such as `tag:a`. */
const nameOf = ({ id, kind }: ClashPart) => `${kind}:${id}`;

const clashOf = (first: ClashPart, second: ClashPart): SceneClash => ({
  between: [nameOf(first), nameOf(second)],
  parts: [first, second],
});

/**
 * Every pair of things in a scene drawn over each other, by the overlap
 * rule: no two of the name tags, hop labels, zone titles, code chips and
 * box outlines overlap (a chip sits on its own box), and no route runs
 * through a name tag, a zone title or a label, its own included. A
 * route may run through the tag of a structure it starts or ends at only
 * where it can't avoid it, so that counts too. On the ground, no route
 * touches a box's outline other than at its own ends, lies along a zone's
 * outline, ends near a corner, or comes closer to another hop's line than
 * a bundle's lines are apart, other than to cross it.
 */
export const sceneClashes = (scene: Scene): ReadonlyArray<SceneClash> => {
  const boxes = Arr.map(scene.structures, ({ outline, structure }) => ({
    id: structure.id,
    kind: "box" as const,
    owner: structure.id,
    polygon: outline,
  }));

  const text = [
    ...Arr.map(scene.structures, ({ structure, tag }) => ({
      ...rectShape({ id: structure.id, kind: "tag" }, tag),
      owner: structure.id,
    })),
    ...Arr.flatMap(scene.structures, ({ chip, structure }) =>
      chip === undefined
        ? []
        : [
            {
              ...rectShape({ id: structure.id, kind: "chip" }, chip),
              owner: structure.id,
            },
          ]
    ),
    ...Arr.flatMap(scene.zones, ({ title, zone }) =>
      title === undefined
        ? []
        : [
            {
              id: zone.group.id,
              kind: "title" as const,
              owner: "",
              polygon: title,
            },
          ]
    ),
    ...Arr.flatMap(scene.hops, ({ hop, label }) =>
      label === undefined
        ? []
        : [
            {
              ...rectShape({ id: hop.id, kind: "label" }, label),
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
      shape.kind === "chip" ||
      !Arr.some(segmentsOf(points), (segment) =>
        segmentCrosses(segment, shape.polygon)
      )
        ? []
        : [clashOf({ id: hop.id, kind: "route" }, shape)]
    )
  );

  return [
    ...pairs,
    ...crossings,
    ...groundClashes(scene),
    ...arrowClashes(scene),
  ];
};
