import type { GridPoint, Shape, Status } from "@axonometric/contracts";
import { createContext, use } from "react";

/** What the add form holds while the engineer fills it in. */
export interface Draft {
  readonly group: string;
  readonly name: string;
  readonly shape: Shape;
  readonly status: Status;
}

/**
 * The form that adds a structure, and where its structure goes. The form
 * sits in the side panel and the map's spot picker draws its footprint, so
 * both read the same draft. The spot is where the engineer clicked or typed;
 * until then the form uses the first free slot beside the group's zone, and
 * the picker shows that.
 */
export interface Placing {
  readonly draft: Draft;
  /** Whether the form is open. */
  readonly open: boolean;
  /** Starts or stops waiting for a click. */
  readonly pick: (picking: boolean) => void;
  /** Whether the next click on the map picks a spot. */
  readonly picking: boolean;
  readonly setDraft: (draft: Draft) => void;
  readonly setOpen: (open: boolean) => void;
  /** Sets the spot, as a click or a typed position does. */
  readonly setSpot: (
    spot: GridPoint | null | ((held: GridPoint | null) => GridPoint | null)
  ) => void;
  /** The spot picked or typed, snapped to half units, or `null` for none yet. */
  readonly spot: GridPoint | null;
}

export const PlaceContext = createContext<Placing | null>(null);

/** The new-structure placement, or `null` outside a page that can propose. */
export const usePlacing = (): Placing | null => use(PlaceContext);
