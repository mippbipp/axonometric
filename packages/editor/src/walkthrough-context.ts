import type { ChapterStop, MapState } from "@axonometric/contracts";
import { createContext, use } from "react";

import type { FlowChoice, PacketRun } from "./chapters.ts";

/**
 * The walkthrough's state, shared by every view of the map. Views read
 * `revealed`, `newlyRevealed` and `fit` to decide what to draw, and `runs` to know
 * what the packets play.
 */
export interface Walkthrough {
  readonly state: MapState;
  readonly stops: readonly ChapterStop[];
  /** The current chapter's position in `stops`. */
  readonly index: number;
  readonly stop: ChapterStop;
  readonly isLast: boolean;
  /** Every structure revealed by the current chapter or an earlier one. */
  readonly revealed: ReadonlySet<string>;
  /** The structures the current chapter reveals for the first time. */
  readonly newlyRevealed: ReadonlySet<string>;
  /**
   * The structures a view should zoom to fit. Today that's everything
   * revealed so far.
   */
  readonly fit: ReadonlySet<string>;
  readonly flowChoice: FlowChoice;
  /** The hop lists the packets play, one packet per run. */
  readonly runs: readonly PacketRun[];
  /**
   * Names the current chapter and flow choice together. Playback restarts
   * when it changes.
   */
  readonly playKey: string;
  readonly goTo: (index: number) => void;
  readonly next: () => void;
  readonly back: () => void;
  readonly chooseFlow: (choice: FlowChoice) => void;
}

export const WalkthroughContext = createContext<Walkthrough | null>(null);

/** The walkthrough state. Call it inside a `WalkthroughProvider`. */
export const useWalkthrough = (): Walkthrough => {
  const value = use(WalkthroughContext);

  if (value === null) {
    throw new Error("useWalkthrough needs a WalkthroughProvider above it.");
  }

  return value;
};
