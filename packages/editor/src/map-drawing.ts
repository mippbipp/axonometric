import {
  cachedSceneOf,
  fitKeyOf,
  fittedViewOf,
  marked as marksOf,
  proposedHopMark,
  removedHopMark,
} from "@axonometric/contracts";
import type { CanvasSize, MapState, View } from "@axonometric/contracts";
import type { HopState } from "@axonometric/drawing";
import { Array as Arr } from "effect";
import { useCallback, useMemo, useRef } from "react";

import { useProposedHopsIgnoringEdit } from "./connections-context.ts";
import { useDraftOutline } from "./draft-spot.ts";
import { useDrawnMap } from "./drawn-map.ts";
import { fitExtraPoints, fitExtrasOf } from "./fit-extras.ts";
import { useNoteBearers } from "./note-bearers.ts";
import { useSpotlight } from "./spotlight-context.ts";
import {
  labelledHopsOf,
  useOtherFlowLabels,
  useWarmFlowScenes,
} from "./warm-flow-scenes.ts";

/**
 * What a map view draws, worked out from the map it is given: the map it
 * draws now (see `useDrawnMap`), its scene at the zoom the text is sized for,
 * the fit and the key it fits by, and how the page marks the hops proposals
 * touch.
 */
export const useMapDrawing = ({
  fitKey,
  fitTo,
  labelFirst,
  revealed: nextRevealed,
  state: nextState,
  textZoom,
  view,
}: {
  readonly fitKey: string | undefined;
  readonly fitTo: ReadonlySet<string>;
  readonly labelFirst: ReadonlyArray<string> | undefined;
  readonly revealed: ReadonlySet<string>;
  readonly state: MapState;
  readonly textZoom: number;
  readonly view: View;
}) => {
  const { play } = useSpotlight();
  const proposedHops = useProposedHopsIgnoringEdit();

  // How the page marks the hops its proposals draw, relabel or delete. A
  // file's drawing passes none.
  const hopStates = useMemo((): ReadonlyMap<string, HopState> => {
    if (proposedHops === undefined) {
      return new Map();
    }

    return new Map([
      ...Arr.map(
        [...marksOf(proposedHops, proposedHopMark)],
        (id): readonly [string, HopState] => [id, "proposed"]
      ),
      ...Arr.map(
        [...marksOf(proposedHops, removedHopMark)],
        (id): readonly [string, HopState] => [id, "removed"]
      ),
    ]);
  }, [proposedHops]);

  // Labels follow the play spotlight, so hovering never moves them. A hop a
  // proposal draws or deletes is at full strength too, so no label sits on it.
  const labelled = useMemo(
    () => labelledHopsOf(play, hopStates),
    [play, hopStates]
  );

  const otherFlows = useOtherFlowLabels({ data: nextState.data, hopStates });
  const fittedSize = useRef<CanvasSize | undefined>(undefined);

  // The new structure's footprint counts in the fit while the form is open,
  // so it is never off the canvas.
  const candidate = useDraftOutline();
  const candidateSpot = candidate?.spot;

  // The view fits again when the form opens and when it picks a new default
  // spot. A spot the engineer picked doesn't move the map under their hand.
  // While a spot is being found the last one stays, so typing doesn't refit.
  const candidateKey =
    candidate === null
      ? ""
      : candidate.picked || candidateSpot === undefined
        ? "+adding"
        : `+adding ${candidateSpot.x},${candidateSpot.y}`;

  const bearers = useNoteBearers();

  // What the fit counts besides the map, as plain data the worker's fit
  // counts too, so both try the same zooms.
  const extras = useMemo(
    () => fitExtrasOf(bearers, candidateSpot),
    [bearers, candidateSpot]
  );

  const drawn = useDrawnMap({
    as: { labelFirst, labelled, later: otherFlows, view, zoom: textZoom },
    extras,
    fitTo,
    next: {
      fitKey: `${fitKey ?? fitKeyOf(fitTo)}${candidateKey}`,
      revealed: nextRevealed,
      state: nextState,
    },
    size: () => fittedSize.current,
  });

  const { revealed, state } = drawn;

  // The scene at the zoom the text is sized for. It's the one the fit drew
  // when the viewport is at the fitted zoom, as the cache returns it.
  const scene = useMemo(
    () =>
      cachedSceneOf({
        data: state.data,
        labelFirst,
        labelled,
        layout: state.layout,
        revealed,
        view,
        zoom: textZoom,
      }),
    [state.data, state.layout, revealed, labelFirst, labelled, view, textZoom]
  );

  useWarmFlowScenes({
    labelFirst,
    others: otherFlows,
    ready: drawn.warm,
    revealed,
    state,
    textZoom,
    view,
  });

  const fit = useCallback(
    (size: CanvasSize) => {
      fittedSize.current = size;

      return fittedViewOf({
        chapter: { plays: labelFirst ?? [], revealed },
        extra: (fitted) => fitExtraPoints(fitted, extras),
        fitTo,
        labelled,
        size,
        state,
        view,
      }).camera;
    },
    [labelFirst, labelled, revealed, extras, fitTo, state, view]
  );

  return {
    fit,
    fitKey: drawn.fitKey,
    hopStates,
    revealed,
    scene,
    state,
  };
};
