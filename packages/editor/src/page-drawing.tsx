import { frameAttributes } from "@axonometric/drawing";
import type { StructureFrameProps } from "@axonometric/drawing";
import { use } from "react";
import type { ReactNode } from "react";

import { BoxSelect } from "./box-select.tsx";
import { EdgeHandles } from "./edge-handles.tsx";
import { EditorViewContext } from "./editor-view.ts";
import { LayoutEditor } from "./layout-editor.tsx";
import { StructureTarget } from "./structure-target.tsx";

/**
 * The group a structure's parts are drawn in on the page: a target that
 * hovers, focuses, selects and goes inside. Its stroke and dashes come from
 * the structure's look, as in a file, and `index.css` overrides them for a
 * pending change or a selection.
 */
export function PageFrame({
  children,
  faded,
  id,
  isNew,
  look,
  shape,
  status,
}: StructureFrameProps) {
  return (
    <StructureTarget
      data-new={isNew}
      data-shape={shape}
      data-status={status}
      id={id}
      {...frameAttributes({ faded, look })}
    >
      {children}
    </StructureTarget>
  );
}

/**
 * The editing layers around the structures: box selection beside them, and
 * the layout editor, which drags and resizes them, around them. A file draws
 * neither.
 */
export function PageLayers({ children }: { readonly children: ReactNode }) {
  const editor = use(EditorViewContext);

  if (editor === null) {
    return children;
  }

  return (
    <>
      <BoxSelect
        placements={editor.placements}
        revealed={editor.revealed}
        view={editor.view}
      />
      <LayoutEditor placements={editor.placements} view={editor.view}>
        {children}
      </LayoutEditor>
      <EdgeHandles view={editor.view} />
    </>
  );
}
