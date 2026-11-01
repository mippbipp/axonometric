import { planStripHeight } from "@axonometric/contracts";
import type {
  ScreenPoint,
  ScreenRect,
  Shape,
  Structure,
} from "@axonometric/contracts";
import { Array as Arr } from "effect";
import type { ReactNode } from "react";

import { boundsOf } from "./bounds.ts";
import { toPoints } from "./iso.ts";
import { CodeChip, OffMark } from "./shapes.tsx";
import { StructureTarget } from "./structure-target.tsx";

// How each shape is drawn in Plan view: its footprint as a flat box seen
// from above, with a hatched strip along the bottom edge where the iso view
// shows the hatched sides, and a small icon of the shape in the middle. The
// icons keep the iso view's line weights and its `data-face` and
// `data-hatch` parts, so the status rules in index.css restyle both views.

const stripHeight = planStripHeight;

/** How big a shape's icon is, from its middle to its edge. */
const iconSize = 13;

interface IconProps {
  readonly hatch: string;
}

const face = "fill-face";

function BoxIcon() {
  // A cube, the iso view's box in miniature.
  const s = iconSize;

  return (
    <>
      <polygon
        data-face=""
        points={toPoints([
          { sx: 0, sy: -s },
          { sx: s, sy: -s / 2 },
          { sx: s, sy: s / 2 },
          { sx: 0, sy: s },
          { sx: -s, sy: s / 2 },
          { sx: -s, sy: -s / 2 },
        ])}
        className={face}
      />
      <polyline
        points={toPoints([
          { sx: -s, sy: -s / 2 },
          { sx: 0, sy: 0 },
          { sx: s, sy: -s / 2 },
        ])}
        fill="none"
      />
      <line x1={0} y1={0} x2={0} y2={s} />
    </>
  );
}

function TallIcon() {
  // A hipped roof from above: its ridges meet in the middle.
  const s = iconSize;

  return (
    <>
      <rect
        data-face=""
        x={-s}
        y={-s}
        width={s * 2}
        height={s * 2}
        className={face}
      />
      <line x1={-s} y1={-s} x2={s} y2={s} />
      <line x1={s} y1={-s} x2={-s} y2={s} />
    </>
  );
}

function StoreIcon() {
  // Three stacked drums.
  const rx = iconSize;
  const ry = iconSize * 0.36;
  const layer = (iconSize * 2 - ry * 2) / 3;
  const top = -iconSize + ry;

  return (
    <>
      {Arr.map([2, 1, 0], (index) => {
        const y = top + index * layer;

        return (
          <path
            key={index}
            data-face=""
            d={`M${-rx},${y} L${-rx},${y + layer} A${rx},${ry} 0 0 0 ${rx},${y + layer} L${rx},${y} Z`}
            className={face}
          />
        );
      })}
      <ellipse data-face="" cx={0} cy={top} rx={rx} ry={ry} className={face} />
    </>
  );
}

function CardsIcon() {
  // A fanned deck: three cards, each a little further down and right.
  const s = iconSize;

  return (
    <>
      {Arr.map([0, 1, 2], (index) => (
        <rect
          key={index}
          data-face=""
          x={-s + index * 4}
          y={-s + index * 4}
          width={s * 2 - 8}
          height={s * 2 - 8}
          className={face}
        />
      ))}
    </>
  );
}

function SlabIcon({ hatch }: IconProps) {
  // A wide, flat block with a hatched top.
  const s = iconSize;

  return (
    <>
      <rect
        data-face=""
        x={-s * 1.3}
        y={-s * 0.5}
        width={s * 2.6}
        height={s}
        className={face}
      />
      <rect
        data-hatch=""
        x={-s * 1.3}
        y={-s * 0.5}
        width={s * 2.6}
        height={s}
        fill={`url(#${hatch})`}
        stroke="none"
      />
    </>
  );
}

function ScreenIcon() {
  // A screen with lines of text on it.
  const s = iconSize;

  return (
    <>
      <rect
        data-face=""
        x={-s * 1.2}
        y={-s * 0.85}
        width={s * 2.4}
        height={s * 1.7}
        className={face}
      />
      <rect
        x={-s * 0.95}
        y={-s * 0.6}
        width={s * 1.9}
        height={s * 1.2}
        className="fill-paper"
        strokeWidth={0.9}
      />
      {Arr.map([-0.3, 0, 0.3], (at, index) => (
        <line
          key={at}
          x1={-s * 0.7}
          y1={s * at}
          x2={s * (index === 2 ? 0.1 : 0.7)}
          y2={s * at}
          opacity={0.7}
        />
      ))}
    </>
  );
}

function GateIcon() {
  // A box with a dark band across it.
  const s = iconSize;

  return (
    <>
      <rect
        data-face=""
        x={-s}
        y={-s}
        width={s * 2}
        height={s * 2}
        className={face}
      />
      <rect
        x={-s}
        y={-s * 0.25}
        width={s * 2}
        height={s * 0.5}
        className="fill-ink"
      />
    </>
  );
}

function JobIcon() {
  // A clock.
  const s = iconSize;

  return (
    <>
      <circle data-face="" r={s} className={face} />
      <path
        d={`M0,${-s * 0.65} L0,0 L${s * 0.5},0`}
        fill="none"
        strokeWidth={1.4}
      />
    </>
  );
}

function PersonIcon() {
  // A head and shoulders.
  const s = iconSize;

  return (
    <>
      <path
        data-face=""
        d={`M${-s},${s} A${s},${s * 0.9} 0 0 1 ${s},${s} Z`}
        className={face}
      />
      <circle data-face="" cy={-s * 0.35} r={s * 0.5} className={face} />
    </>
  );
}

function DocumentIcon() {
  // A page with a folded corner and lines of text.
  const s = iconSize;
  const fold = s * 0.6;
  const left = -s * 0.8;
  const right = s * 0.8;

  return (
    <>
      <polygon
        data-face=""
        points={toPoints([
          { sx: left, sy: -s },
          { sx: right - fold, sy: -s },
          { sx: right, sy: -s + fold },
          { sx: right, sy: s },
          { sx: left, sy: s },
        ])}
        className={face}
      />
      <g data-fold="">
        <polygon
          data-face=""
          points={toPoints([
            { sx: right - fold, sy: -s },
            { sx: right - fold, sy: -s + fold },
            { sx: right, sy: -s + fold },
          ])}
          className={face}
        />
      </g>
      {Arr.map([0, 0.35, 0.7], (at, index) => (
        <line
          key={at}
          x1={left + s * 0.3}
          y1={s * at - s * 0.1}
          x2={index === 2 ? 0 : right - s * 0.3}
          y2={s * at - s * 0.1}
          opacity={0.7}
        />
      ))}
    </>
  );
}

function ExternalIcon() {
  // An arrow coming in from outside.
  const s = iconSize;

  return (
    <>
      <rect
        data-face=""
        x={-s * 0.2}
        y={-s * 0.8}
        width={s * 1.2}
        height={s * 1.6}
        className={face}
      />
      <path
        d={`M${-s},0 L${s * 0.4},0 M${s * 0.05},${-s * 0.35} L${s * 0.4},0 L${s * 0.05},${s * 0.35}`}
        fill="none"
        strokeWidth={1.4}
        strokeLinecap="round"
      />
    </>
  );
}

const icons = {
  box: BoxIcon,
  tall: TallIcon,
  store: StoreIcon,
  cards: CardsIcon,
  slab: SlabIcon,
  screen: ScreenIcon,
  gate: GateIcon,
  job: JobIcon,
  person: PersonIcon,
  document: DocumentIcon,
  external: ExternalIcon,
} as const satisfies Record<Shape, (props: IconProps) => ReactNode>;

/** How far inside its outline an external box is drawn: its halo. */
const haloInset = 12;

const inset = (rect: ScreenRect, by: number): ScreenRect => ({
  left: rect.left + by,
  top: rect.top + by,
  right: rect.right - by,
  bottom: rect.bottom - by,
});

/** A box from above, with the hatched strip along its bottom edge. */
function Box({
  rect,
  hatch,
}: {
  readonly rect: ScreenRect;
  readonly hatch: string;
}) {
  const width = rect.right - rect.left;
  const height = rect.bottom - rect.top;

  return (
    <>
      <rect
        data-face=""
        x={rect.left}
        y={rect.top}
        width={width}
        height={height}
        className={face}
      />
      <rect
        data-hatch=""
        x={rect.left}
        y={rect.bottom - stripHeight}
        width={width}
        height={stripHeight}
        fill={`url(#${hatch})`}
        stroke="none"
      />
      <line
        x1={rect.left}
        y1={rect.bottom - stripHeight}
        x2={rect.right}
        y2={rect.bottom - stripHeight}
        strokeWidth={0.9}
      />
    </>
  );
}

/** Where the power mark sits: just inside the box's top right corner. */
const offMarkAt = (rect: ScreenRect): ScreenPoint => ({
  sx: rect.right - 12,
  sy: rect.top + 12,
});

/**
 * One structure in Plan view: its footprint from above with its shape's
 * icon in the middle, styled for its status, with its code chip in the top
 * left corner when it fits. An external structure sits inside a dashed
 * ring, as in the iso view.
 */
export function PlanStructure({
  structure,
  outline,
  chip,
  tag,
  hatch,
}: {
  readonly structure: Structure;
  /** What the shape draws, from the scene: the footprint, halo included. */
  readonly outline: readonly ScreenPoint[];
  readonly chip: ScreenRect | undefined;
  /** Where the name tag goes, from the scene, so the icon keeps clear. */
  readonly tag: ScreenRect;
  readonly hatch: string;
}) {
  const Icon = icons[structure.shape];
  const bounds = boundsOf(outline) ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 };

  const drawn = {
    left: bounds.minX,
    top: bounds.minY,
    right: bounds.maxX,
    bottom: bounds.maxY,
  };

  const external = structure.shape === "external";
  const box = external ? inset(drawn, haloInset) : drawn;

  // The icon sits in the middle of the room the tag leaves: above the tag
  // when the tag is inside the box, else above the hatched strip.
  const tagInside = tag.top >= box.top && tag.bottom <= box.bottom;
  const iconBottom = tagInside ? tag.top : box.bottom - stripHeight;

  return (
    <StructureTarget
      id={structure.id}
      data-shape={structure.shape}
      data-status={structure.status}
      className="stroke-ink"
      strokeWidth={1.2}
      strokeLinejoin="round"
    >
      {external ? (
        <rect
          data-external-ring=""
          x={drawn.left}
          y={drawn.top}
          width={drawn.right - drawn.left}
          height={drawn.bottom - drawn.top}
          className="fill-paper"
          strokeWidth={0.9}
          strokeDasharray="4 3"
        />
      ) : null}
      <Box rect={box} hatch={hatch} />
      <g
        data-plan-icon={structure.shape}
        transform={`translate(${(box.left + box.right) / 2} ${(box.top + iconBottom) / 2})`}
      >
        <Icon hatch={hatch} />
      </g>
      {chip === undefined ? null : (
        <CodeChip code={structure.code} rect={chip} />
      )}
      {structure.status === "off" ? <OffMark at={offMarkAt(box)} /> : null}
    </StructureTarget>
  );
}
