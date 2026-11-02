import type { DraggedProblem, LayoutChange } from "@axonometric/contracts";
import { createContext, use } from "react";

/** What a drag in progress would do, and whether the drop would be refused. */
export interface DragPreviewInput {
  /** The layout changes the drop would make. */
  readonly changes: readonly LayoutChange[];
  /** Why the drop would be refused, or nothing when it wouldn't. */
  readonly refusal?: string | undefined;
}

/**
 * Shows what a drag in progress would leave. `show` takes the drag, and the
 * panel beside the map lists the reason a drop would be refused, or every
 * warning `check` would report for the layout the drop would make.
 * `show(undefined)` clears them. Dragging only calls `show`; it never has to
 * re-render for the result.
 */
export interface DragPreview {
  readonly show: (drag: DragPreviewInput) => void;
  /** Clears what `show` put up. */
  readonly clear: () => void;
}

/** What the panel shows for the drag in progress. */
export interface DragReport {
  /** Why the drop would be refused, or nothing when it wouldn't. */
  readonly refusal: string | undefined;
  /**
   * Every problem `check` would report for the layout the drop would make,
   * each marked when the layout before the drag didn't have it.
   */
  readonly problems: readonly DraggedProblem[];
}

export const PreviewContext = createContext<DragPreview | null>(null);

export const nothingReported: DragReport = { refusal: undefined, problems: [] };

export const ReportContext = createContext<DragReport>(nothingReported);

/** The drag preview, or `null` outside a `DragPreviewProvider`. */
export const useDragPreview = (): DragPreview | null => use(PreviewContext);

/** What the drag in progress would leave. */
export const useDragReport = (): DragReport => use(ReportContext);
