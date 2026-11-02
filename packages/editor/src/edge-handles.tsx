import type { GridPoint, Placement, View } from "@axonometric/contracts";
import { Array as Arr, Option } from "effect";
import { use, useEffect, useEffectEvent, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

import { useConnections } from "./connections-context.ts";
import { edgeSpots, handleRadius, handleStroke } from "./edge-handle-spots.ts";
import { EditorSceneContext, EditorViewContext } from "./editor-view.ts";
import { groundAt } from "./ground-at.ts";
import { useHopDraft } from "./hop-draft-context.ts";
import { useSelection } from "./selection-context.ts";
import { HoveredIdContext } from "./tooltip-context.ts";

/** How far a press must move before it draws a hop, in pixels. */
const dragThreshold = 4;

/** One press on an edge handle, until it is released. */
interface Press {
  readonly from: string;
  readonly start: ReturnType<typeof edgeSpots>[number];
  readonly pointer: number;
  readonly origin: { readonly x: number; readonly y: number };
}

/** The structure whose footprint holds `point`, other than `except`. */
const structureAt = ({
  placements,
  revealed,
  point,
  except,
}: {
  readonly placements: Readonly<Partial<Record<string, Placement>>>;
  readonly revealed: ReadonlySet<string>;
  readonly point: GridPoint;
  readonly except: string;
}): string | null =>
  Option.getOrNull(
    Arr.findFirst(
      Arr.filter([...revealed], (id) => id !== except),
      (id) => {
        const at = placements[id];

        return (
          at !== undefined &&
          point.x >= at.x &&
          point.x <= at.x + at.w &&
          point.y >= at.y &&
          point.y <= at.y + at.d
        );
      }
    )
  );

/**
 * Small handles on the edges of the selected or hovered structure, while the
 * page can propose, in both views. Dragging one to another structure draws a
 * line (see `HopDraftLine`) and, on the drop, opens the label field in the
 * side panel. Dropping on empty space, or pressing Escape, draws nothing.
 *
 * This is an editing layer: it keeps each handle at least `gapAt(zoom)` clear
 * of every name tag, code chip and hop label, and a file's drawing never
 * includes it. The handles are drawn over the structures, since they sit on
 * their edges; the line the drag draws is under the text.
 */
export function EdgeHandles({ view }: { readonly view: View }) {
  const editor = use(EditorViewContext);
  const { texts, zoom } = use(EditorSceneContext);
  const connections = useConnections();
  const drafting = useHopDraft();
  const { selected } = useSelection();
  const hovered = use(HoveredIdContext);
  const root = useRef<SVGGElement>(null);
  const press = useRef<Press | undefined>(undefined);
  const live = connections?.canPropose === true && drafting !== null;
  const stretch = drafting?.stretch ?? null;

  // A pinned structure keeps its handles; else the one under the pointer.
  // Moving from a structure onto one of its handles leaves the structure a
  // moment before it enters the handle, so a handle entered keeps its
  // structure as `near` until the pointer leaves the handle.
  const [near, setNear] = useState<string | null>(null);
  const owner = stretch?.from ?? selected ?? hovered ?? near;

  const cancelOnEscape = useEffectEvent((event: KeyboardEvent) => {
    if (event.key === "Escape" && stretch !== null) {
      press.current = undefined;
      drafting?.stretchTo(null);
    }
  });

  useEffect(() => {
    globalThis.addEventListener("keydown", cancelOnEscape);

    return () => {
      globalThis.removeEventListener("keydown", cancelOnEscape);
    };
  }, []);

  if (editor === null || !live || owner === null) {
    return <g ref={root} data-edge-handles="off" />;
  }

  const placement = editor.placements[owner];

  const spots =
    placement === undefined ? [] : edgeSpots({ placement, view, texts, zoom });

  const onDown = (
    event: ReactPointerEvent,
    start: ReturnType<typeof edgeSpots>[number]
  ) => {
    const element = root.current;

    if (event.button !== 0 || event.shiftKey || element === null) {
      return;
    }

    event.stopPropagation();
    element.setPointerCapture(event.pointerId);
    press.current = {
      from: owner,
      start,
      pointer: event.pointerId,
      origin: { x: event.clientX, y: event.clientY },
    };
  };

  const onMove = (event: ReactPointerEvent) => {
    const held = press.current;
    const element = root.current;

    if (
      held === undefined ||
      element === null ||
      event.pointerId !== held.pointer
    ) {
      return;
    }

    const travel = Math.hypot(
      event.clientX - held.origin.x,
      event.clientY - held.origin.y
    );

    if (stretch === null && travel < dragThreshold) {
      return;
    }

    const end = groundAt({ element, event, view });

    if (end !== undefined) {
      drafting.stretchTo({
        from: held.from,
        start: held.start.at,
        end,
        over: structureAt({
          placements: editor.placements,
          revealed: editor.revealed,
          point: end,
          except: held.from,
        }),
      });
    }
  };

  const finish = (event: ReactPointerEvent, drop: boolean) => {
    const held = press.current;

    if (held === undefined || event.pointerId !== held.pointer) {
      return;
    }

    press.current = undefined;

    // The drop is on a structure or it is nothing: empty space cancels.
    if (drop && stretch !== null && stretch.over !== null) {
      drafting.begin(stretch.from, stretch.over);
    }

    drafting.stretchTo(null);
  };

  return (
    <g
      ref={root}
      data-edge-handles={owner}
      onPointerMove={onMove}
      onPointerUp={(event) => {
        finish(event, true);
      }}
      onPointerCancel={(event) => {
        finish(event, false);
      }}
      onLostPointerCapture={(event) => {
        finish(event, false);
      }}
    >
      {Arr.map(spots, (spot) => (
        <circle
          key={spot.side}
          data-edge-handle={spot.side}
          data-edge-owner={owner}
          aria-hidden="true"
          cx={spot.at.sx}
          cy={spot.at.sy}
          r={handleRadius}
          className="fill-paper stroke-pending cursor-crosshair"
          strokeWidth={handleStroke}
          onPointerDown={(event) => {
            onDown(event, spot);
          }}
          onPointerEnter={() => {
            setNear(owner);
          }}
          onPointerLeave={() => {
            setNear(null);
          }}
        />
      ))}
    </g>
  );
}
