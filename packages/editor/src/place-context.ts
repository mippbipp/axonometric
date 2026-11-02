import type { GridPoint } from "@axonometric/contracts";
import { createContext, use } from "react";

/**
 * Where the engineer is putting a new structure: the form is open and waits
 * for a click on the map (or a drop) to say where. While it waits, the map
 * shows the footprint under the pointer.
 */
export interface Placing {
  /** Whether the next click on the map picks a spot. */
  readonly picking: boolean;
  /** The spot picked so far, snapped to half units, or `null`. */
  readonly spot: GridPoint | null;
  /** Starts or stops waiting for a click. */
  readonly pick: (picking: boolean) => void;
  /** Sets the spot, as a click or a typed position does. */
  readonly setSpot: (spot: GridPoint | null) => void;
}

export const PlaceContext = createContext<Placing | null>(null);

/** The new-structure placement, or `null` outside a page that can propose. */
export const usePlacing = (): Placing | null => use(PlaceContext);
