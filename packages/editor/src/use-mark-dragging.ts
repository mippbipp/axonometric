import { markDragging } from "@axonometric/ui/lib/canvas-drag";
import { useEffect } from "react";

/**
 * Counts a drag the page holds as state, such as a structure move, until
 * `active` is false. A drag on `bindCanvasDrag` counts itself.
 */
export const useMarkDragging = (active: boolean) => {
  useEffect(() => (active ? markDragging() : undefined), [active]);
};
