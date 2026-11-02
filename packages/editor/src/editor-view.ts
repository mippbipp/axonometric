import type { Placement, ScreenRect, View } from "@axonometric/contracts";
import { createContext } from "react";

/** What the page's editing layers need to know about the view they sit in. */
export interface EditorView {
  readonly view: View;
  /** Where each structure is shown now. */
  readonly placements: Readonly<Partial<Record<string, Placement>>>;
  /** The structures the chapter reveals. */
  readonly revealed: ReadonlySet<string>;
}

export const EditorViewContext = createContext<EditorView | null>(null);

/**
 * The box of every name tag, code chip and hop label drawn, on screen. It
 * changes with the scene, which an edit redraws, so it has a context of its
 * own: the layers that need only the view's placements don't redraw with it.
 */
export const EditorTextsContext = createContext<readonly ScreenRect[]>([]);
