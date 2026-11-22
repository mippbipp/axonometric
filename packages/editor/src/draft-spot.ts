import type { Placement } from "@axonometric/contracts";
import { createContext, use } from "react";

/** A spot the form chose, and how many warnings a structure there adds. */
export interface ChosenSpot {
  /**
   * How many warnings the proposed map gains from a structure at `spot`.
   * Anything above nothing means no clear spot was within reach.
   */
  readonly added: number;
  readonly spot: Placement;
}

/** Where the structure in the add form would go. */
export type DraftSpot =
  /** The engineer picked or typed it. */
  | { readonly kind: "picked"; readonly spot: Placement }
  /** The form chose it, as `defaultSpotFor` does for the draft as it stands. */
  | ({ readonly kind: "chosen" } & ChosenSpot)
  /**
   * The form is finding one for the draft as it stands. `last` is the spot it
   * found for an earlier draft, which the map keeps showing meanwhile.
   */
  | { readonly kind: "finding"; readonly last: ChosenSpot | undefined };

/** The add form's spot, and whether its warnings are still being worked out. */
export interface DraftSpotState {
  /**
   * Whether the spot or the warnings for the draft as it stands are still
   * being worked out. The panel shows the last ones meanwhile.
   */
  readonly checking: boolean;
  readonly spot: DraftSpot;
}

/** The spot to show: the one in hand, or the last one found. */
export const spotShown = (drafted: DraftSpot): Placement | undefined =>
  drafted.kind === "finding" ? drafted.last?.spot : drafted.spot;

/**
 * What the map draws and fits for the add form: the spot to show, if any
 * yet, and whether the engineer picked it. It stays the same object while
 * the engineer types, so the map doesn't draw again for each key.
 */
export interface DraftOutline {
  readonly picked: boolean;
  readonly spot: Placement | undefined;
}

export const DraftSpotContext = createContext<DraftSpotState | null>(null);

export const DraftOutlineContext = createContext<DraftOutline | null>(null);

/** The add form's outline on the map, or `null` when the form isn't open. */
export const useDraftOutline = (): DraftOutline | null =>
  use(DraftOutlineContext);

/**
 * Where the structure in the add form would go: the spot the engineer picked
 * or typed, else the nearest spot to the chosen group's zone where the
 * proposed map gains no warning, which follows the group, shape and name
 * until a spot is picked. `null` when the form isn't open or the page can't
 * propose.
 */
export const useDraftSpot = (): DraftSpotState | null => use(DraftSpotContext);
