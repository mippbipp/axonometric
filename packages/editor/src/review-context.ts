import type {
  BatchItem,
  ItemStatus,
  ReviewEntry,
} from "@axonometric/contracts";
import { Array as Arr } from "effect";
import { dual } from "effect/Function";
import { createContext, use } from "react";

import type { ReviewOps } from "./served-store.ts";

/**
 * Notes and the review loop, for a page that `serve` serves. The read-only
 * file has no `ReviewContext`, so it shows no notes and no review buttons.
 */
export interface Review {
  /** Whether writes can be sent now. False while the server is down. */
  readonly canWrite: boolean;
  /**
   * Every note, open or in a batch, with its status. A reviewed note that
   * the engineer dismissed is left out.
   */
  readonly notes: readonly ReviewEntry[];
  /** Every item with a status: open, frozen in a batch, or reviewed. */
  readonly entries: readonly ReviewEntry[];
  /**
   * How many notes, text suggestions, answers and raised questions are open:
   * not in a batch yet.
   */
  readonly openWords: number;
  /** For an item reopened after a rejection, the rejected item's id. */
  readonly replaces: Readonly<Record<string, string>>;
  readonly ops: ReviewOps;
}

export const ReviewContext = createContext<Review | null>(null);

/** The review state, or `null` on a page that can't review. */
export const useReview = (): Review | null => use(ReviewContext);

/** One entry of item kind `K`, with its status. */
export interface KindEntry<K extends BatchItem["kind"]> {
  readonly item: Extract<BatchItem, { kind: K }>;
  readonly status: ItemStatus;
}

/** Whether a reviewed item has been dismissed, which takes it off the page. */
export const isDismissed = ({ status }: ReviewEntry): boolean =>
  status.state === "reviewed" && status.dismissed;

/** The entries of item kind `kind` that are still on the page. */
export const entriesOfKind: {
  <K extends BatchItem["kind"]>(
    kind: K
  ): (entries: readonly ReviewEntry[]) => readonly KindEntry<K>[];
  <K extends BatchItem["kind"]>(
    entries: readonly ReviewEntry[],
    kind: K
  ): readonly KindEntry<K>[];
} = dual(
  2,
  <K extends BatchItem["kind"]>(
    entries: readonly ReviewEntry[],
    kind: K
  ): readonly KindEntry<K>[] =>
    Arr.flatMap(entries, (entry): readonly KindEntry<K>[] =>
      entry.item.kind === kind && !isDismissed(entry)
        ? // SAFETY: `kind` was just checked, and `item` is a member of the union tagged `K`.
          [
            {
              item: entry.item as Extract<BatchItem, { kind: K }>,
              status: entry.status,
            },
          ]
        : []
    )
);
