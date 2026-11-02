import type { ReviewEntry } from "@axonometric/contracts";
import { createContext, use } from "react";

import type { ReviewOps } from "./served-store.ts";

/**
 * Notes and the review loop, for a page that `serve` serves. The read-only
 * file has no `ReviewContext`, so it shows no notes and no review buttons.
 */
export interface Review {
  /** Whether writes can be sent now. False while the server is down. */
  readonly canWrite: boolean;
  /** The absolute path of the map's home folder. */
  readonly home: string;
  /**
   * Every note, open or in a batch, with its status. A reviewed note that
   * the engineer dismissed is left out.
   */
  readonly notes: readonly ReviewEntry[];
  /** Every item with a status: open, frozen in a batch, or reviewed. */
  readonly entries: readonly ReviewEntry[];
  /** How many notes are open: not in a batch yet. */
  readonly openNotes: number;
  /** For an item reopened after a rejection, the rejected item's id. */
  readonly replaces: Readonly<Record<string, string>>;
  readonly ops: ReviewOps;
}

export const ReviewContext = createContext<Review | null>(null);

/** The review state, or `null` on a page that can't review. */
export const useReview = (): Review | null => use(ReviewContext);
