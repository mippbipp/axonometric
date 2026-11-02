import type { GridPoint, ScreenPoint } from "@axonometric/contracts";
import { createContext, use } from "react";

/** A hop being drawn: where it starts, and where it ends once that is picked. */
export interface HopDraft {
  readonly from: string;
  readonly to: string | null;
}

/**
 * A drag from an edge handle in progress: the structure it left, the handle
 * it left from, where the pointer is on the ground and the structure under it.
 */
export interface HopStretch {
  readonly from: string;
  /** Where the handle is drawn, on screen. */
  readonly start: ScreenPoint;
  readonly end: GridPoint;
  /** The structure under the pointer, or `null` over empty space. */
  readonly over: string | null;
}

/**
 * The hop the engineer is drawing. A drag from an edge handle is the
 * `stretch`; dropping it on a structure makes the `draft`, which the side
 * panel's form holds until it is sent or cancelled. "Draw hop from here"
 * starts a draft with the start and lets the form pick the end. The map draws
 * a line for both, and the spotlight lights their two ends.
 */
export interface HopDrafting {
  readonly draft: HopDraft | null;
  readonly stretch: HopStretch | null;
  /** Starts a draft from `from`, ending at `to` when given. */
  readonly begin: (from: string, to?: string) => void;
  /** Sets where the draft ends. */
  readonly pick: (to: string | null) => void;
  /** Drops the draft. */
  readonly cancel: () => void;
  /** Sets the drag in progress, or ends it with `null`. */
  readonly stretchTo: (stretch: HopStretch | null) => void;
}

export const HopDraftContext = createContext<HopDrafting | null>(null);

/** The hop draft, or `null` outside a page that can propose. */
export const useHopDraft = (): HopDrafting | null => use(HopDraftContext);
