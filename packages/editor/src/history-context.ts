import type { DifferenceLines, HistoryList } from "@axonometric/contracts";
import { createContext, use } from "react";

/**
 * The History panel, for a page that `serve` serves. The read-only file has
 * no `HistoryContext`, so it has no History tab.
 */
export interface HistoryPanel {
  /** The revisions, newest first, or `null` until the server has said. */
  readonly entries: HistoryList | null;
  /** The revision open or being opened, or `null` when the page shows the current map. */
  readonly opened: number | null;
  /** Whether the open revision is still being read. */
  readonly loading: boolean;
  /** Why the open revision couldn't be read, or `null`. */
  readonly failure: string | null;
  readonly open: (revision: number) => void;
  /**
   * How many changes are pending. The Pending tab keeps its count while a
   * past revision is open and editing is off.
   */
  readonly pendingCount: number;
  /**
   * How the open revision differs from the accepted map, while Compare is
   * on, or `null`.
   */
  readonly differences: DifferenceLines | null;
}

export const HistoryContext = createContext<HistoryPanel | null>(null);

/** The History panel, or `null` on a page without one. */
export const useHistory = (): HistoryPanel | null => use(HistoryContext);
