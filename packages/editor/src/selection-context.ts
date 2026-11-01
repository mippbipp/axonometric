import { createContext, use } from "react";

/**
 * Which structure is selected, and whether its inside view is open. Shared
 * by every view of the map, so the Iso view, Plan view, the side index and
 * the side panel agree. #20 will widen `selected` to a set for multi-select.
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
  /** Selects a structure, or clears the selection with `null`. */
  readonly select: (id: string | null) => void;
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
