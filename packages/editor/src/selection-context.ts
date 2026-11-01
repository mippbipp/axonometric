import { createContext, use } from "react";

/**
 * Which structure is selected, and whether its inside view is open. Shared
 * by every view of the map, so the Iso view, Plan view, the side index and
 * the side panel agree.
 *
 * Beside the selection there is a multi-selection: the structures picked
 * together, with Shift-click or a selection box, to move, nudge, align and
 * distribute as one. It never opens a panel.
 */
export interface Selection {
  /**
   * The selected structure's id, or `null`. It is always revealed in the
   * current chapter: a chapter that hides it clears the selection.
   */
  readonly selected: string | null;
  /**
   * The structure whose inside view is open, or `null`. While it's set, it's
   * also `selected`.
   */
  readonly inside: string | null;
  /**
   * The structures in the multi-selection, all revealed in the current
   * chapter. A chapter that hides one drops it.
   */
  readonly marked: ReadonlySet<string>;
  /** Selects a structure, or clears the selection with `null`. Empties the multi-selection too. */
  readonly select: (id: string | null) => void;
  /**
   * Adds structure `id` to the multi-selection, or takes it out when it's
   * there. When the multi-selection is empty and another structure is
   * selected, that one joins it first.
   */
  readonly toggleMarked: (id: string) => void;
  /** Makes the multi-selection exactly `ids`. */
  readonly mark: (ids: readonly string[]) => void;
  /** Empties the multi-selection. The selection stays. */
  readonly clearMarked: () => void;
  /** Selects a structure and opens its inside view, if it has steps. */
  readonly goInside: (id: string) => void;
  /** Closes the inside view. The structure stays selected. */
  readonly comeOut: () => void;
}

export const SelectionContext = createContext<Selection | null>(null);

/** The selection. Call it inside a `SelectionProvider`. */
export const useSelection = (): Selection => {
  const value = use(SelectionContext);

  if (value === null) {
    throw new Error("useSelection needs a SelectionProvider above it.");
  }

  return value;
};
