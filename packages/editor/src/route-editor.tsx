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
import { bindCanvasDrag } from "@axonometric/ui/lib/canvas-drag";
import { Array as Arr, Option } from "effect";
import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

import { useDragPreview } from "./drag-preview-context.ts";
import {
  agentHops,
  pendingHops,
  useEditing,
  useEditingIgnoringEdit,
} from "./editing-context.ts";
import { groundAt } from "./ground-at.ts";
import { toPoints } from "./projection.ts";
import { useSelection } from "./selection-context.ts";

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

/** A press past the threshold, and the route it would leave. */
interface Drag {
  readonly hop: string;
  readonly points: ReadonlyArray<GridPoint>;
  /** Why dropping here would be refused, or nothing when it wouldn't. */
  readonly refusal: string | undefined;
}

const samePoints = (a: ReadonlyArray<GridPoint>, b: ReadonlyArray<GridPoint>) =>
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
  onHover,
  routed,
  view,
}: {
  readonly onHover: (hop: string | null) => void;
  readonly routed: SceneHop;
  readonly view: View;
}) {
  const ground = groundProjections[view];

  const guides = segmentGuides({
    drawn: Arr.map(routed.points, ground.toGround),
    route: routed.route.points,
  });

  return (
    <g data-route-segments={routed.hop.id}>
      {Arr.map(guides, (guide, index) => {
        const from = ground.toScreen(guide.from);
        const to = ground.toScreen(guide.to);

        return (
          <line
            className={cursorOf(view, guide.axis)}
            data-axis={guide.axis}
            data-hop-id={routed.hop.id}
            data-route-segment=""
            data-segment={index}
            key={index}
            onPointerEnter={() => {
              onHover(routed.hop.id);
            }}
            onPointerLeave={() => {
              onHover(null);
            }}
            stroke="transparent"
            strokeLinecap="round"
            strokeWidth={hitWidth}
            x1={from.sx}
            x2={to.sx}
            y1={from.sy}
            y2={to.sy}
          >
            <title>{routed.hop.label}</title>
          </line>
        );
      })}
    </g>
  );
}

/**
 * The route of each hop with a pending reroute, drawn in the pending blue
 * whether or not Edit is on, as the structures' pending look is.
 */
function PendingRoutes({ hops }: { readonly hops: ReadonlyArray<SceneHop> }) {
  const editing = useEditingIgnoringEdit();
  const rerouted = pendingHops(editing);
  const byAgent = agentHops(editing);

  return Arr.map(
    Arr.filter(hops, ({ hop }) => rerouted.has(hop.id)),
    (routed) => (
      <polyline
        aria-hidden="true"
        className="stroke-pending pointer-events-none"
        data-hop-pending={routed.hop.id}
        data-pending-by={byAgent.has(routed.hop.id) ? "agent" : "engineer"}
        fill="none"
        key={routed.hop.id}
        points={toPoints(routed.points)}
        strokeLinejoin="round"
        strokeWidth={2}
      />
    )
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
  hops,
  onHover,
  placements,
  view,
}: {
  readonly hops: ReadonlyArray<SceneHop>;
  /** Called with the hop's id while the pointer is on it, else null. */
  readonly onHover: (hop: string | null) => void;
  /** Where each structure is shown now. */
  readonly placements: Readonly<Partial<Record<string, Placement>>>;
  readonly view: View;
}) {
  const editing = useEditing();
  const { selectedHop, selectHop } = useSelection();
  const preview = useDragPreview();
  const root = useRef<SVGGElement>(null);
  const stop = useRef<(() => void) | undefined>(undefined);
  const [drag, setDrag] = useState<Drag | undefined>();
  const live = editing?.canEdit === true;

  // A press that never reached the drag threshold is a click on the hop.
  // The map surface listens for clicks natively and clears the selection on
  // one that lands on nothing, so this one is handled natively too, first.
  useEffect(() => {
    const element = root.current;

    const onClick = (event: MouseEvent) => {
      const target =
        event.target instanceof Element
          ? event.target.closest<SVGElement>("[data-route-segment]")
          : null;
      const hop = target?.dataset.hopId;

      if (hop === undefined) {
        return;
      }

      event.stopPropagation();
      event.preventDefault();
      selectHop(hop);
    };

    element?.addEventListener("click", onClick, { capture: true });

    return () => {
      element?.removeEventListener("click", onClick, { capture: true });
    };
  }, [selectHop]);

  useEffect(() => {
    if (!live) {
      stop.current?.();
    }
  }, [live]);

  useEffect(
    () => () => {
      stop.current?.();
    },
    []
  );

  useEffect(() => {
    if (drag === undefined) {
      preview?.clear();

      return;
    }

    preview?.show({
      changes: [
        {
          by: "engineer",
          id: "preview",
          kind: "reroute",
          points: drag.points,
          target: { id: drag.hop, kind: "hop" },
        },
      ],
      refusal: drag.refusal,
    });
  }, [drag, preview]);

  const onPointerDown = (event: ReactPointerEvent<SVGGElement>) => {
    const target =
      event.target instanceof Element
        ? event.target.closest<SVGElement>("[data-route-segment]")
        : null;

    const hop = target?.dataset.hopId;
    const element = root.current;

    if (
      editing === null ||
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
    const start = groundAt({ element, event, view });

    if (Option.isNone(routed) || start === undefined) {
      return;
    }

    const from = placements[routed.value.hop.from];
    const to = placements[routed.value.hop.to];

    if (from === undefined || to === undefined) {
      return;
    }

    const axis = target.dataset.axis === "y" ? "y" : "x";
    const route = routed.value.route.points;
    const segment = Number(target.dataset.segment);
    let latest: Drag | undefined;

    stop.current?.();

    const unbind = bindCanvasDrag(element, event.nativeEvent, {
      onEnd: ({ canceled }) => {
        stop.current = undefined;
        setDrag(undefined);

        if (
          !canceled &&
          latest !== undefined &&
          latest.refusal === undefined &&
          !samePoints(latest.points, routeVertices(route))
        ) {
          editing.reroute(hop, latest.points);
        }
      },
      onMove: (position) => {
        const ground = groundAt({ element, event: position, view });

        if (ground === undefined) {
          return;
        }

        // A segment along x moves along y, and the other way round.
        const offset = axis === "x" ? ground.y - start.y : ground.x - start.x;

        const points = dragSegment({
          ends: { from, to },
          offset,
          points: route,
          segment,
        });

        if (latest !== undefined && samePoints(latest.points, points)) {
          return;
        }

        latest = {
          hop,
          points,
          refusal: samePoints(points, routeVertices(route))
            ? undefined
            : editing.refusalOfReroute(hop, points),
        };
        setDrag(latest);
      },
    });

    stop.current = () => {
      unbind();
      stop.current = undefined;
      setDrag(undefined);
    };
  };

  const selected = Arr.findFirst(hops, (item) => item.hop.id === selectedHop);

  return (
    <g
      data-dragging-route={drag?.hop}
      data-route-editor={live ? "on" : "off"}
      onPointerDown={live ? onPointerDown : undefined}
      ref={root}
    >
      {Option.isSome(selected) ? (
        <polyline
          aria-hidden="true"
          className="stroke-ink pointer-events-none opacity-20"
          data-hop-selected={selected.value.hop.id}
          fill="none"
          points={toPoints(selected.value.points)}
          strokeLinejoin="round"
          strokeWidth={7}
        />
      ) : null}
      <PendingRoutes hops={hops} />
      {live
        ? Arr.map(hops, (routed) => (
            <Segments
              key={routed.hop.id}
              onHover={onHover}
              routed={routed}
              view={view}
            />
          ))
        : null}
      {drag === undefined ? null : (
        <polyline
          className={
            drag.refusal === undefined
              ? "stroke-pending pointer-events-none"
              : "stroke-refused pointer-events-none"
          }
          data-refused={drag.refusal !== undefined}
          data-route-preview={drag.hop}
          fill="none"
          points={toPoints(
            Arr.map(drag.points, groundProjections[view].toScreen)
          )}
          strokeDasharray={drag.refusal === undefined ? "6 3" : undefined}
          strokeLinejoin="round"
          strokeWidth={drag.refusal === undefined ? 2.2 : 3}
        >
          {drag.refusal === undefined ? null : <title>{drag.refusal}</title>}
        </polyline>
      )}
    </g>
  );
}
