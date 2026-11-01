import { placeNameTags } from "@axonometric/contracts";
import type {
  Placement,
  ScreenRect,
  Step,
  Structure,
} from "@axonometric/contracts";
import { Array as Arr, String as Str } from "effect";
import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";

import { controlClass } from "./control-class.ts";
import { useFrameClock } from "./frame-clock.ts";
import { clockAtNextHop, packetAt, travelSeconds } from "./packet-schedule.ts";
import { reducedMotionNote, useReducedMotion } from "./playback.ts";
import {
  corners,
  project,
  routeHop,
  toPoints,
  pointAlong,
} from "./projection.ts";
import type { ScreenPoint } from "./projection.ts";
import { textZoomOf } from "./readable-text.ts";
import { BoxShape } from "./shapes.tsx";

/** Height of a step's box above the ground, in screen units. */
const boxHeight = 34;

/** Space around the drawing, in screen units. */
const margin = 56;

/**
 * Where step `index` sits: along a diagonal, each a little further right and
 * down, as system-atlas drew them.
 */
const placementOf = (index: number): Placement => ({
  x: 2 + index * 3.4,
  y: 2 + index * 0.6,
  w: 2,
  d: 2,
});

function StepBox({
  index,
  hatch,
}: {
  readonly index: number;
  readonly hatch: string;
}) {
  const placement = placementOf(index);

  const centre = project({
    x: placement.x + 1,
    y: placement.y + 1,
    z: boxHeight,
  });

  return (
    <g
      data-step={index + 1}
      className="stroke-ink"
      strokeWidth={1.2}
      strokeLinejoin="round"
    >
      <BoxShape placement={placement} height={boxHeight} hatch={hatch} />
      <text
        x={centre.sx}
        y={centre.sy + 5}
        textAnchor="middle"
        className="fill-ink stroke-none font-mono text-sm font-medium"
      >
        {index + 1}
      </text>
    </g>
  );
}

/**
 * A step's name tag where the placement put it: under its front corner when
 * that's clear. Tags draw after every box, so the next step's box doesn't
 * hide them.
 */
function StepTag({
  index,
  label,
  rect,
}: {
  readonly index: number;
  readonly label: string;
  readonly rect: ScreenRect;
}) {
  // The tag's rect is sized for its text, grown to stay readable.
  const grow = (rect.bottom - rect.top) / 18;

  return (
    <g data-step-tag={index + 1} className="stroke-ink pointer-events-none">
      <rect
        x={rect.left}
        y={rect.top}
        width={rect.right - rect.left}
        height={rect.bottom - rect.top}
        className="fill-paper"
        strokeWidth={0.9}
      />
      <text
        x={(rect.left + rect.right) / 2}
        y={rect.top + 13 * grow}
        textAnchor="middle"
        fontSize={12 * grow}
        className="fill-ink stroke-none font-mono"
      >
        {label}
      </text>
    </g>
  );
}

const labelOf = (step: Step, index: number) => `${index + 1} · ${step.name}`;

/** A step box's outline on screen, clockwise from the top back corner. */
const stepOutline = (index: number) => {
  const ground = corners(placementOf(index), 0);
  const top = corners(placementOf(index), boxHeight);

  return [
    top.back,
    top.right,
    ground.right,
    ground.front,
    ground.left,
    top.left,
  ];
};

/**
 * Where each step's tag goes at the size it's drawn at `zoom`: under its
 * front corner, or the nearest spot clear of every step's box and the
 * tags before it.
 */
const stepTagsAt = (steps: readonly Step[], zoom: number) =>
  placeNameTags({
    boxes: Arr.map(steps, (step, index) => ({
      placement: placementOf(index),
      outline: stepOutline(index),
      text: labelOf(step, index),
    })),
    zoom,
    alwaysMove: true,
  });

/** The routes between consecutive steps, on screen. */
const routesOf = (steps: readonly Step[]) =>
  Arr.map(steps.slice(1), (_, index) =>
    Arr.map(
      routeHop({ from: placementOf(index), to: placementOf(index + 1) }),
      project
    )
  );

interface ViewBox {
  readonly minX: number;
  readonly minY: number;
  readonly width: number;
  readonly height: number;
}

const viewBoxOf = (points: readonly ScreenPoint[]): ViewBox => {
  const xs = Arr.map(points, (point) => point.sx);
  const ys = Arr.map(points, (point) => point.sy);
  const minX = Math.min(...xs) - margin;
  const minY = Math.min(...ys) - margin;

  return {
    minX,
    minY,
    width: Math.max(...xs) + margin - minX,
    height: Math.max(...ys) + margin - minY,
  };
};

/** Every point the steps' boxes and `tags` reach. */
const extentOf = (steps: readonly Step[], tags: readonly ScreenRect[]) => [
  ...Arr.flatMap(steps, (_, index) => {
    const top = corners(placementOf(index), boxHeight);
    const ground = corners(placementOf(index), 0);

    return [top.back, top.left, top.right, ground.front];
  }),
  ...Arr.flatMap(tags, (tag) => [
    { sx: tag.left, sy: tag.top },
    { sx: tag.right, sy: tag.bottom },
  ]),
];

/** How many times the view re-measures the steps as their tags grow. */
const fitRounds = 4;

/**
 * The inside view's drawing in a canvas of `size`: its viewBox, and where
 * the step tags go at the zoom that viewBox draws them, grown to stay
 * readable. Grown tags reach further, which zooms the view out, so it fits
 * again at that zoom until it settles.
 */
const insideLayoutOf = (
  steps: readonly Step[],
  size: { readonly width: number; readonly height: number }
) => {
  const zoomOf = (box: ViewBox) =>
    size.width <= 0 || size.height <= 0
      ? 1
      : Math.min(size.width / box.width, size.height / box.height);

  let zoom = 1;
  let tags = stepTagsAt(steps, zoom);
  let box = viewBoxOf(extentOf(steps, tags));

  for (let round = 0; round < fitRounds; round += 1) {
    const next = textZoomOf(Math.min(zoom, zoomOf(box)));

    if (next === zoom) {
      break;
    }

    zoom = next;
    tags = stepTagsAt(steps, zoom);
    box = viewBoxOf(extentOf(steps, tags));
  }

  return { box, tags };
};

/** The size of `element` on screen, kept up to date as it's resized. */
const useSizeOf = (element: RefObject<Element | null>) => {
  const [size, setSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const target = element.current;

    if (target === null) {
      return () => {};
    }

    const measure = () => {
      setSize((current) =>
        current.width === target.clientWidth &&
        current.height === target.clientHeight
          ? current
          : { width: target.clientWidth, height: target.clientHeight }
      );
    };

    const observer = new ResizeObserver(measure);

    measure();
    observer.observe(target);

    return () => {
      observer.disconnect();
    };
  }, [element]);

  return size;
};

interface InsideClock {
  readonly clock: number;
  readonly playing: boolean;
}

/** The inside packet's clock. It plays unless motion is reduced. */
const useInsideClock = (hops: number) => {
  const reducedMotion = useReducedMotion();

  const [stored, setStored] = useState<InsideClock>({
    clock: travelSeconds / 2,
    playing: true,
  });

  const playing = stored.playing && !reducedMotion && hops > 0;

  useFrameClock({
    playing,
    advance: (seconds) => {
      setStored((current) => ({ ...current, clock: current.clock + seconds }));
    },
  });

  return {
    clock: stored.clock,
    playing,
    reducedMotion,
    play: () => {
      setStored((current) => ({ ...current, playing: true }));
    },
    pause: () => {
      setStored((current) => ({ ...current, playing: false }));
    },
    step: () => {
      setStored((current) => ({
        clock: clockAtNextHop({ clock: current.clock, hops }),
        playing: false,
      }));
    },
  };
};

/**
 * The inside view of a structure: its steps in order along a diagonal, with
 * one packet walking from each step to the next.
 */
export function InsideView({ structure }: { readonly structure: Structure }) {
  const idPrefix = Str.replaceAll(/\W/gu, "")(useId());
  const hatch = `${idPrefix}hatch`;
  const arrowhead = `${idPrefix}arrowhead`;
  const steps = useMemo(() => structure.steps ?? [], [structure.steps]);
  const routes = useMemo(() => routesOf(steps), [steps]);

  const svgRef = useRef<SVGSVGElement>(null);
  const size = useSizeOf(svgRef);

  const { box, tags } = useMemo(
    () => insideLayoutOf(steps, size),
    [steps, size]
  );

  const { clock, playing, reducedMotion, play, pause, step } = useInsideClock(
    routes.length
  );

  const at = packetAt({ clock, hops: routes.length });
  const route = routes[at.hop];

  const packet =
    route === undefined ? undefined : pointAlong({ points: route, t: at.t });

  return (
    <div data-inside-view={structure.id} className="relative size-full">
      <svg
        ref={svgRef}
        aria-labelledby={`${idPrefix}title`}
        className="text-ink block size-full"
        viewBox={`${box.minX} ${box.minY} ${box.width} ${box.height}`}
        preserveAspectRatio="xMidYMid meet"
      >
        <title id={`${idPrefix}title`}>{`Inside ${structure.name}`}</title>
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
          {Arr.map(routes, (points, index) => (
            <polyline
              key={index}
              points={toPoints(points)}
              fill="none"
              className="stroke-ink"
              strokeWidth={1.4}
              markerEnd={`url(#${arrowhead})`}
            />
          ))}
        </g>
        <g>
          {Arr.map(steps, (item, index) => (
            <StepBox key={item.name} index={index} hatch={hatch} />
          ))}
        </g>
        <g>
          {Arr.map(steps, (item, index) => (
            <StepTag
              key={item.name}
              index={index}
              label={labelOf(item, index)}
              rect={tags[index] ?? { left: 0, top: 0, right: 0, bottom: 0 }}
            />
          ))}
        </g>
        {packet === undefined ? null : (
          <circle
            data-inside-packet
            data-playing={playing}
            cx={packet.sx}
            cy={packet.sy}
            r={5.5}
            className="fill-ink stroke-paper pointer-events-none"
            strokeWidth={1.6}
          />
        )}
      </svg>
      {routes.length === 0 ? null : (
        <div className="absolute bottom-3 left-3 flex gap-1.5">
          {playing ? (
            <button type="button" className={controlClass} onClick={pause}>
              ‖ Pause
            </button>
          ) : (
            <button
              type="button"
              className={controlClass}
              disabled={reducedMotion}
              title={reducedMotion ? reducedMotionNote : undefined}
              onClick={play}
            >
              ▸ Play
            </button>
          )}
          <button type="button" className={controlClass} onClick={step}>
            Step
          </button>
        </div>
      )}
    </div>
  );
}
