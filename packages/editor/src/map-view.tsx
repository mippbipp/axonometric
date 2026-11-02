import type { MapState, SceneStructure, View } from "@axonometric/contracts";
import {
  dashes,
  fitFloorOf,
  groundOutline,
  groundProjections,
  textZoomOf,
  toPoints,
} from "@axonometric/contracts";
import {
  DrawingContext,
  drawnIn,
  MapDrawing,
  viewDrawings,
} from "@axonometric/drawing";
import { Array as Arr, String as Str } from "effect";
import { use, useCallback, useId, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { ChapterPendingLook } from "./chapter-pending-look.tsx";
import { useCompare } from "./compare-context.ts";
import { CompareHops, CompareRings } from "./compare-look.tsx";
import { useDraftSpot } from "./draft-spot.ts";
import { DragOutlines } from "./drop-outline.tsx";
import { EditorViewContext } from "./editor-view.ts";
import { fitOf } from "./fit.ts";
import { GroupEditor } from "./group-editor.tsx";
import { NewStructureSpot } from "./new-structure-spot.tsx";
import { spotDrawn, useNoteBearers } from "./note-bearers.ts";
import { NoteMarkers } from "./note-markers.tsx";
import { SpotCursor, SpotPicker } from "./note-tool.tsx";
import { pageDrawing } from "./page-environment.ts";
import { AcceptedOutlines } from "./pending-look.tsx";
import { PendingZones } from "./pending-zones.tsx";
import { PlaybackContext } from "./playback.ts";
import { routesOf } from "./projection.ts";
import { RemovedMarks } from "./removed-marks.tsx";
import { RouteEditor } from "./route-editor.tsx";
import { cachedSceneOf } from "./scene-cache.ts";
import { SelectionMarker } from "./selection-marker.tsx";
import { useSpotlight, useSpotlightActions } from "./spotlight-context.ts";
import { Viewport } from "./viewport.tsx";

/** A dashed outline around the footprint of a newly revealed structure. */
function NewMarker({
  placed,
  view,
}: {
  readonly placed: SceneStructure;
  readonly view: View;
}) {
  const { x, y, w, d } = placed.placement;

  return (
    <polygon
      data-new-marker={placed.structure.id}
      points={toPoints(
        groundOutline(
          { x: x - 0.2, y: y - 0.2, w: w + 0.4, d: d + 0.4 },
          groundProjections[view]
        )
      )}
      fill="none"
      className="stroke-ink motion-safe:animate-pulse"
      strokeWidth={1.4}
      strokeDasharray={dashes.fresh}
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
  view,
  state,
  revealed,
  newlyRevealed = none,
  fitTo = revealed,
  fitKey,
  labelFirst,
  children,
}: {
  readonly view: View;
  readonly state: MapState;
  /** The structures to draw. */
  readonly revealed: ReadonlySet<string>;
  /** The structures to mark as new. */
  readonly newlyRevealed?: ReadonlySet<string>;
  /** The structures to zoom to fit. Defaults to every revealed one. */
  readonly fitTo?: ReadonlySet<string>;
  /**
   * Names what `fit` holds, such as the chapter. A new key refits the view;
   * other changes, such as a moved structure, keep the zoom. Defaults to the
   * set of ids in `fitTo`.
   */
  readonly fitKey?: string;
  /** Hops whose labels get the first pick of spots, such as the chapter's. */
  readonly labelFirst?: readonly string[];
  readonly children?: ReactNode;
}) {
  // useId's output can hold characters that don't belong in url(#...).
  const idPrefix = Str.replaceAll(/\W/gu, "")(useId());
  const hatch = `${idPrefix}hatch`;
  const selectedHop = useSelectedHop();
  const marks = useCompare();
  const { spotlight, hoveredHop } = useSpotlight();
  const { hoverHop } = useSpotlightActions();
  // The zoom the text is sized for, which the viewport reports as it zooms.
  const [textZoom, setTextZoom] = useState(1);

  // Fitting tries a few zooms, and the one it settles on is the one drawn,
  // so scenes are cached per zoom the text is sized for.
  const sceneAt = useCallback(
    (zoom: number) =>
      cachedSceneOf({
        data: state.data,
        layout: state.layout,
        revealed,
        routes: routesOf({ data: state.data, layout: state.layout, revealed }),
        labelFirst,
        view,
        zoom,
      }),
    [state.data, state.layout, revealed, labelFirst, view]
  );

  const scene = sceneAt(textZoom);

  const drawing = viewDrawings[view];

  const marked = drawing.newRing
    ? Arr.filter(scene.structures, ({ structure }) =>
        newlyRevealed.has(structure.id)
      )
    : [];

  const fitIds = useMemo(() => [...fitTo], [fitTo]);

  const bearers = useNoteBearers();

  // The new structure's footprint counts in the fit while the form is open,
  // so it is never off the canvas.
  const candidate = useDraftSpot();
  const candidateSpot = candidate?.spot;

  const candidateCorners = useMemo(
    () =>
      candidateSpot === undefined
        ? []
        : groundOutline(candidateSpot, groundProjections[view]),
    [candidateSpot, view]
  );

  const fitAt = useCallback(
    (zoom: number) => {
      const fitted = sceneAt(textZoomOf(zoom));

      // A spot can lie far from everything else, so its ring counts in the
      // fit. It is the page's editing layer, so an export's extent, which
      // `drawnIn` alone gives, leaves it out.
      const drawn = [
        ...drawnIn({ scene: fitted, drawing }),
        ...spotDrawn(fitted, bearers, fitIds),
        ...(candidateCorners.length === 0
          ? []
          : [{ ids: fitIds, points: candidateCorners }]),
      ];

      return fitOf({ drawn, fitTo: fitIds }).bounds;
    },
    [sceneAt, drawing, fitIds, bearers, candidateCorners]
  );

  // The floor looks at name tags only, which place quickly.
  const fitFloor = useCallback(
    (scale: number) =>
      fitFloorOf(
        {
          data: state.data,
          layout: state.layout,
          revealed,
          routes: routesOf({
            data: state.data,
            layout: state.layout,
            revealed,
          }),
          view,
        },
        scale
      ),
    [state.data, state.layout, revealed, view]
  );

  // The view fits again when the form opens and when it picks a new default
  // spot. A spot the engineer picked doesn't move the map under their hand.
  const candidateKey =
    candidate === null
      ? ""
      : candidate.picked
        ? "+adding"
        : `+adding ${candidate.spot.x},${candidate.spot.y}`;

  const key = `${fitKey ?? fitOf({ drawn: [], fitTo: fitIds }).key}${candidateKey}`;

  const editorView = useMemo(
    () => ({ view, placements: state.layout.structures, revealed }),
    [view, state.layout.structures, revealed]
  );

  return (
    <DrawingContext value={pageDrawing}>
      <EditorViewContext value={editorView}>
        <Viewport
          title={`${drawing.title} of ${state.data.overview.title}`}
          fitAt={fitAt}
          fitKey={key}
          fitFloor={fitFloor}
          onTextZoom={setTextZoom}
          ground={groundProjections[view]}
        >
          <MapDrawing
            scene={scene}
            hatch={hatch}
            newlyRevealed={newlyRevealed}
            spotlight={spotlight}
            ground={
              <>
                <DragOutlines view={view} />
                <SpotPicker view={view} />
              </>
            }
            underlay={
              <>
                <PendingZones zones={scene.zones} />
                <GroupEditor
                  view={view}
                  data={state.data}
                  layout={state.layout}
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
                  <AcceptedOutlines structures={scene.structures} view={view} />
                  <NewStructureSpot view={view} />
                  <CompareRings
                    structures={scene.structures}
                    view={view}
                    marks={marks}
                  />
                  <CompareHops hops={scene.hops} marks={marks} />
                </g>
              </>
            }
            hopsOverlay={
              <>
                <RouteEditor
                  view={view}
                  hops={scene.hops}
                  placements={state.layout.structures}
                  onHover={hoverHop}
                />
                <ChapterPendingLook
                  structures={scene.structures}
                  hops={scene.hops}
                  view={view}
                />
              </>
            }
            overlay={
              <>
                <NoteMarkers scene={scene} />
                <RemovedMarks structures={scene.structures} view={view} />
                <SpotCursor view={view} />
              </>
            }
            onHopHover={hoverHop}
            labelShown={(hop) => hop === selectedHop || hop === hoveredHop}
          />
          {children}
        </Viewport>
      </EditorViewContext>
    </DrawingContext>
  );
}
