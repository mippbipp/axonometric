import type { MapState, SceneStructure, View } from "@axonometric/contracts";
import {
  dashes,
  groundOutline,
  groundProjections,
  toPoints,
} from "@axonometric/contracts";
import { DrawingContext, MapDrawing, viewDrawings } from "@axonometric/drawing";
import { CanvasItems } from "@axonometric/ui/components/canvas-items";
import { Array as Arr, String as Str } from "effect";
import { use, useId, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import { ChapterPendingLook } from "./chapter-pending-look.tsx";
import { useCompare } from "./compare-context.ts";
import { CompareHops, CompareRings } from "./compare-look.tsx";
import { DrawnShiftContext } from "./drag-shift.ts";
import type { DragShift } from "./drag-shift.ts";
import { DragOutlines } from "./drop-outline.tsx";
import { useEditing } from "./editing-context.ts";
import { EditorSceneContext, EditorViewContext } from "./editor-view.ts";
import { GroupEditor } from "./group-editor.tsx";
import { HopDraftLine } from "./hop-draft-line.tsx";
import { useMapDrawing } from "./map-drawing.ts";
import { NewStructureSpot } from "./new-structure-spot.tsx";
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
  revealed: nextRevealed,
  fitTo = nextRevealed,
  labelFirst,
  newlyRevealed = none,
  state: nextState,
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

  const {
    fit,
    fitKey: drawnKey,
    hopStates,
    revealed,
    scene,
    state,
  } = useMapDrawing({
    fitKey,
    fitTo,
    labelFirst,
    revealed: nextRevealed,
    state: nextState,
    textZoom,
    view,
  });

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
                fitKey={drawnKey}
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
