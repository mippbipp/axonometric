import { groupMembers } from "@axonometric/contracts";
import type {
  GridPoint,
  Layout,
  MapData,
  Placement,
  StructureMove,
  View,
} from "@axonometric/contracts";
import { Array as Arr } from "effect";
import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";

import { useDragPreview } from "./drag-preview-context.ts";
import { shiftDrawing } from "./drag-shift.ts";
import { DragOrigin, DropOutline } from "./drop-outline.tsx";
import { useEditing } from "./editing-context.ts";
import { groundAt } from "./ground-at.ts";

/** How far a press must move before it drags a group, in pixels. */
const dragThreshold = 4;

const snap = (value: number) => Math.round(value * 2) / 2;

/** One press on a zone's title, until it's released. */
interface Press {
  readonly group: string;
  readonly pointer: number;
  readonly from: { readonly x: number; readonly y: number };
  readonly ground: GridPoint;
  /** Every member of the group and where it was shown at the press. */
  readonly members: readonly (readonly [string, Placement])[];
}

/** A press past the threshold, and where it would put the group. */
interface Drag {
  readonly group: string;
  readonly by: GridPoint;
  readonly members: readonly (readonly [string, Placement])[];
  /** Why dropping here would be refused, or nothing when it wouldn't. */
  readonly refusal: string | undefined;
}

/** The moves that put every member `by` away from where it is. */
const movesBy = (
  members: readonly (readonly [string, Placement])[],
  by: GridPoint
): readonly StructureMove[] =>
  Arr.map(members, ([id, at]) => ({
    target: { kind: "structure" as const, id },
    position: { x: at.x + by.x, y: at.y + by.y },
  }));

/**
 * Moves a whole group by dragging its zone's title, while the page can
 * edit. It wraps the zones' drawing (`children`), inside the viewport's
 * transformed group.
 *
 * - Every structure the layout places in the group moves, as one change and
 *   one undo step, snapped to half units. That includes members the chapter
 *   hasn't revealed, so the group stays together.
 * - The zone and its members follow the pointer, and the dashed outlines
 *   show where each member would land. They turn red, with the reason in
 *   their title, while a footprint would overlap a structure outside the
 *   group, and dropping there writes nothing.
 * - The warnings the move would add show as the drag goes.
 */
export function GroupEditor({
  view,
  data,
  layout,
  children,
}: {
  readonly view: View;
  readonly data: Pick<MapData, "structures">;
  /** The layout as the page shows it now. */
  readonly layout: Layout;
  readonly children: ReactNode;
}) {
  const editing = useEditing();
  const preview = useDragPreview();
  const root = useRef<SVGGElement>(null);
  const press = useRef<Press | undefined>(undefined);
  const dragged = useRef(false);
  const [drag, setDrag] = useState<Drag | undefined>();
  const live = editing?.canEdit === true;

  // A drag ends with a click on the title, which would clear the selection.
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

  // The drawing is shifted from the whole canvas, because the members are
  // drawn in the structure layer, beside the zones.
  useEffect(() => {
    const canvas = root.current?.ownerSVGElement;

    if (canvas !== null && canvas !== undefined) {
      shiftDrawing({
        root: canvas,
        view,
        ids: drag === undefined ? [] : Arr.map(drag.members, ([id]) => id),
        groups: drag === undefined ? [] : [drag.group],
        by: drag?.by,
      });
    }
  }, [drag, view]);

  useEffect(() => {
    const moves =
      drag === undefined || drag.refusal !== undefined
        ? []
        : movesBy(drag.members, drag.by);

    preview?.show(
      Arr.isReadonlyArrayNonEmpty(moves)
        ? [{ id: "preview", kind: "move", moves }]
        : undefined
    );
  }, [drag, preview]);

  const onPointerDown = (event: ReactPointerEvent<SVGGElement>) => {
    const target =
      event.target instanceof Element
        ? event.target.closest<SVGElement>("[data-zone-title-hit]")
        : null;

    const group = target?.dataset.zoneTitleHit;
    const element = root.current;

    if (
      !live ||
      event.button !== 0 ||
      event.shiftKey ||
      group === undefined ||
      element === null
    ) {
      return;
    }

    const ground = groundAt({ element, event, view });

    if (ground === undefined) {
      return;
    }

    const members = Arr.flatMap(
      groupMembers({ data, layout, group }),
      (id): readonly (readonly [string, Placement])[] => {
        const at = layout.structures[id];

        return at === undefined ? [] : [[id, at]];
      }
    );

    dragged.current = false;

    // A title is small, so the pointer leaves it within a step or two of
    // a drag. Capturing at once keeps the moves coming.
    element.setPointerCapture(event.pointerId);
    press.current = {
      group,
      pointer: event.pointerId,
      from: { x: event.clientX, y: event.clientY },
      ground,
      members,
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

    if (!dragged.current) {
      dragged.current = true;

      if (!element.hasPointerCapture(event.pointerId)) {
        element.setPointerCapture(event.pointerId);
      }
    }

    const by = {
      x: snap(ground.x - current.ground.x),
      y: snap(ground.y - current.ground.y),
    };

    setDrag((before) =>
      before !== undefined && before.by.x === by.x && before.by.y === by.y
        ? before
        : {
            group: current.group,
            by,
            members: current.members,
            refusal:
              by.x === 0 && by.y === 0
                ? undefined
                : editing.refusalOfMoves(movesBy(current.members, by)),
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
      dragged.current &&
      drag !== undefined &&
      editing !== null &&
      drag.refusal === undefined &&
      (drag.by.x !== 0 || drag.by.y !== 0)
    ) {
      const { by } = drag;

      editing.arrange((placements) =>
        movesBy(
          Arr.flatMap(current.members, ([id]) => {
            const at = placements[id];

            return at === undefined ? [] : [[id, at] as const];
          }),
          by
        )
      );
    }

    setDrag(undefined);
  };

  return (
    <g
      ref={root}
      data-group-editor={live ? "on" : "off"}
      data-dragging-group={drag?.group}
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
      {drag === undefined
        ? null
        : Arr.map(drag.members, ([id, at]) => (
            <g key={id} className="pointer-events-none">
              <DragOrigin id={id} at={at} view={view} />
              <DropOutline
                id={id}
                at={{ ...at, x: at.x + drag.by.x, y: at.y + drag.by.y }}
                view={view}
                refusal={drag.refusal}
              />
            </g>
          ))}
    </g>
  );
}
