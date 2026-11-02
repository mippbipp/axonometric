import {
  arrowheadOf,
  arrowPolygon,
  dashes,
  nameTagText,
  textSizes,
  toPoints,
} from "@axonometric/contracts";
import type {
  Scene,
  SceneHop,
  SceneStructure,
  ScreenPoint,
} from "@axonometric/contracts";
import { Array as Arr } from "effect";
import type { ReactNode } from "react";

import { useDrawing } from "./drawing-context.ts";
import { viewDrawings } from "./views.tsx";
import { Zones } from "./zones.tsx";

function NameTag({
  placed,
  grow,
}: {
  readonly placed: SceneStructure;
  /** How much the text is grown, to match the size the scene placed it at. */
  readonly grow: number;
}) {
  const { paint } = useDrawing();
  const { tag } = placed;

  return (
    <g data-name-tag={placed.structure.id} pointerEvents="none">
      <rect
        x={tag.left}
        y={tag.top}
        width={tag.right - tag.left}
        height={tag.bottom - tag.top}
        fill={paint.paper}
        stroke={paint.ink}
        strokeWidth={0.9}
      />
      <text
        x={(tag.left + tag.right) / 2}
        y={tag.top + textSizes.tag.baseline * grow}
        textAnchor="middle"
        fontSize={textSizes.tag.font * grow}
        fill={paint.ink}
        stroke="none"
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
  const { paint } = useDrawing();
  const arrow = head ? arrowPoints(points) : null;

  // The line stops at the arrowhead's base, so the head's tip is the end.
  const line = arrow === null ? points : [...points.slice(0, -1), arrow.base];

  return (
    <>
      <polyline
        points={toPoints(line)}
        fill="none"
        strokeWidth={1.4}
        strokeDasharray={dashed ? dashes.hidden : undefined}
      />
      {arrow === null ? null : (
        <polygon
          data-arrowhead=""
          points={arrow.polygon}
          fill={paint.ink}
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
  readonly onHover: ((hop: string | null) => void) | undefined;
}) {
  const { paint, live, idOf } = useDrawing();
  const { hop, points } = routed;
  const bends = markBends ? routed.bends : [];

  return (
    <g
      data-hop={hop.id}
      id={idOf("hop", hop.id) ?? undefined}
      data-route={toPoints(points)}
      stroke={paint.ink}
      onPointerEnter={() => {
        onHover?.(hop.id);
      }}
      onPointerLeave={() => {
        onHover?.(null);
      }}
    >
      <title>{hop.label}</title>
      {/* A wide, invisible line, so the hop is easy to point at. */}
      {live ? (
        <polyline
          points={toPoints(points)}
          fill="none"
          stroke="transparent"
          strokeWidth={10}
        />
      ) : null}
      <Arrow points={points} head />
      {Arr.map(bends, (bend) => (
        <polygon
          key={`${bend.sx},${bend.sy}`}
          points={diamond(bend)}
          fill={paint.ink}
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
  const { paint } = useDrawing();

  return (
    <g data-hidden-hop={routed.hop.id} stroke={paint.ink}>
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
 * found no room for shows only while `shown`, which a file never sets.
 */
function HopLabel({
  routed,
  shown,
  grow,
}: {
  readonly routed: SceneHop;
  /** Whether to show the label even where the scene found no room. */
  readonly shown: boolean;
  /** How much the text is grown, to match the size the scene placed it at. */
  readonly grow: number;
}) {
  const { paint } = useDrawing();
  const { hop, label, hoverLabel } = routed;
  const at = label ?? (shown ? hoverLabel : undefined);

  return at === undefined ? null : (
    <text
      data-hop-label={hop.id}
      data-hop-label-fits={label !== undefined}
      x={(at.left + at.right) / 2}
      y={at.bottom - textSizes.label.baseline * grow}
      textAnchor="middle"
      fontSize={textSizes.label.font * grow}
      fill={paint.ink}
      stroke={paint.paper}
      strokeWidth={3}
      paintOrder="stroke"
    >
      {hop.label}
    </text>
  );
}

/** The diagonal hatching that faces are filled with. */
function HatchPattern({ id }: { readonly id: string }) {
  const { paint } = useDrawing();

  return (
    <pattern
      id={id}
      width={6}
      height={6}
      patternUnits="userSpaceOnUse"
      patternTransform="rotate(45)"
    >
      <line x1={0} y1={0} x2={0} y2={6} stroke={paint.ink} strokeWidth={1.1} />
    </pattern>
  );
}

/**
 * A scene drawn: each zone as a plate, each hop as an arrow, each revealed
 * structure as its shape with a name tag, and the hop labels on top. The
 * page and every exported file draw a map with this one component, in a
 * `DrawingContext` that says how to paint it.
 *
 * The page fills the slots with what only an editor has: `underlay` is
 * drawn under the hops, `hopsOverlay` over the hops and under the
 * structures, the context's `Layers` surround the structures, their hidden
 * hops and their tags, and `overlay` goes on top of the tags inside them. A
 * file leaves them all out.
 */
export function MapDrawing({
  scene,
  hatch,
  newlyRevealed,
  underlay,
  hopsOverlay,
  overlay,
  onHopHover,
  labelShown,
}: {
  readonly scene: Scene;
  /** The id of the hatch pattern this draws and its faces use. */
  readonly hatch: string;
  /** The structures to draw as new. */
  readonly newlyRevealed: ReadonlySet<string>;
  readonly underlay?: ReactNode;
  readonly hopsOverlay?: ReactNode;
  readonly overlay?: ReactNode;
  readonly onHopHover?: ((hop: string | null) => void) | undefined;
  /** Whether a hop's label shows even where the scene found no room. */
  readonly labelShown?: ((hop: string) => boolean) | undefined;
}) {
  const drawing = viewDrawings[scene.view];
  const { Structure } = drawing;
  const { Layers } = useDrawing();

  return (
    <>
      <defs>
        <HatchPattern id={hatch} />
      </defs>
      <Zones zones={scene.zones} Plate={drawing.Plate} />
      {underlay}
      <g>
        {Arr.map(scene.hops, (item) => (
          <HopArrow
            key={item.hop.id}
            routed={item}
            markBends={drawing.markBends}
            onHover={onHopHover}
          />
        ))}
      </g>
      {hopsOverlay}
      <Layers>
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
        <g aria-hidden="true" pointerEvents="none" opacity={0.4}>
          {Arr.map(scene.hops, (item) => (
            <HiddenHop key={item.hop.id} routed={item} />
          ))}
        </g>
        <g>
          {Arr.map(scene.structures, (item) => (
            <NameTag
              key={item.structure.id}
              placed={item}
              grow={scene.growth.tag}
            />
          ))}
        </g>
        {overlay}
      </Layers>
      <g pointerEvents="none">
        {Arr.map(scene.hops, (item) => (
          <HopLabel
            key={item.hop.id}
            routed={item}
            shown={labelShown?.(item.hop.id) === true}
            grow={scene.growth.label}
          />
        ))}
      </g>
    </>
  );
}
