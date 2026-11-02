import { pagePaint } from "@axonometric/drawing";
import type {
  DrawingEnvironment,
  StructureFrameProps,
} from "@axonometric/drawing";
import { frameAttributes } from "@axonometric/drawing";

import { StructureTarget } from "./structure-target.tsx";

/**
 * The group a structure's parts are drawn in on the page: a target that
 * hovers, focuses, selects and goes inside. Its stroke and dashes come from
 * the structure's look, as in a file, and `index.css` overrides them for a
 * pending change.
 */
export function PageFrame({
  id,
  shape,
  status,
  isNew,
  look,
  children,
}: StructureFrameProps) {
  return (
    <StructureTarget
      id={id}
      data-shape={shape}
      data-status={status}
      data-new={isNew}
      {...frameAttributes(look)}
    >
      {children}
    </StructureTarget>
  );
}

/**
 * How the page paints the drawing: with the stylesheet's CSS variables, so
 * the theme can change without drawing again, and with a target for each
 * structure.
 */
export const pageDrawing: DrawingEnvironment = {
  paint: pagePaint,
  live: true,
  Frame: PageFrame,
  idPrefix: undefined,
};
