import { createContext, use } from "react";
import type { RefObject } from "react";

/** Whether the "How it's built" page is open over the map. */
export interface OverviewPageState {
  readonly open: boolean;
  /** Opens the page, or closes it and returns focus to its button. */
  readonly toggle: () => void;
  /** Closes the page and returns focus to its button. */
  readonly close: () => void;
  /** The header button that opens and closes the page. */
  readonly buttonRef: RefObject<HTMLButtonElement | null>;
  /** The page's element id, for the button's `aria-controls`. */
  readonly pageId: string;
}

export const OverviewPageContext = createContext<OverviewPageState | null>(
  null
);

/** The "How it's built" page's state. Call it inside an `OverviewProvider`. */
export const useOverviewPage = (): OverviewPageState => {
  const value = use(OverviewPageContext);

  if (value === null) {
    throw new Error("useOverviewPage needs an OverviewProvider above it.");
  }

  return value;
};
