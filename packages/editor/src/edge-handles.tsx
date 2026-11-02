import { groundProjections } from "@axonometric/contracts";
import type {
  GridPoint,
  Placement,
  ScreenPoint,
  View,
} from "@axonometric/contracts";
import { Array as Arr, Option } from "effect";
import { use, useEffect, useEffectEvent, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

import { useConnections } from "./connections-context.ts";
import { edgeSpots, handleRadius } from "./edge-handle-spots.ts";
import type { Side } from "./edge-handle-spots.ts";
import { EditorTextsContext, EditorViewContext } from "./editor-view.ts";
import { groundAt } from "./ground-at.ts";
import { useHopDraft } from "./hop-draft-context.ts";
import { useSelection } from "./selection-context.ts";
import { HoveredIdContext } from "./tooltip-context.ts";

/** How far a press must move before it draws a hop, in pixels. */
const dragThreshold = 4;

/** One press on an edge handle, until it is released. */
interface Press {
  readonly from: string;
  readonly side: Side;
  readonly pointer: number;
  readonly start: { readonly x: number; readonly y: number };
}

/** A press past the threshold: where the line ends, and the structure under it. */
interface Stretch {
  readonly from: string;
  readonly side: Side;
  readonly end: GridPoint;
  readonly over: string | null;
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
 * dashed line and, on the drop, opens the label field in the side panel.
 * Dropping on empty space, or pressing Escape, draws nothing.
 *
 * This is an editing layer: it sits clear of name tags, code chips and hop
 * labels, and a file's drawing never includes it.
 */
export function EdgeHandles({ view }: { readonly view: View }) {
  const editor = use(EditorViewContext);
  const texts = use(EditorTextsContext);
  const connections = useConnections();
  const drafting = useHopDraft();
  const { selected } = useSelection();
  const hovered = use(HoveredIdContext);
  const root = useRef<SVGGElement>(null);
  const press = useRef<Press | undefined>(undefined);
  const [stretch, setStretch] = useState<Stretch | undefined>();
  const live = connections?.canPropose === true && drafting !== null;

  // A pinned structure keeps its handles; else the one under the pointer.
  // Moving from a structure onto one of its handles leaves the structure a
  // moment before it enters the handle, so a handle entered keeps its
  // structure as `near` until the pointer leaves the handle.
  const [near, setNear] = useState<string | null>(null);
  const owner = stretch?.from ?? selected ?? hovered ?? near;

  const cancelOnEscape = useEffectEvent((event: KeyboardEvent) => {
    if (event.key === "Escape" && stretch !== undefined) {
      press.current = undefined;
      setStretch(undefined);
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
  const projection = groundProjections[view];

  const pointer = (event: ReactPointerEvent) => {
    const element = root.current;

    return element === null ? undefined : groundAt({ element, event, view });
  };

  const onDown = (event: ReactPointerEvent, side: Side) => {
    const element = root.current;

    if (event.button !== 0 || event.shiftKey || element === null) {
      return;
    }

    event.stopPropagation();
    element.setPointerCapture(event.pointerId);
    press.current = {
      from: owner,
      side,
      pointer: event.pointerId,
      start: { x: event.clientX, y: event.clientY },
    };
  };

  const onMove = (event: ReactPointerEvent) => {
    const held = press.current;

    if (held === undefined || event.pointerId !== held.pointer) {
      return;
    }

    const travel = Math.hypot(
      event.clientX - held.start.x,
      event.clientY - held.start.y
    );

    if (stretch === undefined && travel < dragThreshold) {
      return;
    }

    const end = pointer(event);

    if (end !== undefined) {
      setStretch({
        from: held.from,
        side: held.side,
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
    if (drop && stretch !== undefined && stretch.over !== null) {
      drafting.begin(stretch.from, stretch.over);
    }

    setStretch(undefined);
  };

  const spots =
    placement === undefined ? [] : edgeSpots({ placement, view, texts });

  const origin: ScreenPoint | undefined =
    stretch === undefined
      ? undefined
      : spots.find(({ side }) => side === stretch.side)?.at;

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
      {Arr.map(spots, ({ side, at }) => (
        <circle
          key={side}
          data-edge-handle={side}
          data-edge-owner={owner}
          aria-hidden="true"
          cx={at.sx}
          cy={at.sy}
          r={handleRadius}
          className="fill-paper stroke-pending cursor-crosshair"
          strokeWidth={1.5}
          onPointerDown={(event) => {
            onDown(event, side);
          }}
          onPointerEnter={() => {
            setNear(owner);
          }}
          onPointerLeave={() => {
            setNear(null);
          }}
        />
      ))}
      {stretch === undefined || origin === undefined ? null : (
        <line
          data-hop-preview={stretch.from}
          data-over={stretch.over ?? ""}
          x1={origin.sx}
          y1={origin.sy}
          x2={projection.toScreen(stretch.end).sx}
          y2={projection.toScreen(stretch.end).sy}
          className={
            stretch.over === null
              ? "stroke-pending pointer-events-none opacity-60"
              : "stroke-pending pointer-events-none"
          }
          strokeWidth={2.2}
          strokeDasharray="6 3"
        />
      )}
    </g>
  );
}
