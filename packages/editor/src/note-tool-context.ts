import type { GridPoint } from "@axonometric/contracts";
import { createContext, use } from "react";

/**
 * The Note tool, which pins a note to an empty spot, and the spot it picked.
 *
 * While the tool is armed, a click on empty ground picks the nearest spot on
 * the half-unit grid and opens the spot's panel. A click on a spot's marker
 * opens that panel too. The picked spot clears when a structure or a hop is
 * selected.
 */
export interface NoteTool {
  /** Whether a click on the map picks a spot. */
  readonly armed: boolean;
  /** The spot whose panel is open, or `null`. */
  readonly spot: GridPoint | null;
  readonly arm: (armed: boolean) => void;
  /** Opens the panel of `spot`, or closes it with `null`. */
  readonly pick: (spot: GridPoint | null) => void;
}

export const NoteToolContext = createContext<NoteTool | null>(null);

/** The Note tool, or `null` outside a `NoteToolProvider`. */
export const useNoteTool = (): NoteTool | null => use(NoteToolContext);
