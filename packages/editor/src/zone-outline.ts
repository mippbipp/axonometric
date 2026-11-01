import type { Zone } from "@axonometric/contracts";

import { corners } from "./iso.ts";
import type { ScreenPoint } from "./iso.ts";

/** Approximate width of one character of a zone title, tracking included. */
const titleCharWidth = 7;

/** Space between the zone's left corner and the end of its title. */
const titleGap = 8;

/** Where a zone's plate and title sit on screen. */
export interface ZoneOutline {
  /** The plate's ground corners: back, right, front, left. */
  readonly plate: readonly ScreenPoint[];
  /** Where the title's text ends, just left of the plate's left corner. */
  readonly titleEnd: ScreenPoint;
  /** Every point the plate and title reach, for fitting the view. */
  readonly extent: readonly ScreenPoint[];
}

/**
 * A zone projected onto the ground. The title sits outside the plate's left
 * corner, where the group's own boxes and name tags can't cover it: boxes
 * rise up the screen and tags hang below front corners.
 */
export const zoneOutline = (zone: Zone): ZoneOutline => {
  const { back, right, front, left } = corners(zone.box, 0);
  const titleEnd = { sx: left.sx - titleGap, sy: left.sy + 4 };
  const titleStart = titleEnd.sx - zone.group.title.length * titleCharWidth;

  return {
    plate: [back, right, front, left],
    titleEnd,
    extent: [
      back,
      right,
      front,
      left,
      { sx: titleStart, sy: titleEnd.sy - 10 },
      { sx: titleStart, sy: titleEnd.sy + 2 },
    ],
  };
};
