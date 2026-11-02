import {
  dragSegment,
  groundProjections,
  routeVertices,
  segmentGuides,
} from "@axonometric/contracts";
import type {
  GridPoint,
  Placement,
  SceneHop,
  SegmentGuide,
  View,
} from "@axonometric/contracts";
import { Array as Arr, Duration, Effect, Option } from "effect";
import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";

import { useDragPreview } from "./drag-preview-context.ts";
import { useEditing } from "./editing-context.ts";
import { groundAt } from "./ground-at.ts";
import { toPoints } from "./projection.ts";
import { useSelection } from "./selection-context.ts";

/** How far a press must move before it drags a segment, in pixels. */
const dragThreshold = 4;

/** How long after a press the click that follows it is still swallowed. */
const clickWindow = Duration.millis(60);

/** How wide a segment's invisible hit line is, in drawing units. */
const hitWidth = 10;

/**
 * The cursor for dragging a segment, which shows the axis it moves along. A
 * segment along x moves along y. Plan view draws x across and y down. The
 * Iso view draws x down and to the right and y down and to the left, so a
 * drag along y runs on the "/" diagonal and a drag along x on the "\".
 */
const cursorOf = (view: View, axis: SegmentGuide["axis"]) => {
  if (view === "plan") {
    return axis === "x" ? "cursor-ns-resize" : "cursor-ew-resize";
  }

  return axis === "x" ? "cursor-nesw-resize" : "cursor-nwse-resize";
};

interface RouteEnds {
  readonly from: Placement;
  readonly to: Placement;
}

/** One press on a segment, until it's released. */
interface Press {
  readonly hop: string;
  readonly segment: number;
  readonly axis: SegmentGuide["axis"];
  readonly pointer: number;
  /** Where the press started, in window pixels. */
  readonly from: { readonly x: number; readonly y: number };
  /** The ground point under the press. */
  readonly ground: GridPoint;
  readonly route: readonly GridPoint[];
  readonly ends: RouteEnds;
}

/** A press past the threshold, and the route it would leave. */
interface Drag {
  readonly hop: string;
  readonly points: readonly GridPoint[];
  /** Why dropping here would be refused, or nothing when it wouldn't. */
  readonly refusal: string | undefined;
}

const samePoints = (a: readonly GridPoint[], b: readonly GridPoint[]) =>
  a.length === b.length &&
  Arr.every(a, (point, index) => {
    const other = b[index];

    return other !== undefined && other.x === point.x && other.y === point.y;
  });

/**
 * The segments of one hop, each a wide invisible line over the place the
 * view draws it, which is its lane when the hop shares a grid line.
 */
function Segments({
  routed,
  view,
  onHover,
}: {
  readonly routed: SceneHop;
  readonly view: View;
  readonly onHover: (hop: string | null) => void;
}) {
  const ground = groundProjections[view];

  const guides = segmentGuides({
    route: routed.route.points,
    drawn: Arr.map(routed.points, ground.toGround),
  });

  return (
    <g data-route-segments={routed.hop.id}>
      {Arr.map(guides, (guide, index) => {
        const from = ground.toScreen(guide.from);
        const to = ground.toScreen(guide.to);

        return (
          <line
            // oxlint-disable-next-line react/no-array-index-key -- a segment is named by its position along the route.
            key={index}
            data-route-segment=""
            data-hop-id={routed.hop.id}
            data-segment={index}
            data-axis={guide.axis}
            x1={from.sx}
            y1={from.sy}
            x2={to.sx}
            y2={to.sy}
            stroke="transparent"
            strokeWidth={hitWidth}
            strokeLinecap="round"
            className={cursorOf(view, guide.axis)}
            onPointerEnter={() => {
              onHover(routed.hop.id);
            }}
            onPointerLeave={() => {
              onHover(null);
            }}
          >
            <title>{routed.hop.label}</title>
          </line>
        );
      })}
    </g>
  );
}

/**
 * Reroutes hops by dragging their segments, while the page can edit. It
 * wraps the hops' drawing (`children`), inside the viewport's transformed
 * group, and lays a wide invisible line over each segment.
 *
 * - Dragging a segment moves it square to itself on the half-unit grid, and
 *   the segments either side stretch to stay joined (`dragSegment`). The
 *   new route is previewed dashed, and turns red with the reason in its
 *   title while dropping it would be refused. Dropping saves a route
 *   override as a pending reroute.
 * - A click on a segment picks the hop, which opens its panel.
 * - The warnings the new route would add show as the drag goes.
 */
export function RouteEditor({
  view,
  hops,
  placements,
  onHover,
  children,
}: {
  readonly view: View;
  readonly hops: readonly SceneHop[];
  /** Where each structure is shown now. */
  readonly placements: Readonly<Partial<Record<string, Placement>>>;
  /** Called with the hop's id while the pointer is on it, else null. */
  readonly onHover: (hop: string | null) => void;
  readonly children: ReactNode;
}) {
  const editing = useEditing();
  const { selectedHop, selectHop } = useSelection();
  const preview = useDragPreview();
  const root = useRef<SVGGElement>(null);
  const press = useRef<Press | undefined>(undefined);
  const dragged = useRef(false);
  // Set after a press ends, so the click that follows it is swallowed.
  const swallow = useRef(false);
  const [drag, setDrag] = useState<Drag | undefined>();
  const live = editing?.canEdit === true;

  // A drag ends with a click, which would pick the hop or clear the
  // selection. The map surface listens for clicks natively, so the click is
  // stopped natively too, on the way down.
  useEffect(() => {
    const element = root.current;

    const onClick = (event: MouseEvent) => {
      if (dragged.current || swallow.current) {
        dragged.current = false;
        swallow.current = false;
        event.stopPropagation();
        event.preventDefault();
      }
    };

    element?.addEventListener("click", onClick, { capture: true });

    return () => {
      element?.removeEventListener("click", onClick, { capture: true });
    };
  }, []);

  useEffect(() => {
    preview?.show(
      drag === undefined || drag.refusal !== undefined
        ? undefined
        : [
            {
              id: "preview",
              kind: "reroute",
              target: { kind: "hop", id: drag.hop },
              points: drag.points,
            },
          ]
    );
  }, [drag, preview]);

  const onPointerDown = (event: ReactPointerEvent<SVGGElement>) => {
    const target =
      event.target instanceof Element
        ? event.target.closest<SVGElement>("[data-route-segment]")
        : null;

    const hop = target?.dataset.hopId;
    const element = root.current;

    if (
      !live ||
      event.button !== 0 ||
      event.shiftKey ||
      target === null ||
      hop === undefined ||
      element === null
    ) {
      return;
    }

    const routed = Arr.findFirst(hops, (item) => item.hop.id === hop);
    const ground = groundAt({ element, event, view });

    if (Option.isNone(routed) || ground === undefined) {
      return;
    }

    const from = placements[routed.value.hop.from];
    const to = placements[routed.value.hop.to];

    if (from === undefined || to === undefined) {
      return;
    }

    dragged.current = false;
    swallow.current = false;

    // A segment is thin, so the pointer leaves it within a step or two of
    // a drag. Capturing at once keeps the moves coming.
    element.setPointerCapture(event.pointerId);
    press.current = {
      hop,
      segment: Number(target.dataset.segment),
      axis: target.dataset.axis === "y" ? "y" : "x",
      pointer: event.pointerId,
      from: { x: event.clientX, y: event.clientY },
      ground,
      route: routed.value.route.points,
      ends: { from, to },
    };
  };

  const onPointerMove = (event: ReactPointerEvent<SVGGElement>) => {
    const { current } = press;
    const element = root.current;

    if (
      editing === null ||
      current === undefined ||
      element === null ||
      event.pointerId !== current.pointer
    ) {
      return;
    }

    const travel = Math.hypot(
      event.clientX - current.from.x,
      event.clientY - current.from.y
    );

    if (!dragged.current && travel < dragThreshold) {
      return;
    }

    const ground = groundAt({ element, event, view });

    if (ground === undefined) {
      return;
    }

    // Capture only once it's a drag, so a plain click keeps its target.
    if (!dragged.current) {
      dragged.current = true;

      if (!element.hasPointerCapture(event.pointerId)) {
        element.setPointerCapture(event.pointerId);
      }
    }

    // A segment along x moves along y, and the other way round.
    const offset =
      current.axis === "x"
        ? ground.y - current.ground.y
        : ground.x - current.ground.x;

    const points = dragSegment({
      points: current.route,
      segment: current.segment,
      offset,
      ends: current.ends,
    });

    const unchanged = samePoints(points, routeVertices(current.route));

    setDrag((before) =>
      before !== undefined && samePoints(before.points, points)
        ? before
        : {
            hop: current.hop,
            points,
            refusal: unchanged
              ? undefined
              : editing.refusalOfReroute(current.hop, points),
          }
    );
  };

  const end = (event: ReactPointerEvent<SVGGElement>, drop: boolean) => {
    const { current } = press;

    if (current === undefined || event.pointerId !== current.pointer) {
      return;
    }

    press.current = undefined;

    // The click that follows a press on a segment would clear the
    // selection. A press that never moved picks the hop instead.
    swallow.current = true;

    const release = Effect.sync(() => {
      swallow.current = false;
    });

    Effect.runFork(Effect.sleep(clickWindow).pipe(Effect.andThen(release)));

    if (drop && !dragged.current) {
      selectHop(current.hop);
    }

    if (
      drop &&
      dragged.current &&
      drag !== undefined &&
      editing !== null &&
      drag.refusal === undefined &&
      !samePoints(drag.points, routeVertices(current.route))
    ) {
      editing.reroute(drag.hop, drag.points);
    }

    setDrag(undefined);
  };

  const selected = Arr.findFirst(hops, (item) => item.hop.id === selectedHop);

  return (
    <g
      ref={root}
      data-route-editor={live ? "on" : "off"}
      data-dragging-route={drag?.hop}
      onPointerDown={live ? onPointerDown : undefined}
      onPointerMove={live ? onPointerMove : undefined}
      onPointerUp={(event) => {
        end(event, true);
      }}
      onPointerCancel={(event) => {
        end(event, false);
      }}
      onLostPointerCapture={(event) => {
        end(event, false);
      }}
    >
      {Option.isSome(selected) ? (
        <polyline
          data-hop-selected={selected.value.hop.id}
          aria-hidden="true"
          points={toPoints(selected.value.points)}
          fill="none"
          strokeLinejoin="round"
          className="stroke-ink pointer-events-none opacity-20"
          strokeWidth={7}
        />
      ) : null}
      {children}
      {live
        ? Arr.map(hops, (routed) => (
            <Segments
              key={routed.hop.id}
              routed={routed}
              view={view}
              onHover={onHover}
            />
          ))
        : null}
      {drag === undefined ? null : (
        <polyline
          data-route-preview={drag.hop}
          data-refused={drag.refusal !== undefined}
          points={toPoints(
            Arr.map(drag.points, groundProjections[view].toScreen)
          )}
          fill="none"
          strokeLinejoin="round"
          className={
            drag.refusal === undefined
              ? "stroke-pending pointer-events-none"
              : "stroke-refused pointer-events-none"
          }
          strokeWidth={drag.refusal === undefined ? 2.2 : 3}
          strokeDasharray={drag.refusal === undefined ? "6 3" : undefined}
        >
          {drag.refusal === undefined ? null : <title>{drag.refusal}</title>}
        </polyline>
      )}
    </g>
  );
}
