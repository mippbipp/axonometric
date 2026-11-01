import { createContext, use } from "react";

/** The structure under the pointer or keyboard focus, and where it is. */
export interface Hovered {
  readonly id: string;
  /** Where to draw the tooltip, in window coordinates. */
  readonly x: number;
  readonly y: number;
}

export interface TooltipActions {
  readonly show: (hovered: Hovered) => void;
  /** Hides the tooltip if it's showing structure `id`. */
  readonly hide: (id: string) => void;
}

export const HoveredContext = createContext<Hovered | null>(null);

export const TooltipActionsContext = createContext<TooltipActions | null>(null);

/** Shows and hides the structure tooltip. Call it inside a `TooltipProvider`. */
export const useTooltipActions = (): TooltipActions => {
  const value = use(TooltipActionsContext);

  if (value === null) {
    throw new Error("useTooltipActions needs a TooltipProvider above it.");
  }

  return value;
};
