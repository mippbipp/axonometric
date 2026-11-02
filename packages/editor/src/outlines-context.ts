import type { Placement } from "@axonometric/contracts";
import { createContext, use } from "react";

/**
 * Where structures would land if a drag in progress were dropped. The
 * outlines are drawn from here, in a layer under the zones, so they never
 * cross a zone title, a name tag or a hop label.
 */
export interface DropOutlines {
  /** Each structure on the move, where it was and where it would go. */
  readonly moving: readonly {
    readonly id: string;
    readonly from: Placement;
    readonly to: Placement;
  }[];
  /** Why the drop would be refused, or nothing when it wouldn't. */
  readonly refusal: string | undefined;
}

export interface DropOutlinesState {
  readonly outlines: DropOutlines | undefined;
  readonly set: (outlines: DropOutlines | undefined) => void;
}

export const DropOutlinesContext = createContext<DropOutlinesState | null>(
  null
);

/** The drag's outlines and a way to set them, or `null` outside a provider. */
export const useDropOutlines = (): DropOutlinesState | null =>
  use(DropOutlinesContext);
