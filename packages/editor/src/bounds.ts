/** A box in SVG user units: what the viewport fits to the window. */
export interface Bounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/** The smallest box holding every point, or `undefined` for none. */
export const boundsOf = (
  points: readonly { readonly sx: number; readonly sy: number }[]
): Bounds | undefined => {
  if (points.length === 0) {
    return undefined;
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const { sx, sy } of points) {
    minX = Math.min(minX, sx);
    minY = Math.min(minY, sy);
    maxX = Math.max(maxX, sx);
    maxY = Math.max(maxY, sy);
  }

  return { minX, minY, maxX, maxY };
};
// scratch: editor-only change for the #68 demo
