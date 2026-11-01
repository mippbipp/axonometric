/** How many times a fit re-measures a drawing whose text grows. */
const fitRounds = 4;

/**
 * The zoom that draws something whose text grows as it zooms out. Zoomed
 * out, text grows, so the drawing reaches further and fits at a smaller
 * zoom: `scaleAt(zoom)` is the zoom that fits it drawn for `zoom`. This
 * starts from the zoom that fits at full size and fits again at each zoom
 * it finds, until it settles.
 */
export const settledScale = (scaleAt: (zoom: number) => number) => {
  let scale = scaleAt(1);

  for (let round = 0; round < fitRounds; round += 1) {
    scale = Math.min(scale, scaleAt(scale));
  }

  return scale;
};
