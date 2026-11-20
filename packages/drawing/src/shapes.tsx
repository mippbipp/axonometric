import {
  corners,
  dashes,
  isoHeights,
  project,
  textSizes,
  tileHeight,
  tileWidth,
  toPoints,
} from "@axonometric/contracts";
import type {
  Placement,
  ScreenPoint,
  ScreenRect,
  Shape,
  Structure,
} from "@axonometric/contracts";
import { Array as Arr } from "effect";
import type { ReactNode } from "react";

import { useDrawing } from "./drawing-context.ts";
import { LookContext, looksOf, useHatching, useLook } from "./look.ts";
import type { StructureDrawingProps } from "./structure-drawing.ts";

// How each shape is drawn in the Iso view. Every shape stands on its
// footprint and reaches `isoHeights[shape]` at its highest point. Faces that
// face the viewer carry the shared hatch; `data-face` and `data-hatch` let the
// rules for each status in index.css restyle them.

const halfTileWidth = tileWidth / 2;

const halfTileHeight = tileHeight / 2;

/** One grid unit along x or y, measured on screen. */
const gridStep = Math.hypot(halfTileWidth, halfTileHeight);

interface DrawProps {
  readonly hatch: string;
  readonly height: number;
  readonly placement: Placement;
}

const centreOf = ({ d, w, x, y }: Placement, z: number) =>
  project({ x: x + w / 2, y: y + d / 2, z });

const inset = ({ d, w, x, y }: Placement, by: number): Placement => ({
  d: d - 2 * by,
  w: w - 2 * by,
  x: x + by,
  y: y + by,
});

/**
 * A transform onto the vertical face that runs along x at the footprint's
 * front `y`: local x runs along the face in screen units, local y runs down.
 */
const alongX = (at: ScreenPoint) =>
  `matrix(${halfTileWidth / gridStep} ${halfTileHeight / gridStep} 0 1 ${at.sx} ${at.sy})`;

function Face({
  hatch,
  points,
}: {
  readonly hatch?: string;
  readonly points: ReadonlyArray<ScreenPoint>;
}) {
  const { face } = useLook();
  const hatching = useHatching(hatch);

  return (
    <>
      <polygon data-face="" fill={face} points={toPoints(points)} />
      {hatching === undefined ? null : (
        <polygon points={toPoints(points)} {...hatching} />
      )}
    </>
  );
}

/** A box from `z0` to `z1` over `placement`, sides hatched. */
function Prism({
  hatch,
  hatchTop = false,
  placement,
  z0,
  z1,
}: {
  readonly hatch: string;
  readonly hatchTop?: boolean;
  readonly placement: Placement;
  readonly z0: number;
  readonly z1: number;
}) {
  const low = corners(placement, z0);
  const top = corners(placement, z1);

  return (
    <>
      <Face hatch={hatch} points={[low.left, low.front, top.front, top.left]} />
      <Face
        hatch={hatch}
        points={[low.front, low.right, top.right, top.front]}
      />
      <Face
        hatch={hatchTop ? hatch : undefined}
        points={[top.back, top.right, top.front, top.left]}
      />
    </>
  );
}

/** The footprint's outline on the ground, for shapes that don't fill it. */
function Footprint({ placement }: { readonly placement: Placement }) {
  const ground = corners(placement, 0);

  return (
    <polygon
      fill="none"
      opacity={0.45}
      points={toPoints([ground.back, ground.right, ground.front, ground.left])}
      strokeWidth={0.8}
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
  hatch,
  radius,
  z0,
  z1,
}: {
  readonly at: ScreenPoint;
  readonly hatch: string;
  readonly radius: number;
  readonly z0: number;
  readonly z1: number;
}) {
  const { face } = useLook();
  const hatching = useHatching(hatch);
  const { rx, ry } = flatRadii(radius);
  const left = at.sx - rx;
  const right = at.sx + rx;
  const low = at.sy - z0;
  const high = at.sy - z1;
  const side = `M${left},${high} L${left},${low} A${rx},${ry} 0 0 0 ${right},${low} L${right},${high} A${rx},${ry} 0 0 1 ${left},${high} Z`;

  return (
    <>
      <path d={side} data-face="" fill={face} />
      {hatching === undefined ? null : <path d={side} {...hatching} />}
      <ellipse cx={at.sx} cy={high} data-face="" fill={face} rx={rx} ry={ry} />
    </>
  );
}

/** A plain box: the `box` shape, also used for the inside view's steps. */
export function BoxShape({ hatch, height, placement }: DrawProps) {
  return <Prism hatch={hatch} placement={placement} z0={0} z1={height} />;
}

const roofRise = 16;

/** A block with a hipped roof: the system's brain. */
function TallShape({ hatch, height, placement }: DrawProps) {
  const { face } = useLook();
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
      <Prism hatch={hatch} placement={placement} z0={0} z1={eaves} />
      {Arr.map(slopes, ([from, to]) => (
        <polygon
          data-face=""
          fill={face}
          key={`${from.sx},${from.sy}`}
          points={toPoints([from, to, apex])}
        />
      ))}
    </>
  );
}

const drumGap = 3;

/** Three stacked drums: memory, ledgers, directories. */
function StoreShape({ hatch, height, placement }: DrawProps) {
  const radius = (Math.min(placement.w, placement.d) / 2) * 0.92;
  const at = centreOf(placement, 0);
  const layer = (height - drumGap * 2) / 3;

  return (
    <>
      {Arr.map([0, 1, 2], (index) => (
        <Drum
          at={at}
          hatch={hatch}
          key={index}
          radius={radius}
          z0={index * (layer + drumGap)}
          z1={index * (layer + drumGap) + layer}
        />
      ))}
    </>
  );
}

const cardCount = 5;

const cardGap = 2;

const cardShift = 0.1;

/** A fanned deck of thin cards: tools. */
function CardsShape({ hatch, height, placement }: DrawProps) {
  const spread = cardShift * (cardCount - 1);
  const thickness = (height - cardGap * (cardCount - 1)) / cardCount;

  return (
    <>
      {Arr.map(Arr.range(0, cardCount - 1), (index) => (
        <Prism
          hatch={hatch}
          key={index}
          placement={{
            d: placement.d - spread,
            w: placement.w - spread,
            x: placement.x + cardShift * index,
            y: placement.y + spread - cardShift * index,
          }}
          z0={index * (thickness + cardGap)}
          z1={index * (thickness + cardGap) + thickness}
        />
      ))}
    </>
  );
}

/** A wide, flat block with a hatched top: an existing backend. */
function SlabShape({ hatch, height, placement }: DrawProps) {
  return (
    <Prism hatch={hatch} hatchTop placement={placement} z0={0} z1={height} />
  );
}

/** A thin slab with a screen and lines of text on top. */
function ScreenShape({ hatch, height, placement }: DrawProps) {
  const { paint } = useLook();
  const glass = inset(placement, Math.min(placement.w, placement.d) * 0.14);
  const panel = corners(glass, height);
  const lines = [0.3, 0.5, 0.7];

  return (
    <>
      <Prism hatch={hatch} placement={placement} z0={0} z1={height} />
      <polygon
        fill={paint.paper}
        points={toPoints([panel.back, panel.right, panel.front, panel.left])}
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
            opacity={0.7}
            strokeWidth={1.4}
            x1={start.sx}
            x2={end.sx}
            y1={start.sy}
            y2={end.sy}
          />
        );
      })}
    </>
  );
}

/** A box with a dark band around it: approval or confirmation. */
function GateShape({ hatch, height, placement }: DrawProps) {
  const { solid } = useLook();
  const low = corners(placement, height * 0.5);
  const high = corners(placement, height * 0.74);

  return (
    <>
      <Prism hatch={hatch} placement={placement} z0={0} z1={height} />
      <polygon
        fill={solid}
        points={toPoints([low.left, low.front, high.front, high.left])}
      />
      <polygon
        fill={solid}
        points={toPoints([low.front, low.right, high.right, high.front])}
      />
    </>
  );
}

/** A box with a hatched top and a clock on its face: a scheduled pass. */
function JobShape({ hatch, height, placement }: DrawProps) {
  const { paint } = useLook();
  const radius = Math.min(height * 0.3, placement.w * gridStep * 0.18);

  const at = project({
    x: placement.x + placement.w * 0.5,
    y: placement.y + placement.d,
    z: height * 0.5,
  });

  return (
    <>
      <Prism hatch={hatch} hatchTop placement={placement} z0={0} z1={height} />
      <g transform={alongX(at)}>
        <circle fill={paint.paper} r={radius} strokeWidth={1} />
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
function PersonShape({ hatch, height, placement }: DrawProps) {
  const { face } = useLook();
  const at = centreOf(placement, 0);
  const radius = Math.min(placement.w, placement.d) * 0.26;
  const shoulders = height - headRadius * 2 - 2;

  return (
    <>
      <Footprint placement={placement} />
      <Drum at={at} hatch={hatch} radius={radius} z0={0} z1={shoulders} />
      <circle
        cx={at.sx}
        cy={at.sy - height + headRadius}
        data-face=""
        fill={face}
        r={headRadius}
      />
    </>
  );
}

const pageThickness = 0.1;

const foldSize = 12;

/** An upright page with a folded corner: a pull request or a report. */
function DocumentShape({ hatch, height, placement }: DrawProps) {
  const { face } = useLook();
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
      <Face hatch={hatch} points={edge} />
      <Face points={topEdge} />
      <polygon data-face="" fill={face} points={toPoints(page)} />
      <g data-fold="">
        <polygon
          data-face=""
          fill={face}
          points={toPoints(flap)}
          strokeWidth={1}
        />
        <line
          data-crease=""
          strokeWidth={1.4}
          x1={foldTop.sx}
          x2={foldSide.sx}
          y1={foldTop.sy}
          y2={foldSide.sy}
        />
      </g>
      <g transform={alongX(at(from, height))}>
        {Arr.map(lines, (line, index) => (
          <line
            key={line}
            opacity={0.7}
            strokeWidth={1.2}
            x1={width * 0.14}
            x2={width * (index === lines.length - 1 ? 0.55 : 0.86)}
            y1={height * line}
            y2={height * line}
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
function ExternalShape({ hatch, height, placement }: DrawProps) {
  const { paint } = useLook();
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
        fill={paint.paper}
        points={toPoints(outline)}
        strokeDasharray={dashes.ring}
        strokeWidth={0.9}
      />
      <Prism hatch={hatch} placement={placement} z0={0} z1={height} />
    </>
  );
}

const drawings = {
  box: BoxShape,
  cards: CardsShape,
  document: DocumentShape,
  external: ExternalShape,
  gate: GateShape,
  job: JobShape,
  person: PersonShape,
  screen: ScreenShape,
  slab: SlabShape,
  store: StoreShape,
  tall: TallShape,
} as const satisfies Record<Shape, (props: DrawProps) => ReactNode>;

export function CodeChip({
  code,
  rect,
}: {
  readonly code: string;
  readonly rect: ScreenRect;
}) {
  const { paint, solid } = useLook();
  // The scene sizes the chip for its text, grown to stay readable.
  const grow = (rect.bottom - rect.top) / textSizes.chip.height;

  return (
    <g data-code-chip="">
      <rect
        fill={paint.paper}
        height={rect.bottom - rect.top}
        strokeWidth={1}
        width={rect.right - rect.left}
        x={rect.left}
        y={rect.top}
      />
      <text
        fill={solid}
        fontSize={textSizes.chip.font * grow}
        fontWeight={600}
        stroke="none"
        textAnchor="middle"
        x={(rect.left + rect.right) / 2}
        y={(rect.top + rect.bottom) / 2 + textSizes.chip.baseline * grow}
      >
        {code}
      </text>
    </g>
  );
}

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

/**
 * A power symbol on a switched-off structure, so "off" doesn't rest on colour
 * alone.
 */
export function OffMark({ at }: { readonly at: ScreenPoint }) {
  const { paint } = useLook();

  return (
    <g
      data-off-mark=""
      strokeLinecap="round"
      strokeWidth={1.4}
      transform={`translate(${at.sx} ${at.sy})`}
    >
      <circle fill={paint.paper} r={8} strokeWidth={1} />
      <path d="M-3.2,-2.6 A4.2,4.2 0 1 0 3.2,-2.6" fill="none" />
      <line x1={0} x2={0} y1={-4.8} y2={-0.6} />
    </g>
  );
}

/**
 * One structure in the Iso view, drawn as its shape and styled for its status,
 * with its code chip on top when it fits.
 */
export function IsoStructure({
  faded,
  hatch,
  isNew,
  placed: { chip, placement, structure },
}: StructureDrawingProps) {
  const { Frame, paint } = useDrawing();
  const Drawing = drawings[structure.shape];
  const look = looksOf(paint)[structure.status];

  return (
    <Frame
      faded={faded}
      id={structure.id}
      isNew={isNew}
      look={look}
      name={structure.name}
      shape={structure.shape}
      status={structure.status}
    >
      <LookContext value={look}>
        <Drawing
          hatch={hatch}
          height={isoHeights[structure.shape]}
          placement={placement}
        />
        {chip === undefined ? null : (
          <CodeChip code={structure.code} rect={chip} />
        )}
        {structure.status === "off" ? (
          <OffMark at={offMarkAt(structure, placement, chip !== undefined)} />
        ) : null}
      </LookContext>
    </Frame>
  );
}
