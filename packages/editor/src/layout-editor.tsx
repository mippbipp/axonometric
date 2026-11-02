import {
  groundProjections,
  samePlacement,
  samePosition,
} from "@axonometric/contracts";
import type {
  GridPoint,
  LayoutChange,
  Placement,
  StructureMove,
  View,
} from "@axonometric/contracts";
import { Array as Arr } from "effect";
import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";

import { useDragPreview } from "./drag-preview-context.ts";
import { shiftDrawing } from "./drag-shift.ts";
import { useEditing } from "./editing-context.ts";
import { groundAt } from "./ground-at.ts";
import { useDropOutlines } from "./outlines-context.ts";
import { useSelection } from "./selection-context.ts";
import { snap } from "./snap.ts";
import { useDrop } from "./use-drop.ts";
import { useWalkthrough } from "./walkthrough-context.ts";

/** How far a press must move before it drags a structure, in pixels. */
const dragThreshold = 4;

/** The smallest footprint side, in grid units. */
const minSide = 0.5;

/** A footprint corner a resize handle sits on, by compass point on the grid. */
type Corner = "nw" | "ne" | "se" | "sw";

const corners: readonly Corner[] = ["nw", "ne", "se", "sw"];

const isEast = (corner: Corner) => corner === "ne" || corner === "se";

const isSouth = (corner: Corner) => corner === "se" || corner === "sw";

/** Where a corner sits on a footprint, on the ground. */
const cornerPoint = (placement: Placement, corner: Corner): GridPoint => ({
  x: isEast(corner) ? placement.x + placement.w : placement.x,
  y: isSouth(corner) ? placement.y + placement.d : placement.y,
});

/**
 * The footprint after dragging `corner` of `start` by `delta` on the
 * ground, snapped to half units. The opposite corner stays put, and each
 * side keeps at least half a unit.
 */
const resized = (
  start: Placement,
  corner: Corner,
  delta: GridPoint
): Placement => {
  const right = start.x + start.w;
  const bottom = start.y + start.d;

  const x = isEast(corner)
    ? start.x
    : Math.min(snap(start.x + delta.x), right - minSide);

  const y = isSouth(corner)
    ? start.y
    : Math.min(snap(start.y + delta.y), bottom - minSide);

  return {
    x,
    y,
    w: isEast(corner) ? Math.max(snap(start.w + delta.x), minSide) : right - x,
    d: isSouth(corner)
      ? Math.max(snap(start.d + delta.y), minSide)
      : bottom - y,
  };
};

/** The footprint after moving `start` by `delta`, snapped to half units. */
const moved = (start: Placement, delta: GridPoint): Placement => ({
  ...start,
  x: snap(start.x + delta.x),
  y: snap(start.y + delta.y),
});

/** One press on a structure or a handle, until it's released. */
interface Press {
  readonly id: string;
  readonly pointer: number;
  /** Where the press started, in window pixels. */
  readonly from: { readonly x: number; readonly y: number };
  /** The ground point under the press. */
  readonly ground: GridPoint;
  /** Where the structure was shown when the press started. */
  readonly start: Placement;
  /** The handle's corner for a resize, or nothing for a move. */
  readonly corner: Corner | undefined;
}

/** A press past the threshold, and where it would put the structure. */
interface Drag {
  /** The structure under the pointer. */
  readonly id: string;
  /**
   * Every structure that moves with it: the multi-selection when the press
   * is on one of its structures, else just `id`.
   */
  readonly ids: readonly string[];
  readonly start: Placement;
  readonly next: Placement;
  /** Whether a corner handle is resizing the footprint, not moving it. */
  readonly resizing: boolean;
  /** Why dropping here would be refused, or nothing when it wouldn't. */
  readonly refusal: string | undefined;
}

/** The moves as the one move change a drop would make, or none. */
const movesChange = (
  moves: readonly StructureMove[]
): readonly LayoutChange[] =>
  Arr.isReadonlyArrayNonEmpty(moves)
    ? [{ id: "preview", kind: "move", moves }]
    : [];

/** Where each of `ids` goes when the pressed structure goes from `start` to `next`. */
const movesOf = (
  ids: readonly string[],
  placements: Readonly<Partial<Record<string, Placement>>>,
  { start, next }: Pick<Drag, "start" | "next">
): readonly StructureMove[] =>
  Arr.flatMap(ids, (id) => {
    const at = placements[id];

    return at === undefined
      ? []
      : [
          {
            target: { kind: "structure" as const, id },
            position: {
              x: at.x + next.x - start.x,
              y: at.y + next.y - start.y,
            },
          },
        ];
  });

/** The layout changes a drag would make, for the warnings beside the map. */
const previewChanges = (
  drag: Drag,
  placements: Readonly<Partial<Record<string, Placement>>>
): readonly LayoutChange[] =>
  drag.resizing
    ? [
        {
          id: "preview",
          kind: "resize",
          target: { kind: "structure", id: drag.id },
          footprint: { w: drag.next.w, d: drag.next.d },
        },
        ...(samePosition(drag.next, drag.start)
          ? []
          : movesChange(movesOf([drag.id], placements, drag)).slice(0, 1)),
      ]
    : movesChange(movesOf(drag.ids, placements, drag));

/**
 * Moves and resizes structures by dragging, while the page can edit. It
 * wraps a view's drawing, inside the viewport's transformed group.
 *
 * - A press on a structure that moves a few pixels drags it, snapped to
 *   half units. A press that doesn't move is left to the structure's click
 *   and double-click.
 * - The selected structure gets a handle on each corner of its footprint,
 *   on the ground in both views. Dragging one resizes the footprint, and
 *   the opposite corner stays put.
 * - While a drop would make footprints overlap, the footprint is outlined
 *   in red, and dropping there snaps the structure back.
 */
export function LayoutEditor({
  view,
  placements,
  children,
}: {
  readonly view: View;
  /** Where each structure is shown now. */
  readonly placements: Readonly<Partial<Record<string, Placement>>>;
  readonly children: ReactNode;
}) {
  const editing = useEditing();
  const dropping = useDrop();
  const preview = useDragPreview();
  const setOutlines = useDropOutlines()?.set;
  const { state } = useWalkthrough();
  const { selected, multiSelection } = useSelection();
  const root = useRef<SVGGElement>(null);
  const press = useRef<Press | undefined>(undefined);
  const dragged = useRef(false);
  const [drag, setDrag] = useState<Drag | undefined>();
  const live = editing?.canEdit === true;

  useEffect(() => {
    // Hop labels are drawn outside this group, so look from the canvas.
    const canvas = root.current?.ownerSVGElement;

    if (canvas !== null && canvas !== undefined) {
      shiftDrawing({
        root: canvas,
        view,
        ids: drag === undefined || drag.resizing ? [] : drag.ids,
        changing: drag?.ids,
        hops: state.data.hops,
        by:
          drag === undefined
            ? undefined
            : { x: drag.next.x - drag.start.x, y: drag.next.y - drag.start.y },
      });
    }
  }, [drag, view, state.data.hops]);

  // Whatever is dragged or resized, the panel beside the map says what the
  // drop would leave: its reason when refused, else every warning `check`
  // would report.
  useEffect(() => {
    if (drag === undefined) {
      preview?.clear();

      return;
    }

    const changes = previewChanges(drag, placements);

    preview?.show({ changes, refusal: drag.refusal });
  }, [drag, placements, preview]);

  // The outlines are drawn in a layer under the zones and the text.
  useEffect(() => {
    setOutlines?.(
      drag === undefined
        ? undefined
        : {
            moving: drag.resizing
              ? [{ id: drag.id, from: drag.start, to: drag.next }]
              : Arr.flatMap(
                  movesOf(drag.ids, placements, drag),
                  ({ target, position }) => {
                    const from = placements[target.id];

                    return from === undefined
                      ? []
                      : [{ id: target.id, from, to: { ...from, ...position } }];
                  }
                ),
            refusal: drag.refusal,
          }
    );
  }, [drag, placements, setOutlines]);

  // A drag ends with a click, which would pin the structure or, landing on
  // the group, clear the selection. The map surface listens for clicks
  // natively, so this has to stop the click natively too, on the way down.
  useEffect(() => {
    const element = root.current;

    const onClick = (event: MouseEvent) => {
      if (dragged.current) {
        dragged.current = false;
        event.stopPropagation();
        event.preventDefault();
      }
    };

    element?.addEventListener("click", onClick, { capture: true });

    return () => {
      element?.removeEventListener("click", onClick, { capture: true });
    };
  }, []);

  const begin = (event: ReactPointerEvent, id: string, corner?: Corner) => {
    const start = placements[id];
    const element = root.current;

    // A Shift-press picks structures or starts a selection box, and never
    // drags.
    if (
      !live ||
      event.button !== 0 ||
      event.shiftKey ||
      start === undefined ||
      element === null
    ) {
      return;
    }

    const ground = groundAt({ element, event, view });

    if (ground === undefined) {
      return;
    }

    dragged.current = false;
    press.current = {
      id,
      pointer: event.pointerId,
      from: { x: event.clientX, y: event.clientY },
      ground,
      start,
      corner,
    };

    // A handle is never a click target, so it takes the pointer at once,
    // and moves keep coming once the pointer leaves the small square.
    if (corner !== undefined) {
      element.setPointerCapture(event.pointerId);
    }
  };

  const onPointerDown = (event: ReactPointerEvent<SVGGElement>) => {
    const target =
      event.target instanceof Element
        ? event.target.closest<SVGElement>("[data-structure]")
        : null;

    const id = target?.dataset.structure;

    if (id !== undefined) {
      begin(event, id);
    }
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

    const delta = {
      x: ground.x - current.ground.x,
      y: ground.y - current.ground.y,
    };

    const next =
      current.corner === undefined
        ? moved(current.start, delta)
        : resized(current.start, current.corner, delta);

    // Pressing a structure of the multi-selection moves the whole set.
    const ids =
      current.corner === undefined && multiSelection.has(current.id)
        ? [...multiSelection]
        : [current.id];

    const together = ids.length > 1;

    setDrag((before) =>
      before !== undefined && samePlacement(before.next, next)
        ? before
        : {
            id: current.id,
            ids,
            start: current.start,
            next,
            resizing: current.corner !== undefined,
            refusal: together
              ? editing.refusalOfMoves(
                  movesOf(ids, placements, { start: current.start, next })
                )
              : dropping.refusalOf(current.id, next),
          }
    );
  };

  const end = (event: ReactPointerEvent<SVGGElement>, drop: boolean) => {
    const { current } = press;

    if (current === undefined || event.pointerId !== current.pointer) {
      return;
    }

    press.current = undefined;

    if (
      drop &&
      drag !== undefined &&
      editing !== null &&
      drag.refusal === undefined &&
      !samePlacement(drag.next, drag.start)
    ) {
      if (drag.ids.length > 1) {
        editing.arrange(() => movesOf(drag.ids, placements, drag));
      } else {
        dropping.drop(drag.id, drag.next);
      }
    }

    setDrag(undefined);
  };

  const handlesAt =
    selected === null || multiSelection.size > 0
      ? undefined
      : drag?.id === selected
        ? drag.next
        : placements[selected];

  return (
    <g
      ref={root}
      data-layout-editor={live ? "on" : "off"}
      data-dragging={drag?.id}
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
      {children}
      {live && selected !== null && handlesAt !== undefined ? (
        <ResizeHandles
          id={selected}
          placement={handlesAt}
          view={view}
          onPress={(event, corner) => {
            begin(event, selected, corner);
          }}
        />
      ) : null}
    </g>
  );
}

/** How big a resize handle is, in drawing units. */
const handleSize = 12;

/** A square handle on each corner of the selected structure's footprint. */
function ResizeHandles({
  id,
  placement,
  view,
  onPress,
}: {
  readonly id: string;
  readonly placement: Placement;
  readonly view: View;
  readonly onPress: (event: ReactPointerEvent, corner: Corner) => void;
}) {
  const ground = groundProjections[view];

  return (
    <g data-resize-handles={id}>
      {Arr.map(corners, (corner) => {
        const at = ground.toScreen(cornerPoint(placement, corner));

        return (
          <rect
            key={corner}
            data-resize-handle={corner}
            aria-hidden="true"
            x={at.sx - handleSize / 2}
            y={at.sy - handleSize / 2}
            width={handleSize}
            height={handleSize}
            className="fill-paper stroke-pending cursor-move"
            strokeWidth={1.5}
            onPointerDown={(event) => {
              onPress(event, corner);
            }}
          />
        );
      })}
    </g>
  );
}
