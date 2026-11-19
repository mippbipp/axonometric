import { Array as Arr } from "effect";

import type { GridPoint } from "./layout.ts";

/**
 * How far past the ground between its ends a route may run, in grid units,
 * before it reads as a loop. Leaving and entering by a face stub, and
 * stepping into a lane beside another route, stay within it.
 */
export const detourAllowance = 2;

/**
 * How far a route runs outside the rectangle its two ends span, in grid
 * units: 0 for a route that stays between them. Plan view draws routes
 * straight from above, so this is the distance there too.
 */
export const detourOf = (points: readonly GridPoint[]) => {
  const [first] = points;
  const last = points.at(-1);

  if (first === undefined || last === undefined) {
    return 0;
  }

  const left = Math.min(first.x, last.x);
  const right = Math.max(first.x, last.x);
  const top = Math.min(first.y, last.y);
  const bottom = Math.max(first.y, last.y);

  return Math.max(
    0,
    ...Arr.map(points, ({ x, y }) =>
      Math.max(left - x, x - right, top - y, y - bottom)
    )
  );
};

/** Whether a route runs further than `detourAllowance` outside its ends' rectangle. */
export const isDetour = (points: readonly GridPoint[]) =>
  detourOf(points) > detourAllowance;
