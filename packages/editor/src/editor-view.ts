import type {
  Placement,
  ScreenPoint,
  ScreenRect,
  View,
} from "@axonometric/contracts";
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
 * What the scene drew, for the layers that must keep clear of it: the box of
 * every name tag, code chip and hop label, the outline of every structure,
 * and the zoom the text is sized for, which turns a gap of screen pixels
 * into drawing units. It changes with the scene, which an edit redraws, so it
 * has a context of its own: the layers that need only the view's placements
 * don't redraw with it.
 */
export interface SceneFacts {
  readonly texts: readonly ScreenRect[];
  readonly outlines: readonly (readonly ScreenPoint[])[];
  readonly zoom: number;
}

export const EditorSceneContext = createContext<SceneFacts>({
  texts: [],
  outlines: [],
  zoom: 1,
});
