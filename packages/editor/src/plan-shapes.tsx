import { growRect } from "@axonometric/contracts";
import type { ScreenPoint, ScreenRect, Shape } from "@axonometric/contracts";
import { Array as Arr } from "effect";
import type { ReactNode } from "react";

import { toPoints } from "./projection.ts";
import { CodeChip, OffMark } from "./shapes.tsx";
import type { StructureDrawingProps } from "./structure-drawing.ts";
import { StructureTarget } from "./structure-target.tsx";

// How each shape is drawn in Plan view: its footprint as a flat box seen
// from above, with a hatched strip along the bottom edge where the Iso view
// shows the hatched sides, and a small icon of the shape in the middle. The
// icons keep the Iso view's line weights and its `data-face` and
// `data-hatch` parts, so the status rules in index.css restyle both views.

/** How tall the hatched strip along a box's bottom edge is. */
const stripHeight = 7;

/** How big a shape's icon is, from its middle to its edge. */
const iconSize = 13;

interface IconProps {
  readonly hatch: string;
}

const face = "fill-face";

function BoxIcon() {
  // A cube, the Iso view's box in miniature.
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
  // A tall, narrow block of stacked floors: the brain stands highest.
  const s = iconSize;
  const floors = [-0.5, 0, 0.5];

  return (
    <>
      <rect
        data-face=""
        x={-s * 0.6}
        y={-s * 1.1}
        width={s * 1.2}
        height={s * 2.2}
        className={face}
      />
      {Arr.map(floors, (at) => (
        <line key={at} x1={-s * 0.6} y1={s * at} x2={s * 0.6} y2={s * at} />
      ))}
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
  // A wide, flat block, hatched across its top like the Iso view's slab.
  const s = iconSize;
  const top = { x: -s * 2, y: -s * 0.55, width: s * 4, height: s * 0.8 };

  return (
    <>
      <rect data-face="" {...top} className={face} />
      <rect data-hatch="" {...top} fill={`url(#${hatch})`} stroke="none" />
      <rect
        data-face=""
        x={top.x}
        y={top.y + top.height}
        width={top.width}
        height={s * 0.35}
        className={face}
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
  // An arrow coming in from outside, drawn lighter than a hop.
  const s = iconSize;

  return (
    <>
      <rect
        strokeWidth={1}
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
        strokeWidth={1}
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

/** The gap between an external box's two outlines. */
const ringGap = 4;

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
 * left corner when it fits. An external structure sits inside a second
 * outline, a gap away. A structure the chapter reveals is tinted.
 */
export function PlanStructure({
  placed: { structure, bounds, chip },
  hatch,
  isNew,
}: StructureDrawingProps) {
  const Icon = icons[structure.shape];
  const external = structure.shape === "external";
  const box = external ? growRect(bounds, -haloInset) : bounds;
  const ring = growRect(box, ringGap);

  return (
    <StructureTarget
      id={structure.id}
      data-shape={structure.shape}
      data-status={structure.status}
      data-new={isNew}
      className="stroke-ink"
      strokeWidth={1.2}
      strokeLinejoin="round"
    >
      {external ? (
        <rect
          data-external-ring=""
          x={ring.left}
          y={ring.top}
          width={ring.right - ring.left}
          height={ring.bottom - ring.top}
          className="fill-paper"
          strokeWidth={0.9}
        />
      ) : null}
      <Box rect={box} hatch={hatch} />
      {isNew ? (
        <rect
          data-new-marker={structure.id}
          x={box.left}
          y={box.top}
          width={box.right - box.left}
          height={box.bottom - box.top}
          className="fill-ink/15 pointer-events-none"
          stroke="none"
        />
      ) : null}
      <g
        data-plan-icon={structure.shape}
        transform={`translate(${(box.left + box.right) / 2} ${(box.top + box.bottom - stripHeight) / 2})`}
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
