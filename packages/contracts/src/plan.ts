import { Array as Arr } from "effect";
import { dual } from "effect/Function";

import { slideOffsets } from "./geometry.ts";
import { gridOnScreen, project, tileHeight, tileWidth } from "./iso.ts";
import type { GridPosition, ScreenPoint, ScreenRect } from "./iso.ts";
import type { GridPoint, Placement } from "./layout.ts";

/** The two drawings of a layout: isometric, and straight from above. */
export type View = "iso" | "plan";

export const views: ReadonlyArray<View> = ["iso", "plan"];

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
  readonly toGround: (point: ScreenPoint) => GridPoint;
  readonly toScreen: (point: GridPosition) => ScreenPoint;
  /** How long one grid unit along x or y is on screen. */
  readonly unit: number;
}

/**
 * Each view's projection of the ground and its inverse, so a point on
 * screen in one view can be found in the other.
 */
export const groundProjections: Readonly<Record<View, GroundProjection>> = {
  iso: {
    toGround: ({ sx, sy }) => {
      const across = sx / (tileWidth / 2);
      const down = sy / (tileHeight / 2);

      return { x: (across + down) / 2, y: (down - across) / 2 };
    },
    toScreen: project,
    unit: gridOnScreen,
  },
  plan: {
    toGround: ({ sx, sy }) => ({ x: sx / planUnit, y: sy / planUnit }),
    toScreen: projectPlan,
    unit: planUnit,
  },
};

/** A footprint's rectangle in Plan view. */
export const planRect = ({ d, w, x, y }: Placement): ScreenRect => ({
  bottom: (y + d) * planUnit,
  left: x * planUnit,
  right: (x + w) * planUnit,
  top: y * planUnit,
});

/** The gap between a box and its name tag in Plan view. */
const planTagGap = 6;

/** A name tag's size on screen. */
export interface TagSize {
  readonly height: number;
  readonly width: number;
}

/**
 * Where Plan view may draw a name tag of `size` for a box drawn in `box`,
 * best first: centred under the box, then above it, each sliding
 * sideways while the tag's centre stays over the box, then beside the box.
 * The scene takes the first spot clear of the boxes, the routes and the
 * other tags.
 */
export const planTagSpots: {
  (size: TagSize): (box: ScreenRect) => ReadonlyArray<ScreenRect>;
  (box: ScreenRect, size: TagSize): ReadonlyArray<ScreenRect>;
} = dual(
  2,
  (box: ScreenRect, { height, width }: TagSize): ReadonlyArray<ScreenRect> => {
    const middle = (box.left + box.right) / 2;
    const reach = (box.right - box.left) / 2;

    const shifts = slideOffsets(reach);

    const at = (centre: number, top: number): ScreenRect => ({
      bottom: top + height,
      left: centre - width / 2,
      right: centre + width / 2,
      top,
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
