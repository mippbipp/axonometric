import {
  placeMovingNameTags,
  settledScale,
  textSizes,
  textZoomOf,
} from "@axonometric/contracts";
import type {
  Placement,
  ScreenRect,
  Step,
  Structure,
} from "@axonometric/contracts";
import { BoxShape, DrawingContext } from "@axonometric/drawing";
import { WithTooltip } from "@axonometric/ui/components/tooltip";
import { Array as Arr, String as Str } from "effect";
import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";

import { controlClass } from "./control-class.ts";
import { useFrameClock } from "./frame-clock.ts";
import { clockAtNextHop, packetAt, travelSeconds } from "./packet-schedule.ts";
import { pageDrawing } from "./page-environment.ts";
import { reducedMotionNote, useReducedMotion } from "./playback.ts";
import {
  corners,
  project,
  routeHop,
  toPoints,
  pointAlong,
} from "./projection.ts";
import type { ScreenPoint } from "./projection.ts";

/** Height of a step's box above the ground, in screen units. */
const boxHeight = 34;

/** Space around the drawing, in screen units. */
const margin = 56;

/**
 * Where step `index` sits: along a diagonal, each a little further right and
 * down, as system-atlas drew them.
 */
const placementOf = (index: number): Placement => ({
  d: 2,
  w: 2,
  x: 2 + index * 3.4,
  y: 2 + index * 0.6,
});

function StepBox({
  hatch,
  index,
}: {
  readonly hatch: string;
  readonly index: number;
}) {
  const placement = placementOf(index);

  const centre = project({
    x: placement.x + 1,
    y: placement.y + 1,
    z: boxHeight,
  });

  return (
    <g
      className="stroke-ink"
      data-step={index + 1}
      strokeLinejoin="round"
      strokeWidth={1.2}
    >
      <BoxShape hatch={hatch} height={boxHeight} placement={placement} />
      <text
        className="fill-ink stroke-none font-mono text-sm font-medium"
        textAnchor="middle"
        x={centre.sx}
        y={centre.sy + 5}
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
  const grow = (rect.bottom - rect.top) / textSizes.tag.height;

  return (
    <g className="stroke-ink pointer-events-none" data-step-tag={index + 1}>
      <rect
        className="fill-paper"
        height={rect.bottom - rect.top}
        strokeWidth={0.9}
        width={rect.right - rect.left}
        x={rect.left}
        y={rect.top}
      />
      <text
        className="fill-ink stroke-none font-mono"
        fontSize={textSizes.tag.font * grow}
        textAnchor="middle"
        x={(rect.left + rect.right) / 2}
        y={rect.top + textSizes.tag.baseline * grow}
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
const stepTagsAt = (steps: ReadonlyArray<Step>, zoom: number) =>
  placeMovingNameTags({
    boxes: Arr.map(steps, (step, index) => ({
      outline: stepOutline(index),
      placement: placementOf(index),
      text: labelOf(step, index),
    })),
    zoom,
  });

/** The routes between consecutive steps, on screen. */
const routesOf = (steps: ReadonlyArray<Step>) =>
  Arr.map(steps.slice(1), (_, index) =>
    Arr.map(
      routeHop({ from: placementOf(index), to: placementOf(index + 1) }),
      project
    )
  );

interface ViewBox {
  readonly height: number;
  readonly minX: number;
  readonly minY: number;
  readonly width: number;
}

const viewBoxOf = (points: ReadonlyArray<ScreenPoint>): ViewBox => {
  const xs = Arr.map(points, (point) => point.sx);
  const ys = Arr.map(points, (point) => point.sy);
  const minX = Math.min(...xs) - margin;
  const minY = Math.min(...ys) - margin;

  return {
    height: Math.max(...ys) + margin - minY,
    minX,
    minY,
    width: Math.max(...xs) + margin - minX,
  };
};

/** Every point the steps' boxes and `tags` reach. */
const extentOf = (
  steps: ReadonlyArray<Step>,
  tags: ReadonlyArray<ScreenRect>
) => [
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

/**
 * The inside view's drawing in a canvas of `size`: its viewBox, and where
 * the step tags go at the zoom that viewBox draws them, grown to stay
 * readable. The view has no viewport to read a zoom from, so it settles on
 * one the way a viewport's fit does (see `settledScale`).
 */
const insideLayoutOf = (
  steps: ReadonlyArray<Step>,
  size: { readonly height: number; readonly width: number }
) => {
  const layoutAt = (zoom: number) => {
    const tags = stepTagsAt(steps, textZoomOf(zoom));

    return { box: viewBoxOf(extentOf(steps, tags)), tags };
  };

  const scaleAt = (zoom: number) => {
    const { box } = layoutAt(zoom);

    return size.width <= 0 || size.height <= 0
      ? 1
      : Math.min(size.width / box.width, size.height / box.height);
  };

  return layoutAt(settledScale(scaleAt));
};

/** The size of `element` on screen, kept up to date as it's resized. */
const useSizeOf = (element: RefObject<Element | null>) => {
  const [size, setSize] = useState({ height: 0, width: 0 });

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
          : { height: target.clientHeight, width: target.clientWidth }
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
    advance: (seconds) => {
      setStored((current) => ({ ...current, clock: current.clock + seconds }));
    },
    playing,
  });

  return {
    clock: stored.clock,
    pause: () => {
      setStored((current) => ({ ...current, playing: false }));
    },
    play: () => {
      setStored((current) => ({ ...current, playing: true }));
    },
    playing,
    reducedMotion,
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

  const { clock, pause, play, playing, reducedMotion, step } = useInsideClock(
    routes.length
  );

  const at = packetAt({ clock, hops: routes.length });
  const route = routes[at.hop];

  const packet =
    route === undefined ? undefined : pointAlong({ points: route, t: at.t });

  return (
    <div className="relative size-full" data-inside-view={structure.id}>
      <DrawingContext value={pageDrawing}>
        <svg
          aria-labelledby={`${idPrefix}title`}
          className="text-ink block size-full"
          preserveAspectRatio="xMidYMid meet"
          ref={svgRef}
          textRendering="geometricPrecision"
          viewBox={`${box.minX} ${box.minY} ${box.width} ${box.height}`}
        >
          <title id={`${idPrefix}title`}>{`Inside ${structure.name}`}</title>
          <defs>
            <pattern
              height={6}
              id={hatch}
              patternTransform="rotate(45)"
              patternUnits="userSpaceOnUse"
              width={6}
            >
              <line
                stroke="currentColor"
                strokeWidth={1.1}
                x1={0}
                x2={0}
                y1={0}
                y2={6}
              />
            </pattern>
            <marker
              id={arrowhead}
              markerHeight={7}
              markerWidth={7}
              orient="auto-start-reverse"
              refX={9}
              refY={5}
              viewBox="0 0 10 10"
            >
              <path className="fill-ink stroke-none" d="M0,0 L10,5 L0,10 z" />
            </marker>
          </defs>
          <g>
            {Arr.map(routes, (points, index) => (
              <polyline
                className="stroke-ink"
                fill="none"
                key={index}
                markerEnd={`url(#${arrowhead})`}
                points={toPoints(points)}
                strokeWidth={1.4}
              />
            ))}
          </g>
          <g>
            {Arr.map(steps, (item, index) => (
              <StepBox hatch={hatch} index={index} key={item.name} />
            ))}
          </g>
          <g>
            {Arr.map(steps, (item, index) => (
              <StepTag
                index={index}
                key={item.name}
                label={labelOf(item, index)}
                rect={tags[index] ?? { bottom: 0, left: 0, right: 0, top: 0 }}
              />
            ))}
          </g>
          {packet === undefined ? null : (
            <circle
              className="fill-ink stroke-paper pointer-events-none"
              cx={packet.sx}
              cy={packet.sy}
              data-inside-packet
              data-playing={playing}
              r={5.5}
              strokeWidth={1.6}
            />
          )}
        </svg>
      </DrawingContext>
      {routes.length === 0 ? null : (
        <div className="absolute bottom-3 left-3 flex gap-1.5">
          {playing ? (
            <button className={controlClass} onClick={pause} type="button">
              ‖ Pause
            </button>
          ) : (
            <WithTooltip
              control={
                <button
                  aria-disabled={reducedMotion}
                  className={controlClass}
                  onClick={() => {
                    if (!reducedMotion) {
                      play();
                    }
                  }}
                  type="button"
                >
                  ▸ Play
                </button>
              }
              disabled={!reducedMotion}
            >
              {reducedMotionNote}
            </WithTooltip>
          )}
          <button className={controlClass} onClick={step} type="button">
            Step
          </button>
        </div>
      )}
    </div>
  );
}
