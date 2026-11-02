import { createContext, use } from "react";

/** A hop being drawn: where it starts, and where it ends once that is picked. */
export interface HopDraft {
  readonly from: string;
  readonly to: string | null;
}

/**
 * The hop the engineer is drawing. The side panel's form holds it until it is
 * sent or cancelled, and the map draws a dashed line for it. A drag from an
 * edge handle starts it with both ends; "Draw hop from here" starts it with
 * the start and lets the form pick the end.
 */
export interface HopDrafting {
  readonly draft: HopDraft | null;
  /** Starts a draft from `from`, ending at `to` when given. */
  readonly begin: (from: string, to?: string) => void;
  /** Sets where the draft ends. */
  readonly pick: (to: string | null) => void;
  /** Drops the draft. */
  readonly cancel: () => void;
}

export const HopDraftContext = createContext<HopDrafting | null>(null);

/** The hop draft, or `null` outside a page that can propose. */
export const useHopDraft = (): HopDrafting | null => use(HopDraftContext);
