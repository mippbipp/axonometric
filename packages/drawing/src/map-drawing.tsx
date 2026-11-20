import {
  arrowheadOf,
  arrowPolygon,
  dashes,
  fadedOpacity,
  nameTagText,
  textSizes,
  toPoints,
} from "@axonometric/contracts";
import type {
  Scene,
  SceneHop,
  SceneStructure,
  ScreenPoint,
  Spotlight,
} from "@axonometric/contracts";
import { Array as Arr } from "effect";
import type { ReactNode } from "react";

import { useDrawing } from "./drawing-context.ts";
import { fadeAttributes, fadingOf } from "./fading.ts";
import { viewDrawings } from "./views.tsx";
import { Zones } from "./zones.tsx";

function NameTag({
  faded,
  grow,
  placed,
}: {
  /** Whether the spotlight fades the structure, and so its tag. */
  readonly faded: boolean | undefined;
  /** How much the text is grown, to match the size the scene placed it at. */
  readonly grow: number;
  readonly placed: SceneStructure;
}) {
  const { paint } = useDrawing();
  const { tag } = placed;
  // The border and text fade like a hop's line. The fill stays opaque, so
  // the tag still masks the lines behind it and its text stays legible.
  const fade = fadeAttributes({ faded, strength: fadedOpacity.line });

  return (
    <g
      data-faded={fade["data-faded"]}
      data-name-tag={placed.structure.id}
      pointerEvents="none"
    >
      <rect
        fill={paint.paper}
        height={tag.bottom - tag.top}
        stroke={paint.ink}
        strokeOpacity={fade.opacity}
        strokeWidth={0.9}
        width={tag.right - tag.left}
        x={tag.left}
        y={tag.top}
      />
      <text
        fill={paint.ink}
        fontSize={textSizes.tag.font * grow}
        opacity={fade.opacity}
        stroke="none"
        textAnchor="middle"
        x={(tag.left + tag.right) / 2}
        y={tag.top + textSizes.tag.baseline * grow}
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
const arrowPoints = (points: ReadonlyArray<ScreenPoint>) => {
  const head = arrowheadOf(points);
  const polygon = arrowPolygon(points);

  return head === undefined || polygon === undefined
    ? null
    : { base: head.base, polygon: toPoints(polygon) };
};

/** A hop's line, with the arrowhead drawn as part of its last segment. */
function Arrow({
  dashed = false,
  head,
  points,
}: {
  readonly dashed?: boolean;
  readonly head: boolean;
  readonly points: ReadonlyArray<ScreenPoint>;
}) {
  const { paint } = useDrawing();
  const arrow = head ? arrowPoints(points) : null;

  // The line stops at the arrowhead's base, so the head's tip is the end.
  const line = arrow === null ? points : [...points.slice(0, -1), arrow.base];

  return (
    <>
      <polyline
        fill="none"
        points={toPoints(line)}
        strokeDasharray={dashed ? dashes.hidden : undefined}
        strokeWidth={1.4}
      />
      {arrow === null ? null : (
        <polygon
          data-arrowhead=""
          fill={paint.ink}
          points={arrow.polygon}
          stroke="none"
        />
      )}
    </>
  );
}

function HopArrow({
  faded,
  markBends,
  onHover,
  routed,
  state,
}: {
  /** Whether the spotlight fades the hop, or `undefined` without one. */
  readonly faded: boolean | undefined;
  /** Whether to mark the route's bends with diamonds. */
  readonly markBends: boolean;
  /** Called with the hop's id while the pointer is on its line, else null. */
  readonly onHover: ((hop: string | null) => void) | undefined;
  readonly routed: SceneHop;
  /** The page's mark on the hop: a proposal that draws it, or one that deletes it. */
  readonly state: HopState | undefined;
}) {
  const { idOf, live, paint } = useDrawing();
  const { hop, points } = routed;
  const bends = markBends ? routed.bends : [];

  return (
    <g
      data-hop={hop.id}
      data-hop-state={state}
      data-route={toPoints(points)}
      id={idOf("hop", hop.id) ?? undefined}
      stroke={paint.ink}
      {...fadeAttributes({ faded, strength: fadedOpacity.line })}
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
          fill="none"
          points={toPoints(points)}
          stroke="transparent"
          strokeWidth={10}
        />
      ) : null}
      <Arrow head points={points} />
      {Arr.map(bends, (bend) => (
        <polygon
          fill={paint.ink}
          key={`${bend.sx},${bend.sy}`}
          points={diamond(bend)}
          stroke="none"
        />
      ))}
    </g>
  );
}

/**
 * What the page marks a hop as: `proposed` for a hop a proposal draws or
 * changes, `removed` for one proposed for deletion. A file marks none.
 */
export type HopState = "proposed" | "removed";

/**
 * The stretches of a hop's route that boxes are drawn over, drawn again
 * faintly on top of those boxes, so the hop never disappears. The stretch
 * that reaches an end hidden behind a box carries a faint arrowhead, since
 * the solid one is under the box; an end on a visible edge has its solid
 * head and no faint one.
 */
function HiddenHop({
  faded,
  routed,
  state,
}: {
  readonly faded: boolean | undefined;
  readonly routed: SceneHop;
  readonly state: HopState | undefined;
}) {
  const { paint } = useDrawing();

  return (
    <g
      data-hidden-hop={routed.hop.id}
      data-hop-state={state}
      stroke={paint.ink}
      {...fadeAttributes({ faded, strength: fadedOpacity.line })}
    >
      {Arr.map(routed.hidden, (stretch) => (
        <Arrow
          dashed
          head={stretch.reachesEnd}
          key={toPoints(stretch.points)}
          points={stretch.points}
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
  faded,
  grow,
  routed,
  shown,
}: {
  readonly faded: boolean | undefined;
  /** How much the text is grown, to match the size the scene placed it at. */
  readonly grow: number;
  readonly routed: SceneHop;
  /** Whether to show the label even where the scene found no room. */
  readonly shown: boolean;
}) {
  const { paint } = useDrawing();
  const { hop, hoverLabel, label } = routed;
  const at = label ?? (shown ? hoverLabel : undefined);

  return at === undefined ? null : (
    <text
      data-hop-label={hop.id}
      data-hop-label-fits={label !== undefined}
      fill={paint.ink}
      fontSize={textSizes.label.font * grow}
      paintOrder="stroke"
      stroke={paint.paper}
      strokeWidth={3}
      textAnchor="middle"
      x={(at.left + at.right) / 2}
      y={at.bottom - textSizes.label.baseline * grow}
      {...fadeAttributes({ faded, strength: fadedOpacity.line })}
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
      height={6}
      id={id}
      patternTransform="rotate(45)"
      patternUnits="userSpaceOnUse"
      width={6}
    >
      <line stroke={paint.ink} strokeWidth={1.1} x1={0} x2={0} y1={0} y2={6} />
    </pattern>
  );
}

/**
 * A scene drawn: each zone as a plate, each hop as an arrow, each revealed
 * structure as its shape with a name tag, and the hop labels on top. The
 * page and every exported file draw a map with this one component, in a
 * `DrawingContext` that says how to paint it.
 *
 * The page fills the slots with what only an editor has: `ground` is drawn
 * first, under the zones and their titles, `underlay` is drawn under the
 * hops, `hopsOverlay` over the hops and under the
 * structures, the context's `Layers` surround the structures, their hidden
 * hops and their tags, and `overlay` goes on top of the tags inside them. A
 * file leaves them all out.
 */
export function MapDrawing({
  ground,
  hatch,
  hopsOverlay,
  hopStates,
  labelShown,
  newlyRevealed,
  onHopHover,
  overlay,
  scene,
  spotlight,
  underlay,
}: {
  readonly ground?: ReactNode;
  /** The id of the hatch pattern this draws and its faces use. */
  readonly hatch: string;
  readonly hopsOverlay?: ReactNode;
  /** How the page marks hops its proposals touch; a file passes none. */
  readonly hopStates?: ReadonlyMap<string, HopState> | undefined;
  /** Whether a hop's label shows even where the scene found no room. */
  readonly labelShown?: ((hop: string) => boolean) | undefined;
  /** The structures to draw as new. */
  readonly newlyRevealed: ReadonlySet<string>;
  readonly onHopHover?: ((hop: string | null) => void) | undefined;
  readonly overlay?: ReactNode;
  readonly scene: Scene;
  /**
   * What to draw at full strength. Every other hop, with its label, and
   * structure, with its name tag and code chip, is faded. Without one,
   * nothing fades.
   */
  readonly spotlight?: Spotlight | null | undefined;
  readonly underlay?: ReactNode;
}) {
  const drawing = viewDrawings[scene.view];
  const { Structure } = drawing;
  const { Layers } = useDrawing();
  const fading = fadingOf(spotlight);

  return (
    <>
      <defs>
        <HatchPattern id={hatch} />
      </defs>
      {ground}
      <Zones Plate={drawing.Plate} zones={scene.zones} />
      {underlay}
      <g>
        {Arr.map(scene.hops, (item) => (
          <HopArrow
            faded={fading.hop(item.hop.id)}
            key={item.hop.id}
            markBends={drawing.markBends}
            onHover={onHopHover}
            routed={item}
            state={hopStates?.get(item.hop.id)}
          />
        ))}
      </g>
      {hopsOverlay}
      <Layers>
        <g>
          {Arr.map(scene.structures, (item) => (
            <Structure
              faded={fading.structure(item.structure.id)}
              hatch={hatch}
              isNew={newlyRevealed.has(item.structure.id)}
              key={item.structure.id}
              placed={item}
            />
          ))}
        </g>
        <g aria-hidden="true" opacity={0.4} pointerEvents="none">
          {Arr.map(scene.hops, (item) => (
            <HiddenHop
              faded={fading.hop(item.hop.id)}
              key={item.hop.id}
              routed={item}
              state={hopStates?.get(item.hop.id)}
            />
          ))}
        </g>
        <g>
          {Arr.map(scene.structures, (item) => (
            <NameTag
              faded={fading.structure(item.structure.id)}
              grow={scene.growth.tag}
              key={item.structure.id}
              placed={item}
            />
          ))}
        </g>
        {overlay}
      </Layers>
      <g pointerEvents="none">
        {Arr.map(scene.hops, (item) => (
          <HopLabel
            faded={fading.hop(item.hop.id)}
            grow={scene.growth.label}
            key={item.hop.id}
            routed={item}
            shown={labelShown?.(item.hop.id) === true}
          />
        ))}
      </g>
    </>
  );
}
