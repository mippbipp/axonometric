import type { GridPoint, ScreenPoint } from "@axonometric/contracts";
import { createContext, use } from "react";

/** The key that starts drawing a hop from the focused structure. */
export const drawHopKey = "h";

/** A hop being drawn: where it starts, and where it ends once that is picked. */
export interface HopDraft {
  readonly from: string;
  readonly to: string | null;
}

/**
 * A hop line being drawn from an edge handle, by a drag or from the
 * keyboard: the structure it left, the handle it left from, where its loose
 * end is on the ground and the structure it aims at. It mirrors the draft
 * `EdgeHandles`' connect behavior holds.
 */
export interface HopStretch {
  readonly end: GridPoint;
  readonly from: string;
  /** The structure it aims at, or `null` over empty space. */
  readonly over: string | null;
  /** Where the handle is drawn, on screen. */
  readonly start: ScreenPoint;
}

/**
 * The hop the engineer is drawing. A line drawn from an edge handle is the
 * `stretch`; ending it on a structure makes the `draft`, which the side
 * panel's form holds until it is sent or cancelled. "Draw hop from here"
 * starts a draft with the start and lets the form pick the end. The map draws
 * a line for both, and the spotlight lights their two ends.
 */
export interface HopDrafting {
  /** Starts a draft from `from`, ending at `to` when given. */
  readonly begin: (from: string, to?: string) => void;
  /** Drops the draft. */
  readonly cancel: () => void;
  readonly draft: HopDraft | null;
  /** Sets where the draft ends. */
  readonly pick: (to: string | null) => void;
  readonly stretch: HopStretch | null;
  /**
   * Shows the line being drawn, or none with `null`. Only `EdgeHandles`
   * calls it, with what its connect behavior draws.
   */
  readonly stretchTo: (stretch: HopStretch | null) => void;
}

export const HopDraftContext = createContext<HopDrafting | null>(null);

/** The hop draft, or `null` outside a page that can propose. */
export const useHopDraft = (): HopDrafting | null => use(HopDraftContext);
