import { Array as Arr, Order } from "effect";
import { dual } from "effect/Function";

import {
  gridOnScreen,
  project,
  tagHeight,
  tileHeight,
  tileWidth,
} from "./iso.ts";
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

/** How far apart the sideways tag spots are, in screen units. */
const planTagStep = 6;

/** Room kept between a tag inside a box and the box's edges. */
const planTagInset = 6;

/**
 * How tall a box's hatched strip and icon leave room for a tag inside, in
 * screen units: below this the tag goes outside.
 */
export const planTagInsideHeight = 84;

/** The height of the hatched strip along a box's bottom edge in Plan view. */
export const planStripHeight = 7;

/**
 * Where Plan view draws the name tag of `width` inside `footprint`, above
 * its hatched strip, or `undefined` when the box is too small for it.
 * Inside, no route can reach the tag.
 */
export const planTagInside: {
  (width: number): (footprint: ScreenRect) => ScreenRect | undefined;
  (footprint: ScreenRect, width: number): ScreenRect | undefined;
} = dual(2, (footprint: ScreenRect, width: number): ScreenRect | undefined => {
  const fits =
    footprint.right - footprint.left >= width + 2 * planTagInset &&
    footprint.bottom - footprint.top >= planTagInsideHeight;

  const middle = (footprint.left + footprint.right) / 2;
  const top = footprint.bottom - planStripHeight - planTagInset / 2 - tagHeight;

  return fits
    ? {
        left: middle - width / 2,
        right: middle + width / 2,
        top,
        bottom: top + tagHeight,
      }
    : undefined;
});

/**
 * Where Plan view may draw the name tag of `width` around a box drawn in
 * `box`, best first: centred under the box, then above it, each sliding
 * sideways while the tag's centre stays over the box, then beside the box.
 * The scene takes the first spot clear of the boxes, the routes and the
 * other tags.
 */
export const planTagSpots: {
  (width: number): (box: ScreenRect) => readonly ScreenRect[];
  (box: ScreenRect, width: number): readonly ScreenRect[];
} = dual(2, (box: ScreenRect, width: number): readonly ScreenRect[] => {
  const middle = (box.left + box.right) / 2;
  const reach = (box.right - box.left) / 2;

  const steps = Math.floor(reach / planTagStep);

  const shifts = Arr.sort(
    Arr.map(Arr.range(-steps, steps), (step) => step * planTagStep),
    Order.mapInput(Order.Number, Math.abs)
  );

  const at = (centre: number, top: number): ScreenRect => ({
    left: centre - width / 2,
    right: centre + width / 2,
    top,
    bottom: top + tagHeight,
  });

  const below = box.bottom + planTagGap;
  const above = box.top - planTagGap - tagHeight;
  const beside = (box.top + box.bottom) / 2 - tagHeight / 2;

  return [
    ...Arr.map(shifts, (shift) => at(middle + shift, below)),
    ...Arr.map(shifts, (shift) => at(middle + shift, above)),
    at(box.right + planTagGap + width / 2, beside),
    at(box.left - planTagGap - width / 2, beside),
  ];
});
