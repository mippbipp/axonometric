import { useDrawing } from "./drawing-context.ts";
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
  faded,
  look,
  children,
}: StructureFrameProps) {
  const { idOf } = useDrawing();

  return (
    <g
      id={idOf("structure", id) ?? undefined}
      data-structure={id}
      data-shape={shape}
      data-status={status}
      data-new={isNew}
      data-faded={faded}
      {...frameAttributes({ look, faded })}
    >
      <title>{name}</title>
      {children}
    </g>
  );
}
