import { pagePaint } from "@axonometric/drawing";
import type { DrawingEnvironment } from "@axonometric/drawing";

import { PageFrame, PageLayers } from "./page-drawing.tsx";

/**
 * How the page paints the drawing: with the stylesheet's CSS variables, so
 * the theme can change without drawing again, with a target for each
 * structure, and with the editor around them.
 */
export const pageDrawing: DrawingEnvironment = {
  paint: pagePaint,
  live: true,
  Frame: PageFrame,
  Layers: PageLayers,
  idOf: () => null,
};
