import { partId, useDrawing } from "./drawing-context.ts";
import { frameAttributes } from "./look.ts";
import type { StructureFrameProps } from "./structure-drawing.ts";

/**
 * The group a structure's parts are drawn in, in a file: its id, and its
 * full name as a title, since the name tag may show only its short tag.
 */
export function FileFrame({
  id,
  name,
  shape,
  status,
  isNew,
  look,
  children,
}: StructureFrameProps) {
  const environment = useDrawing();

  return (
    <g
      id={partId(environment, "structure", id)}
      data-structure={id}
      data-shape={shape}
      data-status={status}
      data-new={isNew}
      {...frameAttributes(look)}
    >
      <title>{name}</title>
      {children}
    </g>
  );
}
