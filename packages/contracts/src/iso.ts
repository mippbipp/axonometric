import { Array as Arr } from "effect";
import { dual } from "effect/Function";

import { isoHeights } from "./iso-heights.ts";
import type { Placement } from "./layout.ts";
import type { Structure } from "./map-data.ts";

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

/** One grid unit along x or y, measured on screen: a tile's edge. */
export const gridOnScreen = Math.hypot(tileWidth / 2, tileHeight / 2);

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

/** The text on a structure's name tag: its tag, or else its name. */
export const nameTagText = (structure: Pick<Structure, "name" | "tag">) =>
  structure.tag ?? structure.name;

/** An axis-aligned rectangle on screen. */
export interface ScreenRect {
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
  readonly top: number;
}

/**
 * Where the Iso view draws a structure's name tag: centred under the front
 * corner of its footprint on the ground, whatever the shape's height, with
 * its width estimated from the text.
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
    bottom: top + tagHeight,
    left: front.sx - width / 2,
    right: front.sx + width / 2,
    top,
  };
});

/** A footprint's corners on screen, named by where they sit in the Iso view. */
export interface Corners {
  readonly back: ScreenPoint;
  readonly front: ScreenPoint;
  readonly left: ScreenPoint;
  readonly right: ScreenPoint;
}

/** The four corners of a footprint, raised to height `z`. */
export const corners: {
  (z: number): (placement: Placement) => Corners;
  (placement: Placement, z: number): Corners;
} = dual(2, ({ d, w, x, y }: Placement, z: number): Corners => ({
  back: project({ x, y, z }),
  front: project({ x: x + w, y: y + d, z }),
  left: project({ x, y: y + d, z }),
  right: project({ x: x + w, y, z }),
}));

/**
 * The outline of a structure drawn on `placement`, as tall as its shape's
 * iso height: the six corners of its silhouette, clockwise from the top back
 * corner.
 */
export const boxOutline: {
  (
    shape: Structure["shape"]
  ): (placement: Placement) => ReadonlyArray<ScreenPoint>;
  (placement: Placement, shape: Structure["shape"]): ReadonlyArray<ScreenPoint>;
} = dual(
  2,
  (
    placement: Placement,
    shape: Structure["shape"]
  ): ReadonlyArray<ScreenPoint> => {
    const ground = corners(placement, 0);
    const top = corners(placement, isoHeights[shape]);

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

const rectCorners = (rect: ScreenRect): ReadonlyArray<ScreenPoint> => [
  { sx: rect.left, sy: rect.top },
  { sx: rect.right, sy: rect.top },
  { sx: rect.right, sy: rect.bottom },
  { sx: rect.left, sy: rect.bottom },
];

const edgeNormals = (polygon: ReadonlyArray<ScreenPoint>) =>
  Arr.map(polygon, (point, index) => {
    const next = polygon[(index + 1) % polygon.length] ?? point;

    return { sx: next.sy - point.sy, sy: point.sx - next.sx };
  });

const extentAlong = (
  polygon: ReadonlyArray<ScreenPoint>,
  axis: ScreenPoint
) => {
  const values = Arr.map(
    polygon,
    (point) => point.sx * axis.sx + point.sy * axis.sy
  );

  return { max: Math.max(...values), min: Math.min(...values) };
};

/** Shapes that only touch along an edge don't overlap. */
const tolerance = 1e-9;

/**
 * Whether two convex polygons share some area, by the separating axis test.
 */
const convexOverlap = (
  a: ReadonlyArray<ScreenPoint>,
  b: ReadonlyArray<ScreenPoint>
) =>
  Arr.every([...edgeNormals(a), ...edgeNormals(b)], (axis) => {
    const first = extentAlong(a, axis);
    const second = extentAlong(b, axis);
    const scale = Math.hypot(axis.sx, axis.sy);

    return (
      first.min < second.max - tolerance * scale &&
      second.min < first.max - tolerance * scale
    );
  });

/**
 * Whether a name tag at `tag` is drawn over any part of `box`'s outline. The
 * tag's own edges lie along the screen axes, so an outline whose screen
 * bounds miss the tag is clear without the full test.
 */
export const tagCoversBox: {
  (box: ReadonlyArray<ScreenPoint>): (tag: ScreenRect) => boolean;
  (tag: ScreenRect, box: ReadonlyArray<ScreenPoint>): boolean;
} = dual(2, (tag: ScreenRect, box: ReadonlyArray<ScreenPoint>) => {
  const across = extentAlong(box, { sx: 1, sy: 0 });
  const down = extentAlong(box, { sx: 0, sy: 1 });

  const apart =
    across.max <= tag.left + tolerance ||
    tag.right <= across.min + tolerance ||
    down.max <= tag.top + tolerance ||
    tag.bottom <= down.min + tolerance;

  return !apart && convexOverlap(rectCorners(tag), box);
});
