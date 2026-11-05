import { assert } from "@effect/vitest";

import type { Layout, Placement } from "../src/index.ts";

/** The placement of `id`, failing the test when it has none. */
export const placementOf = (layout: Layout, id: string): Placement => {
  const placement = layout.structures[id];

  assert.isDefined(placement, `${id} has no placement`);

  return placement;
};

/** `box` widened by `by` grid units on every side. */
export const grow = (box: Placement, by: number): Placement => ({
  x: box.x - by,
  y: box.y - by,
  w: box.w + 2 * by,
  d: box.d + 2 * by,
});
