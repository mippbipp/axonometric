import type { HistoryList } from "@axonometric/contracts";
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
}

export const HistoryContext = createContext<HistoryPanel | null>(null);

/** The History panel, or `null` on a page without one. */
export const useHistory = (): HistoryPanel | null => use(HistoryContext);
