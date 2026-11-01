import { isoHeights } from "@axonometric/contracts";
import type {
  Placement,
  ScreenRect,
  Shape,
  Structure,
} from "@axonometric/contracts";
import { Array as Arr } from "effect";
import type { ReactNode } from "react";

import { corners, project, tileHeight, tileWidth, toPoints } from "./iso.ts";
import type { ScreenPoint } from "./iso.ts";
import { StructureTarget } from "./structure-target.tsx";

// How each shape is drawn in the iso view. Every shape stands on its
// footprint and reaches `isoHeights[shape]` at its highest point. Faces that
// face the viewer carry the shared hatch; `data-face` and `data-hatch` let the
// rules for each status in index.css restyle them.

const halfTileWidth = tileWidth / 2;

const halfTileHeight = tileHeight / 2;

/** One grid unit along x or y, measured on screen. */
const gridStep = Math.hypot(halfTileWidth, halfTileHeight);

interface DrawProps {
  readonly placement: Placement;
  readonly height: number;
  readonly hatch: string;
}

const centreOf = ({ x, y, w, d }: Placement, z: number) =>
  project({ x: x + w / 2, y: y + d / 2, z });

const inset = ({ x, y, w, d }: Placement, by: number): Placement => ({
  x: x + by,
  y: y + by,
  w: w - 2 * by,
  d: d - 2 * by,
});

/**
 * A transform onto the vertical face that runs along x at the footprint's
 * front `y`: local x runs along the face in screen units, local y runs down.
 */
const alongX = (at: ScreenPoint) =>
  `matrix(${halfTileWidth / gridStep} ${halfTileHeight / gridStep} 0 1 ${at.sx} ${at.sy})`;

function Face({
  points,
  hatch,
}: {
  readonly points: readonly ScreenPoint[];
  readonly hatch?: string;
}) {
  return (
    <>
      <polygon data-face="" points={toPoints(points)} className="fill-face" />
      {hatch === undefined ? null : (
        <polygon
          data-hatch=""
          points={toPoints(points)}
          fill={`url(#${hatch})`}
          stroke="none"
        />
      )}
    </>
  );
}

/** A box from `z0` to `z1` over `placement`, sides hatched. */
function Prism({
  placement,
  z0,
  z1,
  hatch,
  hatchTop = false,
}: {
  readonly placement: Placement;
  readonly z0: number;
  readonly z1: number;
  readonly hatch: string;
  readonly hatchTop?: boolean;
}) {
  const low = corners(placement, z0);
  const top = corners(placement, z1);

  return (
    <>
      <Face points={[low.left, low.front, top.front, top.left]} hatch={hatch} />
      <Face
        points={[low.front, low.right, top.right, top.front]}
        hatch={hatch}
      />
      <Face
        points={[top.back, top.right, top.front, top.left]}
        hatch={hatchTop ? hatch : undefined}
      />
    </>
  );
}

/** The footprint's outline on the ground, for shapes that don't fill it. */
function Footprint({ placement }: { readonly placement: Placement }) {
  const ground = corners(placement, 0);

  return (
    <polygon
      points={toPoints([ground.back, ground.right, ground.front, ground.left])}
      fill="none"
      strokeWidth={0.8}
      opacity={0.45}
    />
  );
}

/**
 * The screen radii of a circle of `radius` grid units lying flat: the
 * projection squashes it to a 2:1 ellipse.
 */
const flatRadii = (radius: number) => ({
  rx: radius * Math.SQRT2 * halfTileWidth,
  ry: radius * Math.SQRT2 * halfTileHeight,
});

/** An upright cylinder from `z0` to `z1`, standing on `at`. */
function Drum({
  at,
  radius,
  z0,
  z1,
  hatch,
}: {
  readonly at: ScreenPoint;
  readonly radius: number;
  readonly z0: number;
  readonly z1: number;
  readonly hatch: string;
}) {
  const { rx, ry } = flatRadii(radius);
  const left = at.sx - rx;
  const right = at.sx + rx;
  const low = at.sy - z0;
  const high = at.sy - z1;
  const side = `M${left},${high} L${left},${low} A${rx},${ry} 0 0 0 ${right},${low} L${right},${high} A${rx},${ry} 0 0 1 ${left},${high} Z`;

  return (
    <>
      <path data-face="" d={side} className="fill-face" />
      <path data-hatch="" d={side} fill={`url(#${hatch})`} stroke="none" />
      <ellipse
        data-face=""
        cx={at.sx}
        cy={high}
        rx={rx}
        ry={ry}
        className="fill-face"
      />
    </>
  );
}

/** A plain box: the `box` shape, also used for the inside view's steps. */
export function BoxShape({ placement, height, hatch }: DrawProps) {
  return <Prism placement={placement} z0={0} z1={height} hatch={hatch} />;
}

const roofRise = 16;

/** A block with a hipped roof: the system's brain. */
function TallShape({ placement, height, hatch }: DrawProps) {
  const eaves = height - roofRise;
  const top = corners(placement, eaves);
  const apex = centreOf(placement, height);

  const slopes = [
    [top.back, top.right],
    [top.left, top.back],
    [top.front, top.left],
    [top.right, top.front],
  ] as const;

  return (
    <>
      <Prism placement={placement} z0={0} z1={eaves} hatch={hatch} />
      {Arr.map(slopes, ([from, to]) => (
        <polygon
          key={`${from.sx},${from.sy}`}
          data-face=""
          points={toPoints([from, to, apex])}
          className="fill-face"
        />
      ))}
    </>
  );
}

const drumGap = 3;

/** Three stacked drums: memory, ledgers, directories. */
function StoreShape({ placement, height, hatch }: DrawProps) {
  const radius = (Math.min(placement.w, placement.d) / 2) * 0.92;
  const at = centreOf(placement, 0);
  const layer = (height - drumGap * 2) / 3;

  return (
    <>
      {Arr.map([0, 1, 2], (index) => (
        <Drum
          key={index}
          at={at}
          radius={radius}
          z0={index * (layer + drumGap)}
          z1={index * (layer + drumGap) + layer}
          hatch={hatch}
        />
      ))}
    </>
  );
}

const cardCount = 5;

const cardGap = 2;

const cardShift = 0.1;

/** A fanned deck of thin cards: tools. */
function CardsShape({ placement, height, hatch }: DrawProps) {
  const spread = cardShift * (cardCount - 1);
  const thickness = (height - cardGap * (cardCount - 1)) / cardCount;

  return (
    <>
      {Arr.map(Arr.range(0, cardCount - 1), (index) => (
        <Prism
          key={index}
          placement={{
            x: placement.x + cardShift * index,
            y: placement.y + spread - cardShift * index,
            w: placement.w - spread,
            d: placement.d - spread,
          }}
          z0={index * (thickness + cardGap)}
          z1={index * (thickness + cardGap) + thickness}
          hatch={hatch}
        />
      ))}
    </>
  );
}

/** A wide, flat block with a hatched top: an existing backend. */
function SlabShape({ placement, height, hatch }: DrawProps) {
  return (
    <Prism placement={placement} z0={0} z1={height} hatch={hatch} hatchTop />
  );
}

/** A thin slab with a screen and lines of text on top. */
function ScreenShape({ placement, height, hatch }: DrawProps) {
  const glass = inset(placement, Math.min(placement.w, placement.d) * 0.14);
  const panel = corners(glass, height);
  const lines = [0.3, 0.5, 0.7];

  return (
    <>
      <Prism placement={placement} z0={0} z1={height} hatch={hatch} />
      <polygon
        points={toPoints([panel.back, panel.right, panel.front, panel.left])}
        className="fill-paper"
        strokeWidth={0.9}
      />
      {Arr.map(lines, (at, index) => {
        const y = glass.y + glass.d * at;
        const start = project({ x: glass.x + glass.w * 0.12, y, z: height });

        const end = project({
          x: glass.x + glass.w * (index === 2 ? 0.55 : 0.85),
          y,
          z: height,
        });

        return (
          <line
            key={at}
            x1={start.sx}
            y1={start.sy}
            x2={end.sx}
            y2={end.sy}
            strokeWidth={1.4}
            opacity={0.7}
          />
        );
      })}
    </>
  );
}

/** A box with a dark band around it: approval or confirmation. */
function GateShape({ placement, height, hatch }: DrawProps) {
  const low = corners(placement, height * 0.5);
  const high = corners(placement, height * 0.74);

  return (
    <>
      <Prism placement={placement} z0={0} z1={height} hatch={hatch} />
      <polygon
        points={toPoints([low.left, low.front, high.front, high.left])}
        className="fill-ink"
      />
      <polygon
        points={toPoints([low.front, low.right, high.right, high.front])}
        className="fill-ink"
      />
    </>
  );
}

/** A box with a hatched top and a clock on its face: a scheduled pass. */
function JobShape({ placement, height, hatch }: DrawProps) {
  const radius = Math.min(height * 0.3, placement.w * gridStep * 0.18);

  const at = project({
    x: placement.x + placement.w * 0.5,
    y: placement.y + placement.d,
    z: height * 0.5,
  });

  return (
    <>
      <Prism placement={placement} z0={0} z1={height} hatch={hatch} hatchTop />
      <g transform={alongX(at)}>
        <circle r={radius} className="fill-paper" strokeWidth={1} />
        <path
          d={`M0,${-radius * 0.7} L0,0 L${radius * 0.55},0`}
          fill="none"
          strokeWidth={1.2}
        />
      </g>
    </>
  );
}

const headRadius = 11;

/** A standing figure: a body and a head. */
function PersonShape({ placement, height, hatch }: DrawProps) {
  const at = centreOf(placement, 0);
  const radius = Math.min(placement.w, placement.d) * 0.26;
  const shoulders = height - headRadius * 2 - 2;

  return (
    <>
      <Footprint placement={placement} />
      <Drum at={at} radius={radius} z0={0} z1={shoulders} hatch={hatch} />
      <circle
        data-face=""
        cx={at.sx}
        cy={at.sy - height + headRadius}
        r={headRadius}
        className="fill-face"
      />
    </>
  );
}

const pageThickness = 0.1;

const foldSize = 12;

/** An upright page with a folded corner: a pull request or a report. */
function DocumentShape({ placement, height, hatch }: DrawProps) {
  const from = placement.x + placement.w * 0.12;
  const to = placement.x + placement.w * 0.88;
  const plane = placement.y + placement.d * 0.55;
  const fold = foldSize / gridStep;
  const at = (x: number, z: number, y = plane) => project({ x, y, z });
  const width = (to - from) * gridStep;

  const edge = [
    at(to, 0),
    at(to, 0, plane - pageThickness),
    at(to, height - foldSize, plane - pageThickness),
    at(to, height - foldSize),
  ];

  const topEdge = [
    at(from, height),
    at(from, height, plane - pageThickness),
    at(to - fold, height, plane - pageThickness),
    at(to - fold, height),
  ];

  const page = [
    at(from, 0),
    at(to, 0),
    at(to, height - foldSize),
    at(to - fold, height),
    at(from, height),
  ];

  const foldTop = at(to - fold, height);
  const foldSide = at(to, height - foldSize);
  const flap = [foldTop, at(to - fold, height - foldSize), foldSide];

  const lines = [0.32, 0.48, 0.64, 0.8];

  return (
    <>
      <Footprint placement={placement} />
      <Face points={edge} hatch={hatch} />
      <Face points={topEdge} />
      <polygon data-face="" points={toPoints(page)} className="fill-face" />
      <g data-fold="">
        <polygon
          data-face=""
          points={toPoints(flap)}
          className="fill-face"
          strokeWidth={1}
        />
        <line
          data-crease=""
          x1={foldTop.sx}
          y1={foldTop.sy}
          x2={foldSide.sx}
          y2={foldSide.sy}
          strokeWidth={1.4}
        />
      </g>
      <g transform={alongX(at(from, height))}>
        {Arr.map(lines, (line, index) => (
          <line
            key={line}
            x1={width * 0.14}
            y1={height * line}
            x2={width * (index === lines.length - 1 ? 0.55 : 0.86)}
            y2={height * line}
            strokeWidth={1.2}
            opacity={0.7}
          />
        ))}
      </g>
    </>
  );
}

const haloSize = 0.2;

/**
 * A box inside a dashed outer ring: a source outside the system. The ring
 * is dashed so it can't be read as a hop.
 */
function ExternalShape({ placement, height, hatch }: DrawProps) {
  const halo = inset(placement, -haloSize);
  // The halo stops at the ground, so it stays clear of the name tag.
  const ground = corners(halo, 0);
  const top = corners(halo, height + 4);

  const outline = [
    top.back,
    top.right,
    ground.right,
    ground.front,
    ground.left,
    top.left,
  ];

  return (
    <>
      <polygon
        data-external-ring=""
        points={toPoints(outline)}
        className="fill-paper"
        strokeWidth={0.9}
        strokeDasharray="4 3"
      />
      <Prism placement={placement} z0={0} z1={height} hatch={hatch} />
    </>
  );
}

const drawings = {
  box: BoxShape,
  tall: TallShape,
  store: StoreShape,
  cards: CardsShape,
  slab: SlabShape,
  screen: ScreenShape,
  gate: GateShape,
  job: JobShape,
  person: PersonShape,
  document: DocumentShape,
  external: ExternalShape,
} as const satisfies Record<Shape, (props: DrawProps) => ReactNode>;

function CodeChip({
  code,
  rect,
}: {
  readonly code: string;
  readonly rect: ScreenRect;
}) {
  return (
    <g data-code-chip="">
      <rect
        x={rect.left}
        y={rect.top}
        width={rect.right - rect.left}
        height={rect.bottom - rect.top}
        className="fill-paper"
        strokeWidth={1}
      />
      <text
        x={(rect.left + rect.right) / 2}
        y={(rect.top + rect.bottom) / 2 + 3.5}
        textAnchor="middle"
        className="fill-ink text-2xs stroke-none font-mono font-semibold"
      >
        {code}
      </text>
    </g>
  );
}

/**
 * A power symbol on a switched-off structure, so "off" doesn't rest on colour
 * alone.
 */
/**
 * Where the power mark sits: on the top face, to the right of the code chip,
 * or at the top of the front corner when there's no chip.
 */
const offMarkAt = (
  structure: Structure,
  placement: Placement,
  hasChip: boolean
) => {
  const top = isoHeights[structure.shape];

  if (!hasChip) {
    return project({
      x: placement.x + placement.w,
      y: placement.y + placement.d,
      z: top,
    });
  }

  const centre = centreOf(placement, top);

  return { sx: centre.sx + 22, sy: centre.sy };
};

function OffMark({ at }: { readonly at: ScreenPoint }) {
  return (
    <g
      data-off-mark=""
      transform={`translate(${at.sx} ${at.sy})`}
      strokeWidth={1.4}
      strokeLinecap="round"
    >
      <circle r={8} className="fill-paper" strokeWidth={1} />
      <path d="M-3.2,-2.6 A4.2,4.2 0 1 0 3.2,-2.6" fill="none" />
      <line x1={0} y1={-4.8} x2={0} y2={-0.6} />
    </g>
  );
}

/**
 * One structure in the iso view, drawn as its shape and styled for its status,
 * with its code chip on top when it fits.
 */
export function IsoStructure({
  structure,
  placement,
  chip,
  hatch,
}: {
  readonly structure: Structure;
  readonly placement: Placement;
  /** Where the code chip goes, from the scene. */
  readonly chip: ScreenRect | undefined;
  readonly hatch: string;
}) {
  const Drawing = drawings[structure.shape];

  return (
    <StructureTarget
      id={structure.id}
      data-shape={structure.shape}
      data-status={structure.status}
      className="stroke-ink"
      strokeWidth={1.2}
      strokeLinejoin="round"
    >
      <Drawing
        placement={placement}
        height={isoHeights[structure.shape]}
        hatch={hatch}
      />
      {chip === undefined ? null : (
        <CodeChip code={structure.code} rect={chip} />
      )}
      {structure.status === "off" ? (
        <OffMark at={offMarkAt(structure, placement, chip !== undefined)} />
      ) : null}
    </StructureTarget>
  );
}
