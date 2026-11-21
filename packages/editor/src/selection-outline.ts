import type { Placement } from "@axonometric/contracts";

const pad = 0.35;

/** The ground rectangle that outlines a structure's footprint. */
export const outlineOf = (placement: Placement) => ({
  d: placement.d + pad * 2,
  w: placement.w + pad * 2,
  x: placement.x - pad,
  y: placement.y - pad,
});
