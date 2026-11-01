import { Array as Arr } from "effect";
import { dual } from "effect/Function";

import type { Placement } from "./layout.ts";

/** A point on screen, in SVG user units. */
export interface ScreenPoint {
  readonly sx: number;
  readonly sy: number;
}

/** A point on the ground grid, in grid units, `z` screen units above it. */
export interface GridPosition {
  readonly x: number;
  readonly y: number;
  readonly z?: number;
}

/** One grid unit is a 72 × 36 tile. */
export const tileWidth = 72;

export const tileHeight = 36;

/** How tall the iso view draws a box, in screen units. */
export const defaultBoxHeight = 40;

/** Approximate width of one character of the name tag's monospace font. */
export const tagCharWidth = 7.2;

/** The tag is this much wider than its text, for padding. */
export const tagPadding = 12;

/** The tag's top edge sits this far below the box's front corner. */
export const tagOffset = 9;

export const tagHeight = 18;

/** How far below the front corner a name tag reaches, in screen units. */
export const tagDrop = 28;

/**
 * Projects a grid point onto the screen. `z` is a height above the ground in
 * screen units; it defaults to the ground.
 */
export const project = ({ x, y, z = 0 }: GridPosition): ScreenPoint => ({
  sx: ((x - y) * tileWidth) / 2,
  sy: ((x + y) * tileHeight) / 2 - z,
});

/** An axis-aligned rectangle on screen. */
export interface ScreenRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/**
 * Where the iso view draws a structure's name tag: centred under the front
 * corner of its footprint, with its width estimated from the text.
 */
export const nameTagRect: {
  (text: string): (placement: Placement) => ScreenRect;
  (placement: Placement, text: string): ScreenRect;
} = dual(2, (placement: Placement, text: string): ScreenRect => {
  const front = project({
    x: placement.x + placement.w,
    y: placement.y + placement.d,
  });

  const width = text.length * tagCharWidth + tagPadding;
  const top = front.sy + tagOffset;

  return {
    left: front.sx - width / 2,
    top,
    right: front.sx + width / 2,
    bottom: top + tagHeight,
  };
});

/**
 * The outline of a box drawn on `placement` at the default height: the six
 * corners of its silhouette, clockwise from the top back corner.
 */
export const boxOutline = (placement: Placement): readonly ScreenPoint[] => {
  const { x, y, w, d } = placement;
  const height = defaultBoxHeight;

  return [
    project({ x, y, z: height }),
    project({ x: x + w, y, z: height }),
    project({ x: x + w, y }),
    project({ x: x + w, y: y + d }),
    project({ x, y: y + d }),
    project({ x, y: y + d, z: height }),
  ];
};

const rectCorners = (rect: ScreenRect): readonly ScreenPoint[] => [
  { sx: rect.left, sy: rect.top },
  { sx: rect.right, sy: rect.top },
  { sx: rect.right, sy: rect.bottom },
  { sx: rect.left, sy: rect.bottom },
];

const edgeNormals = (polygon: readonly ScreenPoint[]) =>
  Arr.map(polygon, (point, index) => {
    const next = polygon[(index + 1) % polygon.length] ?? point;

    return { sx: next.sy - point.sy, sy: point.sx - next.sx };
  });

const extentAlong = (polygon: readonly ScreenPoint[], axis: ScreenPoint) => {
  const values = Arr.map(
    polygon,
    (point) => point.sx * axis.sx + point.sy * axis.sy
  );

  return { min: Math.min(...values), max: Math.max(...values) };
};

/** Shapes that only touch along an edge don't overlap. */
const tolerance = 1e-9;

/**
 * Whether two convex polygons share some area, by the separating axis test.
 */
const convexOverlap = (a: readonly ScreenPoint[], b: readonly ScreenPoint[]) =>
  Arr.every([...edgeNormals(a), ...edgeNormals(b)], (axis) => {
    const first = extentAlong(a, axis);
    const second = extentAlong(b, axis);
    const scale = Math.hypot(axis.sx, axis.sy);

    return (
      first.min < second.max - tolerance * scale &&
      second.min < first.max - tolerance * scale
    );
  });

/** Whether a name tag at `tag` is drawn over any part of `box`'s outline. */
export const tagCoversBox: {
  (box: readonly ScreenPoint[]): (tag: ScreenRect) => boolean;
  (tag: ScreenRect, box: readonly ScreenPoint[]): boolean;
} = dual(2, (tag: ScreenRect, box: readonly ScreenPoint[]) =>
  convexOverlap(rectCorners(tag), box)
);
