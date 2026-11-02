import { defaultSpotFor } from "@axonometric/contracts";
import type { Placement } from "@axonometric/contracts";
import { useMemo } from "react";

import { newStructureFootprint } from "./new-structure.ts";
import { usePlacing } from "./place-context.ts";
import { useProposed } from "./proposed-context.ts";

/** Where the structure in the add form would go. */
export interface DraftSpot {
  readonly spot: Placement;
  /** Whether the engineer picked or typed it, rather than the form choosing. */
  readonly picked: boolean;
  /**
   * How many warnings the proposed map gains from a structure there. For a
   * spot the form chose, anything above nothing means no clear spot was
   * within reach.
   */
  readonly added: number | undefined;
}

/**
 * Where the structure in the add form would go: the spot the engineer picked
 * or typed, else the nearest spot to the chosen group's zone where the
 * proposed map gains no warning, which follows the group, shape and name
 * until a spot is picked. `null` when the form isn't open or the page can't
 * propose.
 */
export const useDraftSpot = (): DraftSpot | null => {
  const placing = usePlacing();
  const proposing = useProposed();
  const open = placing?.open === true;
  const draft = placing?.draft;
  const picked = placing?.spot ?? null;
  const proposed = proposing?.proposed.state;
  const group = draft?.group;
  const shape = draft?.shape;
  const name = draft?.name.trim();

  const chosen = useMemo(
    () =>
      !open ||
      picked !== null ||
      proposed === undefined ||
      group === undefined ||
      shape === undefined
        ? null
        : defaultSpotFor({
            data: proposed.data,
            layout: proposed.layout,
            group,
            shape,
            name: name === undefined || name === "" ? "New structure" : name,
          }),
    [open, picked, proposed, group, shape, name]
  );

  if (!open || proposing === null) {
    return null;
  }

  if (picked !== null) {
    return {
      spot: { ...picked, ...newStructureFootprint },
      picked: true,
      added: undefined,
    };
  }

  return chosen === null
    ? null
    : { spot: chosen.spot, picked: false, added: chosen.added };
};
