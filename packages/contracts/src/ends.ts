import { dual } from "effect/Function";

import type { View } from "./plan.ts";

// Where hops end on a structure's edge. The router counts how many ends an
// edge takes, and the scene spaces them, so both use the same numbers.

/** How long a hop's arrowhead is, from its base to its tip, on screen. */
export const arrowLength = 10;

/** Half the width of a hop's arrowhead at its base, in drawing units. */
export const arrowHalfWidth = 4;

/** How much clear space neighbouring heads keep on screen at fit, in px. */
export const endClearance = 3;

/** The zoom the spacing is sized for: the smallest a map is shown at. */
export const fitZoom = 0.4;

/**
 * How much room an end takes along its edge in each view, in grid units.
 * Two neighbouring ends sit half the sum of their widths apart, which at
 * `fitZoom` is:
 *
 * - two arrowheads: their width plus 3 px, measured across the heads'
 *   direction;
 * - an arrowhead and a line: a little less, since a line is thin;
 * - two lines: about 4 drawing units, the least `sceneClashes` allows.
 *
 * In the Iso view the heads point along a diagonal and the edge runs at a
 * slant to them, so a grid unit along the edge separates two heads by only
 * 32.2 drawing units across their direction: a head and 3 px at `fitZoom`
 * (8 + 3 / 0.4 = 15.5 units) takes 0.49 of a unit. In Plan view the heads
 * are square to the edge and a unit is 60 units.
 */
export const endWidths: Readonly<
  Record<View, { readonly head: number; readonly start: number }>
> = {
  iso: { head: 0.49, start: 0.14 },
  plan: { head: 0.24, start: 0.09 },
};

/**
 * How far from a structure a bundle's trunk may run cheaply in the router,
 * in half-unit steps. Hops that share a structure share steps cheaply only
 * this far along their routes from it, so a bundle parts soon after the
 * structure. Past it the router prices a shared step like a stranger's.
 */
export const trunkSteps = 8;

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
