import type {
  CanvasSize,
  MapState,
  SceneStructure,
  View,
} from "@axonometric/contracts";
import {
  cachedSceneOf,
  dashes,
  fitKeyOf,
  fittedViewOf,
  marked as marksOf,
  proposedHopMark,
  removedHopMark,
  groundOutline,
  groundProjections,
  toPoints,
} from "@axonometric/contracts";
import { DrawingContext, MapDrawing, viewDrawings } from "@axonometric/drawing";
import type { HopState } from "@axonometric/drawing";
import { CanvasItems } from "@axonometric/ui/components/canvas-items";
import { Array as Arr, String as Str } from "effect";
import { use, useCallback, useId, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import { ChapterPendingLook } from "./chapter-pending-look.tsx";
import { useCompare } from "./compare-context.ts";
import { CompareHops, CompareRings } from "./compare-look.tsx";
import { useProposedHopsIgnoringEdit } from "./connections-context.ts";
import { useDraftOutline } from "./draft-spot.ts";
import { DrawnShiftContext } from "./drag-shift.ts";
import type { DragShift } from "./drag-shift.ts";
import { DragOutlines } from "./drop-outline.tsx";
import { useEditing } from "./editing-context.ts";
import { EditorSceneContext, EditorViewContext } from "./editor-view.ts";
import { GroupEditor } from "./group-editor.tsx";
import { HopDraftLine } from "./hop-draft-line.tsx";
import { NewStructureSpot } from "./new-structure-spot.tsx";
import { spotRingCorners, useNoteBearers } from "./note-bearers.ts";
import { NoteMarkers } from "./note-markers.tsx";
import { SpotCursor, SpotPicker } from "./note-tool.tsx";
import { pageDrawing } from "./page-environment.ts";
import { AcceptedOutlines } from "./pending-look.tsx";
import { PendingZones } from "./pending-zones.tsx";
import { PlaybackContext } from "./playback.ts";
import { RemovedHopMarks } from "./removed-hop-marks.tsx";
import { RemovedMarks } from "./removed-marks.tsx";
import { RouteEditor } from "./route-editor.tsx";
import { useSelection } from "./selection-context.ts";
import { SelectionMarker } from "./selection-marker.tsx";
import {
  DrawnSpotlightContext,
  useSpotlight,
  useSpotlightActions,
} from "./spotlight-context.ts";
import { structureIdsOf, structureKey } from "./structure-key.ts";
import { Viewport } from "./viewport.tsx";

/** A dashed outline around the footprint of a newly revealed structure. */
function NewMarker({
  placed,
  view,
}: {
  readonly placed: SceneStructure;
  readonly view: View;
}) {
  const { d, w, x, y } = placed.placement;

  return (
    <polygon
      className="stroke-ink motion-safe:animate-pulse"
      data-new-marker={placed.structure.id}
      fill="none"
      points={toPoints(
        groundOutline(
          { d: d + 0.4, w: w + 0.4, x: x - 0.2, y: y - 0.2 },
          groundProjections[view]
        )
      )}
      strokeDasharray={dashes.fresh}
      strokeWidth={1.4}
    />
  );
}

const none: ReadonlySet<string> = new Set();

/**
 * The hop whose packet is selected, or `undefined` outside a playback
 * provider or with nothing selected.
 */
const useSelectedHop = () => use(PlaybackContext)?.selected?.hop.id;

/**
 * A view of a map, the Iso view or Plan view: each revealed structure as
 * its shape with a name tag, and each hop between revealed structures as an
 * arrow along the ground, over each group's zone fitted to its revealed
 * structures, in a viewport you can pan and zoom. Everything is drawn from
 * the contracts scene, which keeps every name tag, label, zone title and
 * chip clear of each other and of the boxes. The view fits the structures
 * in `fitTo` and the hops between them, and fits again when `fitKey`
 * changes. Parts outside the spotlight are drawn faded; see
 * `SpotlightProvider`. Switching `view` keeps the viewport, with the same ground
 * point in the middle. `children` draw on top, in the same coordinates, and pan
 * and zoom with the drawing.
 */
export function MapView({
  children,
  fitKey,
  revealed,
  fitTo = revealed,
  labelFirst,
  newlyRevealed = none,
  state,
  view,
}: {
  readonly children?: ReactNode;
  /**
   * Names what `fit` holds, such as the chapter. A new key refits the view;
   * other changes, such as a moved structure, keep the zoom. Defaults to the
   * set of ids in `fitTo`.
   */
  readonly fitKey?: string;
  /** The structures to zoom to fit. Defaults to every revealed one. */
  readonly fitTo?: ReadonlySet<string>;
  /** Hops whose labels get the first pick of spots, such as the chapter's. */
  readonly labelFirst?: ReadonlyArray<string>;
  /** The structures to mark as new. */
  readonly newlyRevealed?: ReadonlySet<string>;
  /** The structures to draw. */
  readonly revealed: ReadonlySet<string>;
  readonly state: MapState;
  readonly view: View;
}) {
  // useId's output can hold characters that don't belong in url(#...).
  const idPrefix = Str.replaceAll(/\W/gu, "")(useId());
  const hatch = `${idPrefix}hatch`;
  const selectedHop = useSelectedHop();
  const marks = useCompare();
  const { hoveredHop, spotlight: chapterSpotlight } = useSpotlight();
  const { hoverHop } = useSpotlightActions();
  const { multiSelection, selected, setMultiSelection } = useSelection();
  const canEdit = useEditing()?.canEdit === true;
  // CanvasItems keys structures by structureKey; the selection holds ids.
  const multiSelected = useMemo(
    () => Arr.map([...multiSelection], structureKey),
    [multiSelection]
  );
  // The zoom the text is sized for, which the viewport reports as it zooms.
  const [textZoom, setTextZoom] = useState(1);
  const drawnShift = useRef<DragShift | undefined>(undefined);

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

  // The scene at the zoom the text is sized for. It's the one the fit drew
  // when the viewport is at the fitted zoom, as the cache returns it.
  const scene = useMemo(
    () =>
      cachedSceneOf({
        data: state.data,
        labelFirst,
        layout: state.layout,
        revealed,
        view,
        zoom: textZoom,
      }),
    [state.data, state.layout, revealed, labelFirst, view, textZoom]
  );

  // A hop a proposal draws or deletes stays at full strength, whichever
  // chapter is showing: no chapter plays it, and fading it would hide the
  // proposal. Exports read the chapter's spotlight, not this one; read_view
  // reads this one, through DrawnSpotlightContext.
  const spotlight = useMemo(
    () =>
      chapterSpotlight === null || hopStates.size === 0
        ? chapterSpotlight
        : {
            hops: new Set([...chapterSpotlight.hops, ...hopStates.keys()]),
            structures: chapterSpotlight.structures,
          },
    [chapterSpotlight, hopStates]
  );

  const drawing = viewDrawings[view];

  const marked = drawing.newRing
    ? Arr.filter(scene.structures, ({ structure }) =>
        newlyRevealed.has(structure.id)
      )
    : [];

  const bearers = useNoteBearers();

  // The new structure's footprint counts in the fit while the form is open,
  // so it is never off the canvas.
  const candidate = useDraftOutline();
  const candidateSpot = candidate?.spot;

  const candidateCorners = useMemo(
    () =>
      candidateSpot === undefined
        ? []
        : groundOutline(candidateSpot, groundProjections[view]),
    [candidateSpot, view]
  );

  const fit = useCallback(
    (size: CanvasSize) =>
      fittedViewOf({
        chapter: { plays: labelFirst ?? [], revealed },
        // A spot can lie far from everything else, so its ring counts in the
        // fit. It is the page's editing layer, so an export's extent leaves
        // it out.
        extra: (fitted) => [
          ...spotRingCorners(fitted, bearers),
          ...candidateCorners,
        ],
        fitTo,
        size,
        state,
        view,
      }).camera,
    [labelFirst, revealed, bearers, candidateCorners, fitTo, state, view]
  );

  // The view fits again when the form opens and when it picks a new default
  // spot. A spot the engineer picked doesn't move the map under their hand.
  // While a spot is being found the last one stays, so typing doesn't refit.
  const candidateKey =
    candidate === null
      ? ""
      : candidate.picked || candidateSpot === undefined
        ? "+adding"
        : `+adding ${candidateSpot.x},${candidateSpot.y}`;

  const key = `${fitKey ?? fitKeyOf(fitTo)}${candidateKey}`;

  const editorView = useMemo(
    () => ({ placements: state.layout.structures, revealed, view }),
    [view, state.layout.structures, revealed]
  );

  return (
    <DrawingContext value={pageDrawing}>
      <EditorViewContext value={editorView}>
        <EditorSceneContext value={scene}>
          <DrawnSpotlightContext value={spotlight}>
            <DrawnShiftContext value={drawnShift}>
              <Viewport
                fit={fit}
                fitKey={key}
                ground={groundProjections[view]}
                onTextZoom={setTextZoom}
                title={`${drawing.title} of ${state.data.overview.title}`}
              >
                <CanvasItems
                  multiple={canEdit}
                  onSelectedChange={(keys) => {
                    setMultiSelection(structureIdsOf(keys));
                  }}
                  pinned={selected === null ? null : structureKey(selected)}
                  selected={multiSelected}
                >
                  <MapDrawing
                    ground={
                      <>
                        <DragOutlines view={view} />
                        <SpotPicker view={view} />
                      </>
                    }
                    hatch={hatch}
                    hopsOverlay={
                      <>
                        <HopDraftLine
                          revealed={revealed}
                          state={state}
                          view={view}
                        />
                        <RouteEditor
                          hops={scene.hops}
                          onHover={hoverHop}
                          placements={state.layout.structures}
                          view={view}
                        />
                        <ChapterPendingLook scene={scene} view={view} />
                      </>
                    }
                    hopStates={hopStates}
                    labelShown={(hop) =>
                      hop === selectedHop || hop === hoveredHop
                    }
                    newlyRevealed={newlyRevealed}
                    onHopHover={hoverHop}
                    overlay={
                      <>
                        <NoteMarkers scene={scene} />
                        <RemovedMarks scene={scene} view={view} />
                        <RemovedHopMarks />
                        <SpotCursor view={view} />
                      </>
                    }
                    scene={scene}
                    spotlight={spotlight}
                    underlay={
                      <>
                        <PendingZones scene={scene} />
                        <GroupEditor
                          data={state.data}
                          layout={state.layout}
                          view={view}
                          zones={scene.zones}
                        />
                        <g>
                          {Arr.map(marked, (item) => (
                            <NewMarker
                              key={item.structure.id}
                              placed={item}
                              view={view}
                            />
                          ))}
                          <SelectionMarker
                            placements={state.layout.structures}
                            view={view}
                          />
                          <AcceptedOutlines
                            structures={scene.structures}
                            view={view}
                          />
                          <NewStructureSpot view={view} />
                          <CompareRings
                            marks={marks}
                            structures={scene.structures}
                            view={view}
                          />
                          <CompareHops hops={scene.hops} marks={marks} />
                        </g>
                      </>
                    }
                  />
                  {children}
                </CanvasItems>
              </Viewport>
            </DrawnShiftContext>
          </DrawnSpotlightContext>
        </EditorSceneContext>
      </EditorViewContext>
    </DrawingContext>
  );
}
