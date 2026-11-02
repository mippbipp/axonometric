import { defaultSpotFor } from "@axonometric/contracts";
import type { Placement } from "@axonometric/contracts";

import { newStructureFootprint } from "./new-structure.ts";
import { usePlacing } from "./place-context.ts";
import { useProposed } from "./proposed-context.ts";

/**
 * Where the structure in the add form would go: the spot the engineer picked
 * or typed, else the first free slot beside the chosen group's zone, which
 * follows the group and shape until a spot is picked. `null` when the form
 * isn't open or the page can't propose.
 */
export const useDraftSpot = (): Placement | null => {
  const placing = usePlacing();
  const proposing = useProposed();

  if (placing === null || !placing.open || proposing === null) {
    return null;
  }

  if (placing.spot !== null) {
    return { ...placing.spot, ...newStructureFootprint };
  }

  const { data, layout } = proposing.proposed.state;

  return defaultSpotFor({
    data,
    layout,
    group: placing.draft.group,
    shape: placing.draft.shape,
  });
};
