import type { LayoutChange, MapProblem } from "@axonometric/contracts";
import { createContext, use } from "react";

/**
 * Shows what a drag in progress would leave: `show` takes the layout
 * changes the drag would make, and the warnings `check` would print for the
 * layout that results appear in `DragWarnings`. `show(undefined)` clears
 * them. Dragging only calls `show`; it never has to re-render for the result.
 */
export interface DragPreview {
  readonly show: (changes: readonly LayoutChange[] | undefined) => void;
}

export const PreviewContext = createContext<DragPreview | null>(null);

export const WarningsContext = createContext<readonly MapProblem[]>([]);

/** The drag preview, or `null` outside a `DragPreviewProvider`. */
export const useDragPreview = (): DragPreview | null => use(PreviewContext);

/** The warnings the drag in progress would add. */
export const useDragWarnings = (): readonly MapProblem[] =>
  use(WarningsContext);
