import { frameAttributes } from "@axonometric/drawing";
import type { StructureFrameProps } from "@axonometric/drawing";
import { use } from "react";
import type { ReactNode } from "react";

import { BoxSelect } from "./box-select.tsx";
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
        view={editor.view}
        placements={editor.placements}
        revealed={editor.revealed}
      />
      <LayoutEditor view={editor.view} placements={editor.placements}>
        {children}
      </LayoutEditor>
    </>
  );
}
