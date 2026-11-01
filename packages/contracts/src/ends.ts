import { dual } from "effect/Function";

import type { View } from "./plan.ts";

// Where hops end on a structure's edge. The router counts how many ends an
// edge takes, and the scene spaces them, so both use the same numbers.

/** How long a hop's arrowhead is, from its base to its tip, on screen. */
export const arrowLength = 10;

/** Half the width of a hop's arrowhead at its base, in drawing units. */
export const arrowHalfWidth = 4;

/** How much clear space neighbouring ends keep on screen at fit, in px. */
export const endClearance = 3;

/**
 * How much room an end takes along its edge in each view, in grid units.
 * Two neighbouring ends sit half the sum of their widths apart, which on
 * screen at the zoom that fits a 15-structure map in a 1780×1020 window
 * (0.76 px per drawing unit in the Iso view, 0.51 in Plan view) is:
 *
 * - two arrowheads: their width plus 3 px;
 * - an arrowhead and a line: the head's half width plus 3 px;
 * - two lines: about 4 drawing units, the least `sceneClashes` allows.
 *
 * In the Iso view the edge runs at a slant to the lines, so a grid unit
 * along it separates lines by only 32 drawing units.
 */
export const endWidths: Readonly<
  Record<View, { readonly head: number; readonly start: number }>
> = {
  iso: { head: 0.3, start: 0.1 },
  plan: { head: 0.24, start: 0.09 },
};

/** How far an end stays from a corner on an edge long enough, in grid units. */
export const cornerMargin = 0.5;

/**
 * The range along an edge of `length` grid units that ends may take: the
 * whole edge when it is shorter than a unit, else clear of both corners.
 */
export const endRange = (length: number) =>
  length < 1
    ? { low: 0, high: length }
    : { low: cornerMargin, high: length - cornerMargin };

/** How far apart two neighbouring ends sit along their edge. */
export const endGap: {
  (b: number): (a: number) => number;
  (a: number, b: number): number;
} = dual(2, (a: number, b: number) => (a + b) / 2);

/**
 * The ends on one edge of a structure. Counts may be fractions: an end not
 * yet routed that could take either of two edges counts half on each.
 */
export interface EdgeEnds {
  readonly heads: number;
  readonly starts: number;
}

/**
 * Whether an edge of `length` grid units has room for these ends in the
 * worst order, with the narrowest at its two extremes. The Iso view needs
 * the most room, so it decides.
 */
export const fitsEdge: {
  (ends: EdgeEnds): (length: number) => boolean;
  (length: number, ends: EdgeEnds): boolean;
} = dual(2, (length: number, { heads, starts }: EdgeEnds) => {
  const { head, start } = endWidths.iso;
  const { low, high } = endRange(length);

  if (heads + starts <= 1 + 1e-9) {
    return true;
  }

  // The two narrowest ends sit at the extremes and count half each.
  const outer =
    starts >= 2 - 1e-9 ? start : starts > 1e-9 ? (start + head) / 2 : head;

  return heads * head + starts * start - outer <= high - low + 1e-9;
});
