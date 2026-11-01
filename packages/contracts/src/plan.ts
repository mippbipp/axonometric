import { Array as Arr } from "effect";
import { dual } from "effect/Function";

import { slideOffsets } from "./geometry.ts";
import { gridOnScreen, project, tileHeight, tileWidth } from "./iso.ts";
import type { GridPosition, ScreenPoint, ScreenRect } from "./iso.ts";
import type { GridPoint, Placement } from "./layout.ts";

/** The two drawings of a layout: isometric, and straight from above. */
export type View = "iso" | "plan";

export const views: readonly View[] = ["iso", "plan"];

/**
 * One grid unit in Plan view, in screen units. A half-unit gap below a box
 * leaves room for its name tag above a route running there.
 */
export const planUnit = 60;

/** Projects a grid point onto the screen in Plan view, ignoring height. */
export const projectPlan = ({ x, y }: GridPosition): ScreenPoint => ({
  sx: x * planUnit,
  sy: y * planUnit,
});

/** Moves between the ground grid and the screen, in one view. */
export interface GroundProjection {
  readonly toScreen: (point: GridPosition) => ScreenPoint;
  readonly toGround: (point: ScreenPoint) => GridPoint;
  /** How long one grid unit along x or y is on screen. */
  readonly unit: number;
}

/**
 * Each view's projection of the ground and its inverse, so a point on
 * screen in one view can be found in the other.
 */
export const groundProjections: Readonly<Record<View, GroundProjection>> = {
  iso: {
    toScreen: project,
    toGround: ({ sx, sy }) => {
      const across = sx / (tileWidth / 2);
      const down = sy / (tileHeight / 2);

      return { x: (across + down) / 2, y: (down - across) / 2 };
    },
    unit: gridOnScreen,
  },
  plan: {
    toScreen: projectPlan,
    toGround: ({ sx, sy }) => ({ x: sx / planUnit, y: sy / planUnit }),
    unit: planUnit,
  },
};

/** A footprint's rectangle in Plan view. */
export const planRect = ({ x, y, w, d }: Placement): ScreenRect => ({
  left: x * planUnit,
  top: y * planUnit,
  right: (x + w) * planUnit,
  bottom: (y + d) * planUnit,
});

/** The gap between a box and its name tag in Plan view. */
const planTagGap = 6;

/** A name tag's size on screen. */
export interface TagSize {
  readonly width: number;
  readonly height: number;
}

/**
 * Where Plan view may draw a name tag of `size` for a box drawn in `box`,
 * best first: centred under the box, then above it, each sliding
 * sideways while the tag's centre stays over the box, then beside the box.
 * The scene takes the first spot clear of the boxes, the routes and the
 * other tags.
 */
export const planTagSpots: {
  (size: TagSize): (box: ScreenRect) => readonly ScreenRect[];
  (box: ScreenRect, size: TagSize): readonly ScreenRect[];
} = dual(
  2,
  (box: ScreenRect, { width, height }: TagSize): readonly ScreenRect[] => {
    const middle = (box.left + box.right) / 2;
    const reach = (box.right - box.left) / 2;

    const shifts = slideOffsets(reach);

    const at = (centre: number, top: number): ScreenRect => ({
      left: centre - width / 2,
      right: centre + width / 2,
      top,
      bottom: top + height,
    });

    const below = box.bottom + planTagGap;
    const above = box.top - planTagGap - height;
    const beside = (box.top + box.bottom) / 2 - height / 2;

    return [
      ...Arr.map(shifts, (shift) => at(middle + shift, below)),
      ...Arr.map(shifts, (shift) => at(middle + shift, above)),
      at(box.right + planTagGap + width / 2, beside),
      at(box.left - planTagGap - width / 2, beside),
    ];
  }
);
