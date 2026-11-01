import type { Placement, Step, Structure } from "@axonometric/contracts";
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
import { BoxShape } from "./shapes.tsx";
import { showTextAt } from "./show-text.ts";

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
 * A step's name tag under its front corner. Tags draw after every box, so the
 * next step's box doesn't hide them.
 */
function StepTag({
  step,
  index,
}: {
  readonly step: Step;
  readonly index: number;
}) {
  const ground = corners(placementOf(index), 0);
  const label = `${index + 1} · ${step.name}`;
  const tagWidth = label.length * 7.2 + 12;

  return (
    <g
      data-step-tag={index + 1}
      data-grows="top"
      className="stroke-ink pointer-events-none"
    >
      <rect
        x={ground.front.sx - tagWidth / 2}
        y={ground.front.sy + 9}
        width={tagWidth}
        height={18}
        className="fill-paper"
        strokeWidth={0.9}
      />
      <text
        x={ground.front.sx}
        y={ground.front.sy + 22}
        textAnchor="middle"
        className="fill-ink stroke-none font-mono text-xs"
      >
        {label}
      </text>
    </g>
  );
}

/** The routes between consecutive steps, on screen. */
const routesOf = (steps: readonly Step[]) =>
  Arr.map(steps.slice(1), (_, index) =>
    Arr.map(
      routeHop({ from: placementOf(index), to: placementOf(index + 1) }),
      project
    )
  );

const viewBoxOf = (points: readonly ScreenPoint[]) => {
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

/**
 * Sizes the step names for the zoom the `viewBox` draws `svg` at, now and
 * whenever it's resized, as the map's viewport does for its name tags.
 */
const useReadableSteps = (
  svg: RefObject<SVGSVGElement | null>,
  box: { readonly width: number; readonly height: number }
) => {
  useLayoutEffect(() => {
    const element = svg.current;

    const measure = () => {
      if (element === null) {
        return;
      }

      showTextAt(
        element,
        Math.min(
          element.clientWidth / box.width,
          element.clientHeight / box.height
        )
      );
    };

    const observer = new ResizeObserver(measure);

    measure();

    if (element !== null) {
      observer.observe(element);
    }

    return () => {
      observer.disconnect();
    };
  }, [svg, box.width, box.height]);
};

const extentOf = (index: number) => {
  const placement = placementOf(index);
  const ground = corners(placement, 0);
  const top = corners(placement, boxHeight);

  return [
    top.back,
    top.left,
    top.right,
    { sx: ground.front.sx, sy: ground.front.sy + 30 },
  ];
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

  const box = useMemo(
    () => viewBoxOf(Arr.flatMap(steps, (_, index) => extentOf(index))),
    [steps]
  );

  const svgRef = useRef<SVGSVGElement>(null);

  useReadableSteps(svgRef, box);

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
            <StepTag key={item.name} step={item} index={index} />
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
