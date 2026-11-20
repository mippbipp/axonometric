import { createContext, use } from "react";

/** The side panel's tabs. */
export type Tab = "details" | "questions" | "flows" | "pending" | "history";

/**
 * The tab the engineer chose, which the side panel shows while the
 * selection is the one it was chosen under. The notices outside the panel
 * choose a tab through the same value.
 */
export interface SideTab {
  readonly choose: (tab: Tab) => void;
  /** The chosen tab, or Details once the selection has changed. */
  readonly chosen: Tab;
}

export const SideTabContext = createContext<SideTab | null>(null);

/** The side panel's chosen tab. Needs a `SideTabProvider`. */
export const useSideTab = (): SideTab => {
  const value = use(SideTabContext);

  if (value === null) {
    throw new Error("useSideTab needs a SideTabProvider");
  }

  return value;
};
