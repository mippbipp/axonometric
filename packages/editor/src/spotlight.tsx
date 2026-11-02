import { chapterSpotlightOf } from "@axonometric/contracts";
import type { SpotlightTarget } from "@axonometric/contracts";
import { use, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import { useHopDraft } from "./hop-draft-context.ts";
import { PlaybackContext } from "./playback.ts";
import { SelectionContext } from "./selection-context.ts";
import {
  SpotlightActionsContext,
  SpotlightContext,
} from "./spotlight-context.ts";
import type { SpotlightActions, SpotlightState } from "./spotlight-context.ts";
import { HoveredIdContext } from "./tooltip-context.ts";
import { useWalkthrough } from "./walkthrough-context.ts";

const hopTarget = (id: string | null | undefined): SpotlightTarget | null =>
  id === null || id === undefined ? null : { kind: "hop", id };

const structureTarget = (id: string | null): SpotlightTarget | null =>
  id === null ? null : { kind: "structure", id };

/**
 * Works out the spotlight once, for the map and the Export menu to read. It
 * follows what the pointer or keyboard focus is on (a hop, or the tooltip's
 * structure), then what is pinned (the selected packet's hop, or the
 * selection), then the chapter or picked flow. Selecting a structure closes
 * the packet panel, so the two pins never disagree about which was last.
 *
 * Put it inside the walkthrough, playback, selection and tooltip providers.
 */
export function SpotlightProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const { state, stop, flowChoice } = useWalkthrough();
  const hoveredStructure = use(HoveredIdContext);
  const pinnedStructure = use(SelectionContext)?.selected ?? null;
  const pinnedHop = use(PlaybackContext)?.selected?.hop.id;
  const [hoveredHop, setHoveredHop] = useState<string | null>(null);
  const drafting = useHopDraft();

  // A hop being drawn lights its two ends. Pointer capture stops the hover
  // reaching the structure under a drag, so the drag says which it is over.
  const stretch = drafting?.stretch;
  const draft = drafting?.draft;

  const drawing = useMemo(() => {
    if (stretch !== null && stretch !== undefined) {
      return { from: stretch.from, over: stretch.over };
    }

    return draft === null || draft === undefined
      ? null
      : { from: draft.from, over: draft.to };
  }, [stretch, draft]);

  const spotlight = useMemo(
    () =>
      chapterSpotlightOf({
        data: state.data,
        stop,
        choice: flowChoice,
        hovered: hopTarget(hoveredHop) ?? structureTarget(hoveredStructure),
        pinned: hopTarget(pinnedHop) ?? structureTarget(pinnedStructure),
        drawing,
      }),
    [
      state.data,
      stop,
      flowChoice,
      hoveredHop,
      hoveredStructure,
      pinnedHop,
      pinnedStructure,
      drawing,
    ]
  );

  const latest = useRef(spotlight);

  useLayoutEffect(() => {
    latest.current = spotlight;
  }, [spotlight]);

  const shown = useMemo(
    (): SpotlightState => ({ spotlight, hoveredHop }),
    [spotlight, hoveredHop]
  );

  const actions = useMemo(
    (): SpotlightActions => ({
      hoverHop: setHoveredHop,
      current: () => latest.current,
    }),
    []
  );

  return (
    <SpotlightActionsContext value={actions}>
      <SpotlightContext value={shown}>{children}</SpotlightContext>
    </SpotlightActionsContext>
  );
}
