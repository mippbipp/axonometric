import {
  isoHeights,
  nameTagRect,
  nameTagText,
  tileHeight,
  tileWidth,
} from "@axonometric/contracts";
import type {
  Placement,
  ScreenRect,
  Structure,
  Zone,
} from "@axonometric/contracts";

import { corners } from "./iso.ts";
import type { ScreenPoint } from "./iso.ts";

/** Approximate width of one character of a zone title, tracking included. */
const titleCharWidth = 7.2;

/** How far the title's text reaches above and below its baseline. */
const titleAscent = 10;

const titleDescent = 3;

/** Clear space kept around the title. */
const titleMargin = 3;

/** How far apart the candidate title spots are, in screen units. */
const searchStep = 3;

/** One grid unit along x, measured on screen. */
const gridStep = Math.hypot(tileWidth / 2, tileHeight / 2);

/** The screen direction of a grid unit along x: the front-left edge. */
const along = { sx: tileWidth / 2 / gridStep, sy: tileHeight / 2 / gridStep };

/**
 * How far past its footprint a structure may draw, such as an external
 * source's halo, in grid units along the ground and screen units up and down.
 */
const overhang = { ground: 0.3, height: 6 };

/** A structure the iso view draws, and where. */
export interface DrawnStructure {
  readonly structure: Structure;
  readonly placement: Placement;
}

/** A zone as the iso view draws it. */
export interface ZoneDrawing {
  readonly zone: Zone;
  /** The plate's ground corners: back, right, front, left. */
  readonly plate: readonly ScreenPoint[];
  /** Where the title's baseline starts. */
  readonly titleAt: ScreenPoint;
  /**
   * The SVG transform that skews the title along the front-left edge, with
   * its baseline starting at `titleAt`.
   */
  readonly titleTransform: string;
}

const plateOf = (zone: Zone): readonly ScreenPoint[] => {
  const { back, right, front, left } = corners(zone.box, 0);

  return [back, right, front, left];
};

/**
 * The four corners of a title of `width` skewed along the front-left edge,
 * grown by `margin`: its baseline runs along the edge from `start` and its
 * upright strokes stay vertical.
 */
const titleQuad = (
  start: ScreenPoint,
  width: number,
  margin = 0
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

const normals = (polygon: readonly ScreenPoint[]) =>
  polygon.map((point, index) => {
    const next = polygon[(index + 1) % polygon.length] ?? point;

    return { sx: next.sy - point.sy, sy: point.sx - next.sx };
  });

const spread = (polygon: readonly ScreenPoint[], axis: ScreenPoint) => {
  const values = polygon.map(
    (point) => point.sx * axis.sx + point.sy * axis.sy
  );

  return { min: Math.min(...values), max: Math.max(...values) };
};

/** Whether two convex polygons share area, by the separating axis test. */
const overlap = (a: readonly ScreenPoint[], b: readonly ScreenPoint[]) =>
  [...normals(a), ...normals(b)].every((axis) => {
    const first = spread(a, axis);
    const second = spread(b, axis);

    return first.min < second.max && second.min < first.max;
  });

/** Whether `point` is inside the clockwise convex polygon `polygon`. */
const inside = (polygon: readonly ScreenPoint[], point: ScreenPoint) =>
  polygon.every((corner, index) => {
    const next = polygon[(index + 1) % polygon.length] ?? corner;

    return (
      (next.sx - corner.sx) * (point.sy - corner.sy) -
        (next.sy - corner.sy) * (point.sx - corner.sx) >=
      0
    );
  });

/** The outline a structure of `height` draws, overhang included. */
const silhouette = (
  { x, y, w, d }: Placement,
  height: number
): readonly ScreenPoint[] => {
  const by = overhang.ground;
  const grown = { x: x - by, y: y - by, w: w + 2 * by, d: d + 2 * by };
  const ground = corners(grown, -overhang.height);
  const top = corners(grown, height + overhang.height);

  return [
    top.back,
    top.right,
    ground.right,
    ground.front,
    ground.left,
    top.left,
  ];
};

const rectPolygon = (rect: ScreenRect): readonly ScreenPoint[] => [
  { sx: rect.left, sy: rect.top },
  { sx: rect.right, sy: rect.top },
  { sx: rect.right, sy: rect.bottom },
  { sx: rect.left, sy: rect.bottom },
];

/**
 * Baseline starts for a zone's title, best first: along the plate's
 * front-left edge, from its left corner towards its front corner, at the
 * lowest lift off the edge first.
 */
const candidates = (zone: Zone, width: number) => {
  const { front, left } = corners(zone.box, 0);
  const length = Math.hypot(front.sx - left.sx, front.sy - left.sy);
  const lowest = titleDescent + titleMargin;
  const spots: ScreenPoint[] = [];

  for (let lift = lowest; lift <= lowest + length / 2; lift += searchStep) {
    for (let run = 0; run + width <= length; run += searchStep) {
      spots.push({
        sx: left.sx + run * along.sx,
        sy: left.sy + run * along.sy - lift,
      });
    }
  }

  return spots;
};

const transformAt = (start: ScreenPoint) =>
  `matrix(${along.sx} ${along.sy} 0 1 ${start.sx} ${start.sy})`;

/**
 * Lays out every zone for the iso view. Each title lies on its own plate,
 * skewed along the front-left edge, in the first spot that stays inside the
 * plate and clear of every other plate and of every structure's box and
 * name tag. When no spot is clear, it takes the first.
 */
export const drawZones = ({
  zones,
  structures,
}: {
  readonly zones: readonly Zone[];
  readonly structures: readonly DrawnStructure[];
}): readonly ZoneDrawing[] => {
  const plates = zones.map(plateOf);

  const obstacles = structures.flatMap(({ structure, placement }) => [
    silhouette(placement, isoHeights[structure.shape]),
    rectPolygon(nameTagRect(placement, nameTagText(structure))),
  ]);

  return zones.map((zone, index) => {
    const plate = plates[index] ?? plateOf(zone);
    const others = plates.filter((_, other) => other !== index);
    const width = zone.group.title.length * titleCharWidth;
    const spots = candidates(zone, width);

    const clear = (start: ScreenPoint) => {
      const padded = titleQuad(start, width, titleMargin);

      return (
        padded.every((point) => inside(plate, point)) &&
        [...others, ...obstacles].every((other) => !overlap(padded, other))
      );
    };

    const titleAt = spots.find(clear) ??
      spots[0] ??
      plate[3] ?? { sx: 0, sy: 0 };

    return { zone, plate, titleAt, titleTransform: transformAt(titleAt) };
  });
};
