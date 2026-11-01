import type {
  Hop,
  MapState,
  Placement,
  ScreenRect,
  Structure,
} from "@axonometric/contracts";
import {
  boxOutline,
  isoHeights,
  nameTagRect,
  nameTagText,
  tagDrop,
  zonesOf,
} from "@axonometric/contracts";
import { Array as Arr, Option, Order, String as Str } from "effect";
import { useId } from "react";
import type { ReactNode } from "react";

import { fitOf } from "./fit.ts";
import {
  corners,
  hiddenStretches,
  labelSpot,
  screenRouteOf,
  toPoints,
} from "./iso.ts";
import type { HiddenStretch, ScreenPoint } from "./iso.ts";
import { IsoStructure } from "./shapes.tsx";
import { Viewport } from "./viewport.tsx";
import { drawZones, titleOutline } from "./zone-outline.ts";
import type { ZoneDrawing } from "./zone-outline.ts";
import { Zones } from "./zones.tsx";

interface PlacedStructure {
  readonly structure: Structure;
  readonly placement: Placement;
}

interface RoutedHop {
  readonly hop: Hop;
  readonly points: readonly ScreenPoint[];
  /** Where its label goes. */
  readonly label: ScreenRect | undefined;
  /** The stretches of its route that boxes are drawn over. */
  readonly hidden: readonly HiddenStretch[];
}

const byDepth = Order.mapInput(
  Order.Number,
  ({ placement }: PlacedStructure) =>
    placement.x + placement.y + placement.w + placement.d
);

/**
 * Whether `a` sits behind `b`, so `b` must be drawn over it: `a` ends
 * before `b` starts along one axis and they share some of the other. Two
 * footprints apart along both axes, one ahead on x and the other ahead on
 * y, land side by side on screen, and neither is behind.
 */
const behind = (
  { placement: a }: PlacedStructure,
  { placement: b }: PlacedStructure
) =>
  (a.x + a.w <= b.x && a.y < b.y + b.d) ||
  (a.y + a.d <= b.y && a.x < b.x + b.w);

/**
 * Painter's order: every box is drawn after the boxes it sits in front of.
 * Of the boxes ready to draw, the one whose front corner is furthest back
 * goes first. Sorting on that corner alone draws a long box over a box in
 * front of it.
 */
const paintOrder = (
  items: readonly PlacedStructure[]
): readonly PlacedStructure[] => {
  if (!Arr.isReadonlyArrayNonEmpty(items)) {
    return [];
  }

  const sorted = Arr.sort(items, byDepth);

  const ready = Arr.findFirst(sorted, (item) =>
    Arr.every(sorted, (other) => other === item || !behind(other, item))
  );

  // Overlapping footprints can make a cycle; fall back to depth order.
  const next = Option.getOrElse(ready, () => sorted[0]);

  return [next, ...paintOrder(Arr.filter(sorted, (item) => item !== next))];
};

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
    </g>
  );
}

/**
 * The stretches of a hop's route that boxes are drawn over, drawn again
 * faintly on top of those boxes, so the hop never disappears.
 */
function HiddenHop({
  routed,
  arrowhead,
}: {
  readonly routed: RoutedHop;
  readonly arrowhead: string;
}) {
  return (
    <g data-hidden-hop={routed.hop.id}>
      {Arr.map(routed.hidden, (stretch) => (
        <polyline
          key={toPoints(stretch.points)}
          points={toPoints(stretch.points)}
          fill="none"
          className="stroke-ink"
          strokeWidth={1.4}
          strokeDasharray="4 3"
          markerEnd={stretch.reachesEnd ? `url(#${arrowhead})` : undefined}
        />
      ))}
    </g>
  );
}

/** A hop's label, drawn above every box so none hides it. */
function HopLabel({ routed }: { readonly routed: RoutedHop }) {
  const { hop, label } = routed;

  return label === undefined ? null : (
    <text
      data-hop-label={hop.id}
      x={(label.left + label.right) / 2}
      y={label.bottom - 4}
      textAnchor="middle"
      className="fill-ink stroke-paper font-mono text-xs"
      strokeWidth={3}
      paintOrder="stroke"
    >
      {hop.label}
    </text>
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
  paintOrder(
    Arr.flatMap(state.data.structures, (structure) => {
      const placement = state.layout.structures[structure.id];

      return placement === undefined || !revealed.has(structure.id)
        ? []
        : [{ structure, placement }];
    })
  );

/**
 * Routes every hop between revealed structures, works out which stretches
 * the revealed boxes hide, and places each label beside its own route,
 * clear of the boxes, name tags, zone titles, routes and the labels placed
 * before it, in data.mjs order.
 */
const routeAll = (
  state: MapState,
  placed: readonly PlacedStructure[],
  zones: readonly ZoneDrawing[]
): readonly RoutedHop[] => {
  const revealed = new Set(Arr.map(placed, ({ structure }) => structure.id));

  const outlines = Arr.map(placed, ({ structure, placement }) =>
    boxOutline(placement, structure.shape)
  );

  const titles = Arr.map(zones, titleOutline);
  const tags = Arr.map(placed, tagOf);

  const routes = Arr.flatMap(state.data.hops, (hop) => {
    const points = screenRouteOf({
      data: state.data,
      layout: state.layout,
      hop,
    });

    return points === undefined ||
      !revealed.has(hop.from) ||
      !revealed.has(hop.to)
      ? []
      : [{ hop, points }];
  });

  const lines = Arr.map(routes, ({ points }) => points);

  return Arr.reduce(routes, Arr.empty<RoutedHop>(), (done, { hop, points }) => {
    const label = labelSpot({
      points,
      text: hop.label,
      avoid: {
        outlines: [...outlines, ...titles],
        rects: [
          ...tags,
          ...Arr.flatMap(done, (other) =>
            other.label === undefined ? [] : [other.label]
          ),
        ],
        routes: lines,
      },
    });

    return [
      ...done,
      { hop, points, label, hidden: hiddenStretches({ points, outlines }) },
    ];
  });
};

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
 * ground, over each group's zone fitted to its revealed structures, in a
 * viewport you can pan and zoom. The view fits the structures in
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

  const zones = drawZones({
    zones: zonesOf({ data: state.data, layout: state.layout, revealed }),
    structures: placed,
  });

  const routed = routeAll(state, placed, zones);

  const marked = Arr.filter(placed, ({ structure }) =>
    newlyRevealed.has(structure.id)
  );

  const fitted = fitOf({
    drawn: [
      ...Arr.map(placed, (item) => ({
        ids: [item.structure.id],
        points: extentOf(item),
      })),
      ...Arr.map(routed, ({ hop, points, label }) => ({
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
      ...Arr.map(zones, ({ zone, plate }) => ({
        ids: zone.members,
        points: plate,
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
      <Zones zones={zones} />
      <g>
        {Arr.map(marked, (item) => (
          <NewMarker key={item.structure.id} placed={item} />
        ))}
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
      <g aria-hidden="true" className="pointer-events-none opacity-40">
        {Arr.map(routed, (item) => (
          <HiddenHop key={item.hop.id} routed={item} arrowhead={arrowhead} />
        ))}
      </g>
      <g>
        {Arr.map(placed, (item) => (
          <NameTag key={item.structure.id} placed={item} />
        ))}
      </g>
      <g className="pointer-events-none">
        {Arr.map(routed, (item) => (
          <HopLabel key={item.hop.id} routed={item} />
        ))}
      </g>
      {children}
    </Viewport>
  );
}
