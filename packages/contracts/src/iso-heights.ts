import type { Shape } from "./map-data.ts";

/**
 * How far each shape rises above the ground in the Iso view, in screen units,
 * from the ground to its highest point. Iso heights default by shape; the map
 * files don't set them.
 */
export const isoHeights = {
  box: 40,
  cards: 30,
  document: 62,
  external: 36,
  gate: 40,
  job: 34,
  person: 64,
  screen: 10,
  slab: 16,
  store: 56,
  tall: 66,
} as const satisfies Record<Shape, number>;
