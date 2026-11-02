import { spotlightOf } from "@axonometric/contracts";
import type { Spotlight, SpotlightTarget } from "@axonometric/contracts";
import { use, useMemo } from "react";

import { playedHopsOf } from "./chapters.ts";
import { PlaybackContext } from "./playback.ts";
import { SelectionContext } from "./selection-context.ts";
import { HoveredIdContext } from "./tooltip-context.ts";
import { useWalkthrough } from "./walkthrough-context.ts";

const hopTarget = (id: string | null | undefined): SpotlightTarget | null =>
  id === null || id === undefined ? null : { kind: "hop", id };

const structureTarget = (id: string | null): SpotlightTarget | null =>
  id === null ? null : { kind: "structure", id };

/**
 * What the map draws at full strength, or `null` when nothing fades. It
 * follows what the pointer is on (`hoveredHop` is a hop, and the tooltip's
 * structure is a structure), then what is pinned, then the chapter or picked
 * flow. A pinned hop is the selected packet's hop. Selecting a structure
 * closes the packet panel, so the two never disagree about which was last.
 *
 * Call it inside a `WalkthroughProvider`. The selection, playback and
 * tooltip providers are optional: without one, that part never pins or
 * hovers anything.
 */
export const useSpotlight = (
  hoveredHop: string | null = null
): Spotlight | null => {
  const { state, stop, revealed, flowChoice } = useWalkthrough();
  const hoveredStructure = use(HoveredIdContext);
  const pinnedStructure = use(SelectionContext)?.selected ?? null;
  const pinnedHop = use(PlaybackContext)?.selected?.hop.id;

  const play = useMemo(
    () => playedHopsOf({ state, stop, choice: flowChoice }),
    [state, stop, flowChoice]
  );

  return useMemo(
    () =>
      spotlightOf({
        data: state.data,
        revealed,
        play,
        hovered: hopTarget(hoveredHop) ?? structureTarget(hoveredStructure),
        pinned: hopTarget(pinnedHop) ?? structureTarget(pinnedStructure),
      }),
    [
      state.data,
      revealed,
      play,
      hoveredHop,
      hoveredStructure,
      pinnedHop,
      pinnedStructure,
    ]
  );
};
