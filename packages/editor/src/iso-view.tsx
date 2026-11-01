import type {
  Hop,
  MapState,
  Placement,
  Structure,
} from "@axonometric/contracts";
import {
  isoHeights,
  nameTagRect,
  nameTagText,
  tagDrop,
} from "@axonometric/contracts";
import { Array as Arr, Order, String as Str } from "effect";
import { useId } from "react";
import type { ReactNode } from "react";

import { fitOf } from "./fit.ts";
import { corners, screenRouteOf, toPoints } from "./iso.ts";
import type { ScreenPoint } from "./iso.ts";
import { SelectionMarker } from "./selection-marker.tsx";
import { IsoStructure } from "./shapes.tsx";
import { Viewport } from "./viewport.tsx";

interface PlacedStructure {
  readonly structure: Structure;
  readonly placement: Placement;
}

interface RoutedHop {
  readonly hop: Hop;
  readonly points: readonly ScreenPoint[];
}

/** Painter's order: boxes further back are drawn first. */
const byDepth = Order.mapInput(
  Order.Number,
  ({ placement }: PlacedStructure) =>
    placement.x + placement.y + placement.w + placement.d
);

const tagOf = ({ structure, placement }: PlacedStructure) =>
  nameTagRect(placement, nameTagText(structure));

function NameTag({ placed }: { readonly placed: PlacedStructure }) {
  const { front } = corners(placed.placement, 0);
  const tag = tagOf(placed);
  const { top } = tag;

  return (
    <g data-name-tag={placed.structure.id} className="pointer-events-none">
      <rect
        x={tag.left}
        y={top}
        width={tag.right - tag.left}
        height={tag.bottom - tag.top}
        className="fill-paper stroke-ink"
        strokeWidth={0.9}
      />
      <text
        x={front.sx}
        y={top + 13}
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

function HopArrow({
  routed,
  arrowhead,
}: {
  readonly routed: RoutedHop;
  readonly arrowhead: string;
}) {
  const { hop, points } = routed;
  const bends = points.slice(1, -1);
  const labelAt = bends[0] ?? points[0];

  return (
    <g data-hop={hop.id} className="stroke-ink">
      <title>{hop.label}</title>
      <polyline
        points={toPoints(points)}
        fill="none"
        strokeWidth={1.4}
        markerEnd={`url(#${arrowhead})`}
      />
      {Arr.map(bends, (bend) => (
        <polygon
          key={`${bend.sx},${bend.sy}`}
          points={diamond(bend)}
          className="fill-ink"
          stroke="none"
        />
      ))}
      {labelAt === undefined ? null : (
        <text
          x={labelAt.sx + 8}
          y={labelAt.sy - 8}
          className="fill-ink stroke-paper font-mono text-xs"
          strokeWidth={3}
          paintOrder="stroke"
        >
          {hop.label}
        </text>
      )}
    </g>
  );
}

/** The screen points a structure's drawing reaches, tag included. */
const extentOf = ({ structure, placement }: PlacedStructure) => {
  const ground = corners(placement, 0);
  const top = corners(placement, isoHeights[structure.shape]);

  const tag = tagOf({ structure, placement });

  return [
    top.back,
    top.left,
    top.right,
    ground.left,
    ground.right,
    { sx: tag.left, sy: ground.front.sy + tagDrop },
    { sx: tag.right, sy: ground.front.sy + tagDrop },
  ];
};

const placeAll = (
  state: MapState,
  revealed: ReadonlySet<string>
): readonly PlacedStructure[] =>
  Arr.sort(
    Arr.flatMap(state.data.structures, (structure) => {
      const placement = state.layout.structures[structure.id];

      return placement === undefined || !revealed.has(structure.id)
        ? []
        : [{ structure, placement }];
    }),
    byDepth
  );

const routeAll = (
  state: MapState,
  revealed: ReadonlySet<string>
): readonly RoutedHop[] =>
  Arr.flatMap(state.data.hops, (hop) => {
    const points = screenRouteOf({ layout: state.layout, hop });

    return points === undefined ||
      !revealed.has(hop.from) ||
      !revealed.has(hop.to)
      ? []
      : [{ hop, points }];
  });

/** A dashed outline around the footprint of a newly revealed structure. */
function NewMarker({ placed }: { readonly placed: PlacedStructure }) {
  const { x, y, w, d } = placed.placement;

  const outline = corners(
    { x: x - 0.2, y: y - 0.2, w: w + 0.4, d: d + 0.4 },
    0
  );

  return (
    <polygon
      data-new-marker={placed.structure.id}
      points={toPoints([
        outline.back,
        outline.right,
        outline.front,
        outline.left,
      ])}
      fill="none"
      className="stroke-ink motion-safe:animate-pulse"
      strokeWidth={1.4}
      strokeDasharray="5 4"
    />
  );
}

const none: ReadonlySet<string> = new Set();

/**
 * The iso view of a map: each revealed structure as its shape with a name
 * tag, and each hop between revealed structures as an arrow along the
 * ground, in a viewport you can pan and zoom. The view fits the structures in
 * `fitTo` and the hops between them, and fits again when `fitKey` changes.
 * `children` draw on top, in the same coordinates, and pan and zoom with the
 * drawing.
 */
export function IsoView({
  state,
  revealed,
  newlyRevealed = none,
  fitTo = revealed,
  fitKey,
  children,
}: {
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
  readonly children?: ReactNode;
}) {
  // useId's output can hold characters that don't belong in url(#...).
  const idPrefix = Str.replaceAll(/\W/gu, "")(useId());
  const hatch = `${idPrefix}hatch`;
  const arrowhead = `${idPrefix}arrowhead`;
  const placed = placeAll(state, revealed);
  const routed = routeAll(state, revealed);

  const marked = Arr.filter(placed, ({ structure }) =>
    newlyRevealed.has(structure.id)
  );

  const fitted = fitOf({
    drawn: [
      ...Arr.map(placed, (item) => ({
        ids: [item.structure.id],
        points: extentOf(item),
      })),
      ...Arr.map(routed, ({ hop, points }) => ({
        ids: [hop.from, hop.to],
        points,
      })),
    ],
    fitTo: [...fitTo],
  });

  return (
    <Viewport
      title={`Iso view of ${state.system}`}
      fit={fitted.bounds}
      fitKey={fitKey ?? fitted.key}
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
        <marker
          id={arrowhead}
          viewBox="0 0 10 10"
          refX={9}
          refY={5}
          markerWidth={7}
          markerHeight={7}
          orient="auto-start-reverse"
        >
          <path d="M0,0 L10,5 L0,10 z" className="fill-ink stroke-none" />
        </marker>
      </defs>
      <g>
        {Arr.map(marked, (item) => (
          <NewMarker key={item.structure.id} placed={item} />
        ))}
        <SelectionMarker placements={state.layout.structures} />
      </g>
      <g>
        {Arr.map(routed, (item) => (
          <HopArrow key={item.hop.id} routed={item} arrowhead={arrowhead} />
        ))}
      </g>
      <g>
        {Arr.map(placed, (item) => (
          <IsoStructure
            key={item.structure.id}
            structure={item.structure}
            placement={item.placement}
            hatch={hatch}
          />
        ))}
      </g>
      {/* Hops again, faintly, so a hop that runs behind a box stays visible. */}
      <g aria-hidden="true" className="opacity-30">
        {Arr.map(routed, (item) => (
          <polyline
            key={item.hop.id}
            points={toPoints(item.points)}
            fill="none"
            className="stroke-ink"
            strokeWidth={1.4}
            markerEnd={`url(#${arrowhead})`}
          />
        ))}
      </g>
      <g>
        {Arr.map(placed, (item) => (
          <NameTag key={item.structure.id} placed={item} />
        ))}
      </g>
      {children}
    </Viewport>
  );
}
