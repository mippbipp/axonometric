import { Array as Arr } from "effect";
import { dual } from "effect/Function";

import type { ScreenPoint } from "./iso.ts";
import type { Placement } from "./layout.ts";
import type { GroundProjection } from "./plan.ts";

/** Formats screen points for an SVG `points` attribute. */
export const toPoints = (points: ReadonlyArray<ScreenPoint>) =>
  Arr.join(
    Arr.map(points, (point) => `${point.sx},${point.sy}`),
    " "
  );

/**
 * A footprint's ground outline on screen in one view, from its corner at
 * the smallest x and y round to the opposite corner.
 */
export const groundOutline: {
  (
    ground: GroundProjection
  ): (placement: Placement) => ReadonlyArray<ScreenPoint>;
  (placement: Placement, ground: GroundProjection): ReadonlyArray<ScreenPoint>;
} = dual(
  2,
  (
    { d, w, x, y }: Placement,
    ground: GroundProjection
  ): ReadonlyArray<ScreenPoint> => [
    ground.toScreen({ x, y }),
    ground.toScreen({ x: x + w, y }),
    ground.toScreen({ x: x + w, y: y + d }),
    ground.toScreen({ x, y: y + d }),
  ]
);
