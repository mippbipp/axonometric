import type { Placement, Scene, View } from "@axonometric/contracts";
import { createContext } from "react";

/** What the page's editing layers need to know about the view they sit in. */
export interface EditorView {
  /** Where each structure is shown now. */
  readonly placements: Readonly<Partial<Record<string, Placement>>>;
  /** The structures the chapter reveals. */
  readonly revealed: ReadonlySet<string>;
  readonly view: View;
}

export const EditorViewContext = createContext<EditorView | null>(null);

/**
 * The scene the page draws, for the layers that must keep clear of it. It
 * changes with the scene, which an edit redraws, so it has a context of its
 * own: the layers that need only the view's placements don't redraw with it.
 */
export const EditorSceneContext = createContext<Scene | null>(null);
