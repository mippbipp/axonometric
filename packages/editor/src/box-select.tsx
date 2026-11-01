import { groundProjections, structuresInBox } from "@axonometric/contracts";
import type { GridPoint, Placement, View } from "@axonometric/contracts";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { useEditing } from "./editing-context.ts";
import { groundAt } from "./ground-at.ts";
import { groundOutline, toPoints } from "./projection.ts";
import { useSelection } from "./selection-context.ts";

/** How far a press must move before it draws a box, in pixels. */
const dragThreshold = 4;

interface Box {
  readonly from: GridPoint;
  readonly to: GridPoint;
}

/** The handlers a box selection needs on the canvas. */
interface Handlers {
  readonly onDown: (event: PointerEvent) => void;
  readonly onMove: (event: PointerEvent) => void;
  readonly onUp: (event: PointerEvent) => void;
  readonly onClick: (event: MouseEvent) => void;
}

/** Listens with `handlers` on `svg`, and returns a function that stops. */
const listenOn = (svg: SVGSVGElement, handlers: Handlers) => {
  svg.addEventListener("pointerdown", handlers.onDown);
  svg.addEventListener("pointermove", handlers.onMove);
  svg.addEventListener("pointerup", handlers.onUp);
  svg.addEventListener("pointercancel", handlers.onUp);
  svg.addEventListener("click", handlers.onClick, { capture: true });

  return () => {
    svg.removeEventListener("pointerdown", handlers.onDown);
    svg.removeEventListener("pointermove", handlers.onMove);
    svg.removeEventListener("pointerup", handlers.onUp);
    svg.removeEventListener("pointercancel", handlers.onUp);
    svg.removeEventListener("click", handlers.onClick, { capture: true });
  };
};

/** A Shift-press on empty canvas, until it's released. */
interface Press {
  readonly pointer: number;
  readonly x: number;
  readonly y: number;
  /** The ground point the box started at. */
  readonly from: GridPoint;
  /** What was selected when the press began, which the box adds to. */
  readonly kept: ReadonlySet<string>;
}

const sameIds = (a: ReadonlySet<string>, b: ReadonlySet<string>) =>
  a.size === b.size && [...a].every((id) => b.has(id));

/**
 * Selects structures with a box: hold Shift and drag on empty canvas. A
 * plain drag on empty space still pans. The box is a rectangle on the
 * ground, so in the Iso view it's a diamond. It adds every structure whose
 * footprint it touches to the multi-selection, live as it grows, and keeps
 * what was already selected.
 *
 * It listens on the canvas that holds it, and draws inside the viewport's
 * transformed group, so the box pans and zooms with the map.
 */
export function BoxSelect({
  view,
  placements,
  revealed,
}: {
  readonly view: View;
  readonly placements: Readonly<Partial<Record<string, Placement>>>;
  /** The structures that are on the map now. */
  readonly revealed: ReadonlySet<string>;
}) {
  const editing = useEditing();
  const { marked, mark } = useSelection();
  const anchor = useRef<SVGGElement>(null);
  const [box, setBox] = useState<Box | undefined>();
  const live = editing?.canEdit === true;

  const press = useRef<Press | undefined>(undefined);
  const dragging = useRef(false);

  const onDown = useEffectEvent((event: PointerEvent) => {
    const element = anchor.current;

    dragging.current = false;

    if (
      element === null ||
      event.button !== 0 ||
      !event.shiftKey ||
      (event.target instanceof Element &&
        event.target.closest(
          "[data-structure], [data-packet], [data-resize-handle]"
        ) !== null)
    ) {
      return;
    }

    const from = groundAt({ element, event, view });

    if (from !== undefined) {
      press.current = {
        pointer: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        from,
        kept: marked,
      };
    }
  });

  const onMove = useEffectEvent((event: PointerEvent) => {
    const { current } = press;
    const element = anchor.current;

    if (
      current === undefined ||
      element === null ||
      event.pointerId !== current.pointer
    ) {
      return;
    }

    if (
      !dragging.current &&
      Math.hypot(event.clientX - current.x, event.clientY - current.y) <
        dragThreshold
    ) {
      return;
    }

    const to = groundAt({ element, event, view });

    if (to === undefined) {
      return;
    }

    if (!dragging.current) {
      dragging.current = true;
      element.ownerSVGElement?.setPointerCapture(event.pointerId);
    }

    const next = { from: current.from, to };

    setBox(next);

    const hit = new Set([
      ...current.kept,
      ...structuresInBox({
        placements,
        box: next,
        ids: [...revealed],
      }),
    ]);

    if (!sameIds(hit, marked)) {
      mark([...hit]);
    }
  });

  const onUp = useEffectEvent((event: PointerEvent) => {
    if (
      press.current !== undefined &&
      event.pointerId === press.current.pointer
    ) {
      press.current = undefined;
      setBox(undefined);
    }
  });

  // The release ends in a click on whatever is under the pointer, which
  // would clear the selection.
  const onClick = useEffectEvent((event: MouseEvent) => {
    if (dragging.current) {
      dragging.current = false;
      event.stopPropagation();
      event.preventDefault();
    }
  });

  useEffect(() => {
    const svg = anchor.current?.ownerSVGElement;

    return live && svg !== null && svg !== undefined
      ? listenOn(svg, { onDown, onMove, onUp, onClick })
      : undefined;
  }, [live]);

  const left = box === undefined ? 0 : Math.min(box.from.x, box.to.x);
  const top = box === undefined ? 0 : Math.min(box.from.y, box.to.y);

  return (
    <g ref={anchor} className="pointer-events-none">
      {box === undefined ? null : (
        <polygon
          data-selection-box=""
          aria-hidden="true"
          points={toPoints(
            groundOutline(
              {
                x: left,
                y: top,
                w: Math.abs(box.to.x - box.from.x),
                d: Math.abs(box.to.y - box.from.y),
              },
              groundProjections[view]
            )
          )}
          className="fill-pending/10 stroke-pending"
          strokeWidth={1.5}
          strokeDasharray="5 3"
        />
      )}
    </g>
  );
}
