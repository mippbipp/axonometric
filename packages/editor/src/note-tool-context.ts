import type { GridPoint } from "@axonometric/contracts";
import { createContext, use } from "react";

/**
 * The Note tool, which pins a note to an empty spot, and the spot it picked.
 *
 * While the tool is armed, a click on empty ground picks the nearest spot on
 * the half-unit grid and opens the spot's panel. The keyboard has a path of
 * its own: a grid cursor starts near the middle of the map, the arrow keys
 * move it half a unit (Shift moves it five), and Enter picks the spot under
 * it. A click on a spot's ring opens that panel too. The picked spot clears
 * when a structure or a hop is selected.
 */
export interface NoteTool {
  /** Whether a click on the map picks a spot, and the arrows move the cursor. */
  readonly armed: boolean;
  /** The grid cursor while the tool is armed, else `null`. */
  readonly cursor: GridPoint | null;
  /** The spot whose panel is open, or `null`. */
  readonly spot: GridPoint | null;
  readonly arm: (armed: boolean) => void;
  /** Opens the panel of `spot`, or closes it with `null`. */
  readonly pick: (spot: GridPoint | null) => void;
}

export const NoteToolContext = createContext<NoteTool | null>(null);

/** The Note tool, or `null` outside a `NoteToolProvider`. */
export const useNoteTool = (): NoteTool | null => use(NoteToolContext);
