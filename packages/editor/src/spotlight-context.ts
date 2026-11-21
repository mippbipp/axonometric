import type { Spotlight, SpotlightTarget } from "@axonometric/contracts";
import { createContext, use } from "react";

/**
 * What the map draws at full strength, and the hop under the pointer, which
 * the map also uses to show that hop's label. Both change as the pointer
 * moves, so read this only where the drawing needs them.
 */
export interface SpotlightState {
  readonly hoveredHop: string | null;
  /** The spotlight, or `null` when nothing fades. */
  readonly spotlight: Spotlight | null;
}

/** What the spotlight follows: the pointer's target and the pinned one. */
export interface SpotlightTargets {
  readonly hovered: SpotlightTarget | null;
  readonly pinned: SpotlightTarget | null;
}

/** What doesn't change as the pointer moves. */
export interface SpotlightActions {
  /**
   * What the pointer is on and what is pinned, as they are when called, for
   * what acts on a press, such as an export. Reading them doesn't redraw the
   * reader as the pointer moves.
   */
  readonly current: () => SpotlightTargets;
  /** Called with the hop's id while the pointer is on its line, else null. */
  readonly hoverHop: (hop: string | null) => void;
  /**
   * Shows `spotlight` in place of the chapter's, for an agent presenting the
   * map, or `null` to give the chapter's back. It also ends when the
   * engineer's pointer, pin, drawing, chapter or flow choice changes what is
   * lit.
   */
  readonly lightUp: (spotlight: Spotlight | null) => void;
}

export const SpotlightContext = createContext<SpotlightState | null>(null);

/**
 * The spotlight the map draws: `SpotlightState.spotlight` with the hops a
 * proposal draws or deletes added, which stay at full strength. `MapView`
 * provides it, for what reports the map as drawn, such as `read_view`.
 */
export const DrawnSpotlightContext = createContext<Spotlight | null>(null);

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
