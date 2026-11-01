import type {
  MapState,
  SceneHop,
  SceneStructure,
  View,
} from "@axonometric/contracts";
import {
  arrowheadOf,
  arrowPolygon,
  groundProjections,
  nameTagText,
  sceneOf,
} from "@axonometric/contracts";
import { Array as Arr, String as Str } from "effect";
import { use, useId, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { fitOf } from "./fit.ts";
import { LayoutEditor } from "./layout-editor.tsx";
import { AcceptedOutlines, PendingBadges } from "./pending-look.tsx";
import { PlaybackContext } from "./playback.ts";
import { groundOutline, routesOf, toPoints } from "./projection.ts";
import type { ScreenPoint } from "./projection.ts";
import { SelectionMarker } from "./selection-marker.tsx";
import { Viewport } from "./viewport.tsx";
import { viewDrawings } from "./views.tsx";
import { Zones } from "./zones.tsx";

function NameTag({ placed }: { readonly placed: SceneStructure }) {
  const { tag } = placed;

  return (
    <g data-name-tag={placed.structure.id} className="pointer-events-none">
      <rect
        x={tag.left}
        y={tag.top}
        width={tag.right - tag.left}
        height={tag.bottom - tag.top}
        className="fill-paper stroke-ink"
        strokeWidth={0.9}
      />
      <text
        x={(tag.left + tag.right) / 2}
        y={tag.top + 13}
        textAnchor="middle"
        className="fill-ink stroke-none font-mono text-xs"
      >
        {nameTagText(placed.structure)}
      </text>
    </g>
  );
}

const diamond = (at: ScreenPoint) =>
  toPoints([
    { sx: at.sx, sy: at.sy - 3.5 },
    { sx: at.sx + 3.5, sy: at.sy },
    { sx: at.sx, sy: at.sy + 3.5 },
    { sx: at.sx - 3.5, sy: at.sy },
  ]);

/**
 * The arrowhead on the last leg: its tip on the route's end and its base
 * across the line, `arrowLength` back.
 */
const arrowPoints = (points: readonly ScreenPoint[]) => {
  const head = arrowheadOf(points);
  const polygon = arrowPolygon(points);

  return head === undefined || polygon === undefined
    ? null
    : { base: head.base, polygon: toPoints(polygon) };
};

/** A hop's line, with the arrowhead drawn as part of its last segment. */
function Arrow({
  points,
  dashed = false,
  head,
}: {
  readonly points: readonly ScreenPoint[];
  readonly dashed?: boolean;
  readonly head: boolean;
}) {
  const arrow = head ? arrowPoints(points) : null;

  // The line stops at the arrowhead's base, so the head's tip is the end.
  const line = arrow === null ? points : [...points.slice(0, -1), arrow.base];

  return (
    <>
      <polyline
        points={toPoints(line)}
        fill="none"
        strokeWidth={1.4}
        strokeDasharray={dashed ? "4 3" : undefined}
      />
      {arrow === null ? null : (
        <polygon
          data-arrowhead=""
          points={arrow.polygon}
          className="fill-ink"
          stroke="none"
        />
      )}
    </>
  );
}

function HopArrow({
  routed,
  markBends,
  onHover,
}: {
  readonly routed: SceneHop;
  /** Whether to mark the route's bends with diamonds. */
  readonly markBends: boolean;
  /** Called with the hop's id while the pointer is on its line, else null. */
  readonly onHover: (hop: string | null) => void;
}) {
  const { hop, points } = routed;
  const bends = markBends ? routed.bends : [];

  return (
    <g
      data-hop={hop.id}
      data-route={toPoints(points)}
      className="stroke-ink"
      onPointerEnter={() => {
        onHover(hop.id);
      }}
      onPointerLeave={() => {
        onHover(null);
      }}
    >
      <title>{hop.label}</title>
      {/* A wide, invisible line, so the hop is easy to point at. */}
      <polyline
        points={toPoints(points)}
        fill="none"
        stroke="transparent"
        strokeWidth={10}
      />
      <Arrow points={points} head />
      {Arr.map(bends, (bend) => (
        <polygon
          key={`${bend.sx},${bend.sy}`}
          points={diamond(bend)}
          className="fill-ink"
          stroke="none"
        />
      ))}
    </g>
  );
}

/**
 * The stretches of a hop's route that boxes are drawn over, drawn again
 * faintly on top of those boxes, so the hop never disappears. The stretch
 * that reaches an end hidden behind a box carries a faint arrowhead, since
 * the solid one is under the box; an end on a visible edge has its solid
 * head and no faint one.
 */
function HiddenHop({ routed }: { readonly routed: SceneHop }) {
  return (
    <g data-hidden-hop={routed.hop.id} className="stroke-ink">
      {Arr.map(routed.hidden, (stretch) => (
        <Arrow
          key={toPoints(stretch.points)}
          points={stretch.points}
          dashed
          head={stretch.reachesEnd}
        />
      ))}
    </g>
  );
}

/**
 * A hop's label, drawn above every box so none hides it. A label the scene
 * found no room for shows only while the pointer is on its hop or its
 * packet is selected.
 */
function HopLabel({
  routed,
  shown,
}: {
  readonly routed: SceneHop;
  /** Whether to show the label even where the scene found no room. */
  readonly shown: boolean;
}) {
  const { hop, label, hoverLabel } = routed;
  const at = label ?? (shown ? hoverLabel : undefined);

  return at === undefined ? null : (
    <text
      data-hop-label={hop.id}
      data-hop-label-fits={label !== undefined}
      x={(at.left + at.right) / 2}
      y={at.bottom - 4}
      textAnchor="middle"
      className="fill-ink stroke-paper font-mono text-xs"
      strokeWidth={3}
      paintOrder="stroke"
    >
      {hop.label}
    </text>
  );
}

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
      strokeDasharray="5 4"
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
 * changes. Switching `view` keeps the viewport, with the same ground point
 * in the middle. `children` draw on top, in the same coordinates, and pan
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
  const [hoveredHop, setHoveredHop] = useState<string | null>(null);

  const scene = useMemo(
    () =>
      sceneOf({
        data: state.data,
        layout: state.layout,
        revealed,
        routes: routesOf({ data: state.data, layout: state.layout, revealed }),
        labelFirst,
        view,
      }),
    [state.data, state.layout, revealed, labelFirst, view]
  );

  const drawing = viewDrawings[view];
  const { Structure } = drawing;

  const marked = drawing.newRing
    ? Arr.filter(scene.structures, ({ structure }) =>
        newlyRevealed.has(structure.id)
      )
    : [];

  const fitted = fitOf({
    drawn: [
      ...Arr.map(scene.structures, (item) => ({
        ids: [item.structure.id],
        points: drawing.extentOf(item),
      })),
      ...Arr.map(scene.hops, ({ hop, points, label }) => ({
        ids: [hop.from, hop.to],
        points:
          label === undefined
            ? points
            : [
                ...points,
                { sx: label.left, sy: label.top },
                { sx: label.right, sy: label.bottom },
              ],
      })),
      ...Arr.map(scene.zones, ({ zone, plate, title }) => ({
        ids: zone.members,
        points: [...plate, ...(title ?? [])],
      })),
    ],
    fitTo: [...fitTo],
  });

  return (
    <Viewport
      title={`${drawing.title} of ${state.data.overview.title}`}
      fit={fitted.bounds}
      fitKey={fitKey ?? fitted.key}
      ground={groundProjections[view]}
    >
      <defs>
        <pattern
          id={hatch}
          width={6}
          height={6}
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <line
            x1={0}
            y1={0}
            x2={0}
            y2={6}
            stroke="currentColor"
            strokeWidth={1.1}
          />
        </pattern>
      </defs>
      <Zones zones={scene.zones} Plate={drawing.Plate} />
      <g>
        {Arr.map(marked, (item) => (
          <NewMarker key={item.structure.id} placed={item} view={view} />
        ))}
        <SelectionMarker placements={state.layout.structures} view={view} />
        <AcceptedOutlines structures={scene.structures} view={view} />
      </g>
      <g>
        {Arr.map(scene.hops, (item) => (
          <HopArrow
            key={item.hop.id}
            routed={item}
            markBends={drawing.markBends}
            onHover={setHoveredHop}
          />
        ))}
      </g>
      <LayoutEditor view={view} placements={state.layout.structures}>
        <g>
          {Arr.map(scene.structures, (item) => (
            <Structure
              key={item.structure.id}
              placed={item}
              hatch={hatch}
              isNew={newlyRevealed.has(item.structure.id)}
            />
          ))}
        </g>
        <g aria-hidden="true" className="pointer-events-none opacity-40">
          {Arr.map(scene.hops, (item) => (
            <HiddenHop key={item.hop.id} routed={item} />
          ))}
        </g>
        <g>
          {Arr.map(scene.structures, (item) => (
            <NameTag key={item.structure.id} placed={item} />
          ))}
        </g>
        <PendingBadges structures={scene.structures} />
      </LayoutEditor>
      <g className="pointer-events-none">
        {Arr.map(scene.hops, (item) => (
          <HopLabel
            key={item.hop.id}
            routed={item}
            shown={item.hop.id === selectedHop || item.hop.id === hoveredHop}
          />
        ))}
      </g>
      {children}
    </Viewport>
  );
}
