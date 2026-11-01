import type {
  Hop,
  MapState,
  Placement,
  Structure,
} from "@axonometric/contracts";
import { isoHeights } from "@axonometric/contracts";
import { Array as Arr, Order, String as Str } from "effect";
import { useId } from "react";

import { boundsOf } from "./bounds.ts";
import { project, routeHop, toPoints } from "./iso.ts";
import type { ScreenPoint } from "./iso.ts";
import { IsoStructure } from "./shapes.tsx";
import { Viewport } from "./viewport.tsx";

/** How far below the front corner a name tag reaches, in screen units. */
const tagDrop = 28;

/** Approximate width of one character of the name tag's monospace font. */
const tagCharWidth = 7.2;

interface PlacedStructure {
  readonly structure: Structure;
  readonly placement: Placement;
}

interface RoutedHop {
  readonly hop: Hop;
  readonly points: readonly ScreenPoint[];
}

const corners = ({ x, y, w, d }: Placement, z: number) => ({
  back: project({ x, y, z }),
  right: project({ x: x + w, y, z }),
  front: project({ x: x + w, y: y + d, z }),
  left: project({ x, y: y + d, z }),
});

/** Painter's order: boxes further back are drawn first. */
const byDepth = Order.mapInput(
  Order.Number,
  ({ placement }: PlacedStructure) =>
    placement.x + placement.y + placement.w + placement.d
);

/** The text on a structure's name tag: its tag, or else its name. */
const tagText = (structure: Structure) => structure.tag ?? structure.name;

const tagWidth = (structure: Structure) =>
  tagText(structure).length * tagCharWidth + 12;

function NameTag({ placed }: { readonly placed: PlacedStructure }) {
  const { front } = corners(placed.placement, 0);
  const width = tagWidth(placed.structure);
  const top = front.sy + 9;

  return (
    <g data-name-tag={placed.structure.id} className="pointer-events-none">
      <rect
        x={front.sx - width / 2}
        y={top}
        width={width}
        height={18}
        className="fill-paper stroke-ink"
        strokeWidth={0.9}
      />
      <text
        x={front.sx}
        y={top + 13}
        textAnchor="middle"
        className="fill-ink stroke-none font-mono text-xs"
      >
        {tagText(placed.structure)}
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

  const tagHalf = tagWidth(structure) / 2;

  return [
    top.back,
    top.left,
    top.right,
    ground.left,
    ground.right,
    { sx: ground.front.sx - tagHalf, sy: ground.front.sy + tagDrop },
    { sx: ground.front.sx + tagHalf, sy: ground.front.sy + tagDrop },
  ];
};

const placeAll = (state: MapState): readonly PlacedStructure[] =>
  Arr.sort(
    Arr.flatMap(state.data.structures, (structure) => {
      const placement = state.layout.structures[structure.id];

      return placement === undefined ? [] : [{ structure, placement }];
    }),
    byDepth
  );

const routeAll = (state: MapState): readonly RoutedHop[] =>
  Arr.flatMap(state.data.hops, (hop) => {
    const from = state.layout.structures[hop.from];
    const to = state.layout.structures[hop.to];

    if (from === undefined || to === undefined) {
      return [];
    }

    const route = routeHop({ from, to });

    return [{ hop, points: Arr.map(route, project) }];
  });

/**
 * The iso view of a map: every structure as its shape with a name tag, and
 * every hop as an arrow along the ground, in a viewport you can pan and zoom.
 */
export function IsoView({
  state,
  fitTo,
}: {
  readonly state: MapState;
  /** The ids of the structures to fit to the window. Defaults to all of them. */
  readonly fitTo?: readonly string[];
}) {
  // useId's output can hold characters that don't belong in url(#...).
  const idPrefix = Str.replaceAll(/\W/gu, "")(useId());
  const hatch = `${idPrefix}hatch`;
  const arrowhead = `${idPrefix}arrowhead`;
  const placed = placeAll(state);
  const routed = routeAll(state);

  const fitting = fitTo === undefined ? undefined : new Set(fitTo);
  const inFit = (id: string) => fitting === undefined || fitting.has(id);

  const fit = boundsOf([
    ...Arr.flatMap(placed, (item) =>
      inFit(item.structure.id) ? extentOf(item) : []
    ),
    ...Arr.flatMap(routed, ({ hop, points }) =>
      inFit(hop.from) && inFit(hop.to) ? points : []
    ),
  ]);

  return (
    <Viewport title={`Iso view of ${state.system}`} fit={fit}>
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
    </Viewport>
  );
}
