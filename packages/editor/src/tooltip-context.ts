import type { TooltipController } from "@axonometric/ui/components/tooltip";
import { createContext, use } from "react";

/** The structure under the pointer or keyboard focus, and where it is. */
export interface Hovered {
  readonly id: string;
  /** Where to place the tooltip, in window coordinates. */
  readonly x: number;
  readonly y: number;
}

export interface TooltipActions {
  /**
   * Opens and closes the one tooltip every structure shares. A structure is a
   * trigger of it, with its id as the payload.
   */
  readonly controller: TooltipController<string>;
  /** Hides the tooltip if it's showing structure `id`. */
  readonly hide: (id: string) => void;
  /** The last structure shown, and where, for placing the tooltip. Kept while it fades out. */
  readonly last: () => Hovered | null;
  readonly show: (hovered: Hovered) => void;
}

/**
 * The id of the structure under the pointer or keyboard focus, or `null`. It
 * doesn't change as the pointer moves over the structure, so what reads only
 * the id doesn't draw again.
 */
export const HoveredIdContext = createContext<string | null>(null);

export const TooltipActionsContext = createContext<TooltipActions | null>(null);

/** Shows and hides the structure tooltip. Call it inside a `TooltipProvider`. */
export const useTooltipActions = (): TooltipActions => {
  const value = use(TooltipActionsContext);

  if (value === null) {
    throw new Error("useTooltipActions needs a TooltipProvider above it.");
  }

  return value;
};
