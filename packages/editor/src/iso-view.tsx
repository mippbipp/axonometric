import type {
  Hop,
  MapState,
  Placement,
  Structure,
} from "@axonometric/contracts";
import { Array as Arr, Order, String as Str } from "effect";
import { useId } from "react";
import type { ReactNode } from "react";

import { project, screenRouteOf, toPoints } from "./iso.ts";
import type { ScreenPoint } from "./iso.ts";

/** Height of a box above the ground, in screen units. */
const boxHeight = 40;

/** Space around the drawing when it's fitted to the window. */
const margin = 48;

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

function IsoBox({
  placed,
  hatch,
}: {
  readonly placed: PlacedStructure;
  readonly hatch: string;
}) {
  const { structure, placement } = placed;
  const ground = corners(placement, 0);
  const top = corners(placement, boxHeight);

  const sides = [
    { side: "left", face: [ground.left, ground.front, top.front, top.left] },
    {
      side: "right",
      face: [ground.front, ground.right, top.right, top.front],
    },
  ];

  const topFace = [top.back, top.right, top.front, top.left];

  return (
    <g
      data-structure={structure.id}
      className="stroke-ink"
      strokeWidth={1.2}
      strokeLinejoin="round"
    >
      <title>{structure.name}</title>
      {Arr.map(sides, ({ side, face }) => (
        <g key={side}>
          <polygon points={toPoints(face)} className="fill-face" />
          <polygon
            points={toPoints(face)}
            fill={`url(#${hatch})`}
            stroke="none"
          />
        </g>
      ))}
      <polygon points={toPoints(topFace)} className="fill-face" />
    </g>
  );
}

function NameTag({ placed }: { readonly placed: PlacedStructure }) {
  const { front } = corners(placed.placement, 0);
  const width = placed.structure.name.length * tagCharWidth + 12;
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
        {placed.structure.name}
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

/** The screen box that holds `points`, plus the margin. */
const viewBoxOf = (points: readonly ScreenPoint[]) => {
  const xs = Arr.map(points, (point) => point.sx);
  const ys = Arr.map(points, (point) => point.sy);
  const minX = Math.min(0, ...xs) - margin;
  const minY = Math.min(0, ...ys) - margin;
  const width = Math.max(0, ...xs) + margin - minX;
  const height = Math.max(0, ...ys) + margin - minY;

  return `${minX} ${minY} ${width} ${height}`;
};

/** The screen points a structure's drawing reaches, tag included. */
const extentOf = ({ placement }: PlacedStructure) => {
  const ground = corners(placement, 0);
  const top = corners(placement, boxHeight);

  return [
    top.back,
    top.left,
    top.right,
    { sx: ground.front.sx, sy: ground.front.sy + tagDrop },
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
 * The iso view of a map: each revealed structure as a hatched box with a name
 * tag, and each hop between revealed structures as an arrow along the
 * ground. The drawing is scaled to fit the structures in `fit` and the hops
 * between them. `children` draw on top, in the same coordinates.
 */
export function IsoView({
  state,
  revealed,
  fresh = none,
  fit = revealed,
  children,
}: {
  readonly state: MapState;
  /** The structures to draw. */
  readonly revealed: ReadonlySet<string>;
  /** The structures to mark as new. */
  readonly fresh?: ReadonlySet<string>;
  /** The structures to zoom to fit. */
  readonly fit?: ReadonlySet<string>;
  readonly children?: ReactNode;
}) {
  // useId's output can hold characters that don't belong in url(#...).
  const idPrefix = Str.replaceAll(/\W/gu, "")(useId());
  const hatch = `${idPrefix}hatch`;
  const arrowhead = `${idPrefix}arrowhead`;
  const placed = placeAll(state, revealed);
  const routed = routeAll(state, revealed);
  const marked = Arr.filter(placed, ({ structure }) => fresh.has(structure.id));

  const viewBox = viewBoxOf([
    ...Arr.flatMap(placeAll(state, fit), extentOf),
    ...Arr.flatMap(routeAll(state, fit), ({ points }) => points),
  ]);

  return (
    <svg
      aria-labelledby={`${idPrefix}title`}
      className="text-ink block size-full"
      viewBox={viewBox}
      preserveAspectRatio="xMidYMid meet"
    >
      <title id={`${idPrefix}title`}>{`Iso view of ${state.system}`}</title>
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
      </g>
      <g>
        {Arr.map(routed, (item) => (
          <HopArrow key={item.hop.id} routed={item} arrowhead={arrowhead} />
        ))}
      </g>
      <g>
        {Arr.map(placed, (item) => (
          <IsoBox key={item.structure.id} placed={item} hatch={hatch} />
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
    </svg>
  );
}
