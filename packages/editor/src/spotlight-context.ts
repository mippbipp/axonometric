import type { Spotlight } from "@axonometric/contracts";
import { createContext, use } from "react";

/**
 * What the map draws at full strength, and the hop under the pointer, which
 * the map also uses to show that hop's label. Both change as the pointer
 * moves, so read this only where the drawing needs them.
 */
export interface SpotlightState {
  /** The spotlight, or `null` when nothing fades. */
  readonly spotlight: Spotlight | null;
  readonly hoveredHop: string | null;
}

/** What doesn't change as the pointer moves. */
export interface SpotlightActions {
  /** Called with the hop's id while the pointer is on its line, else null. */
  readonly hoverHop: (hop: string | null) => void;
  /**
   * The spotlight as it is when called, for what acts on a press, such as
   * an export. Reading it doesn't redraw the reader as the pointer moves.
   */
  readonly current: () => Spotlight | null;
}

export const SpotlightContext = createContext<SpotlightState | null>(null);

export const SpotlightActionsContext = createContext<SpotlightActions | null>(
  null
);

/** The spotlight. Call it inside a `SpotlightProvider`. */
export const useSpotlight = (): SpotlightState => {
  const value = use(SpotlightContext);

  if (value === null) {
    throw new Error("useSpotlight needs a SpotlightProvider above it.");
  }

  return value;
};

/** The spotlight's actions. Call it inside a `SpotlightProvider`. */
export const useSpotlightActions = (): SpotlightActions => {
  const value = use(SpotlightActionsContext);

  if (value === null) {
    throw new Error("useSpotlightActions needs a SpotlightProvider above it.");
  }

  return value;
};
