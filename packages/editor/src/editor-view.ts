import type { Placement, View } from "@axonometric/contracts";
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
