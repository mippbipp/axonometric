import { growRect, toPoints } from "@axonometric/contracts";
import type { ScreenPoint, ScreenRect, Shape } from "@axonometric/contracts";
import { Array as Arr } from "effect";
import type { ReactNode } from "react";

import { useDrawing } from "./drawing-context.ts";
import { LookContext, looksOf, useHatching, useLook } from "./look.ts";
import { CodeChip, OffMark } from "./shapes.tsx";
import type { StructureDrawingProps } from "./structure-drawing.ts";

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

function BoxIcon() {
  const { face } = useLook();
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
        fill={face}
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
  const { face } = useLook();
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
        fill={face}
      />
      {Arr.map(floors, (at) => (
        <line key={at} x1={-s * 0.6} y1={s * at} x2={s * 0.6} y2={s * at} />
      ))}
    </>
  );
}

function StoreIcon() {
  const { face } = useLook();
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
            fill={face}
          />
        );
      })}
      <ellipse data-face="" cx={0} cy={top} rx={rx} ry={ry} fill={face} />
    </>
  );
}

function CardsIcon() {
  const { face } = useLook();
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
          fill={face}
        />
      ))}
    </>
  );
}

function SlabIcon({ hatch }: IconProps) {
  const { face } = useLook();
  const hatching = useHatching(hatch);
  // A wide, flat block, hatched across its top like the Iso view's slab.
  const s = iconSize;
  const top = { x: -s * 2, y: -s * 0.55, width: s * 4, height: s * 0.8 };

  return (
    <>
      <rect data-face="" {...top} fill={face} />
      {hatching === undefined ? null : <rect {...top} {...hatching} />}
      <rect
        data-face=""
        x={top.x}
        y={top.y + top.height}
        width={top.width}
        height={s * 0.35}
        fill={face}
      />
    </>
  );
}

function ScreenIcon() {
  const { face, paint } = useLook();
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
        fill={face}
      />
      <rect
        x={-s * 0.95}
        y={-s * 0.6}
        width={s * 1.9}
        height={s * 1.2}
        fill={paint.paper}
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
  const { face, solid } = useLook();
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
        fill={face}
      />
      <rect x={-s} y={-s * 0.25} width={s * 2} height={s * 0.5} fill={solid} />
    </>
  );
}

function JobIcon() {
  const { face } = useLook();
  // A clock.
  const s = iconSize;

  return (
    <>
      <circle data-face="" r={s} fill={face} />
      <path
        d={`M0,${-s * 0.65} L0,0 L${s * 0.5},0`}
        fill="none"
        strokeWidth={1.4}
      />
    </>
  );
}

function PersonIcon() {
  const { face } = useLook();
  // A head and shoulders.
  const s = iconSize;

  return (
    <>
      <path
        data-face=""
        d={`M${-s},${s} A${s},${s * 0.9} 0 0 1 ${s},${s} Z`}
        fill={face}
      />
      <circle data-face="" cy={-s * 0.35} r={s * 0.5} fill={face} />
    </>
  );
}

function DocumentIcon() {
  const { face } = useLook();
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
        fill={face}
      />
      <g data-fold="">
        <polygon
          data-face=""
          points={toPoints([
            { sx: right - fold, sy: -s },
            { sx: right - fold, sy: -s + fold },
            { sx: right, sy: -s + fold },
          ])}
          fill={face}
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
  const { face } = useLook();
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
        fill={face}
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
  const { face } = useLook();
  const hatching = useHatching(hatch);
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
        fill={face}
      />
      {hatching === undefined ? null : (
        <rect
          x={rect.left}
          y={rect.bottom - stripHeight}
          width={width}
          height={stripHeight}
          {...hatching}
        />
      )}
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
  const { paint, Frame } = useDrawing();
  const look = looksOf(paint)[structure.status];
  const Icon = icons[structure.shape];
  const external = structure.shape === "external";
  const box = external ? growRect(bounds, -haloInset) : bounds;
  const ring = growRect(box, ringGap);

  return (
    <Frame
      id={structure.id}
      name={structure.name}
      shape={structure.shape}
      status={structure.status}
      isNew={isNew}
      look={look}
    >
      <LookContext value={look}>
        {external ? (
          <rect
            data-external-ring=""
            x={ring.left}
            y={ring.top}
            width={ring.right - ring.left}
            height={ring.bottom - ring.top}
            fill={paint.paper}
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
            fill={paint.ink}
            fillOpacity={0.15}
            pointerEvents="none"
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
      </LookContext>
    </Frame>
  );
}
