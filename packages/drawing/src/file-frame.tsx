import { useDrawing } from "./drawing-context.ts";
import { frameAttributes } from "./look.ts";
import type { StructureFrameProps } from "./structure-drawing.ts";

/**
 * The group a structure's parts are drawn in, in a file: its id, and its
 * full name as a title, since the name tag may show only its short tag.
 */
export function FileFrame({
  children,
  faded,
  id,
  isNew,
  look,
  name,
  shape,
  status,
}: StructureFrameProps) {
  const { idOf } = useDrawing();

  return (
    <g
      data-new={isNew}
      data-shape={shape}
      data-status={status}
      data-structure={id}
      id={idOf("structure", id) ?? undefined}
      {...frameAttributes({ faded, look })}
    >
      <title>{name}</title>
      {children}
    </g>
  );
}
