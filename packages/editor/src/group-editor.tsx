import { groupMembers, toPoints } from "@axonometric/contracts";
import type {
  GridPoint,
  Layout,
  MapData,
  Placement,
  SceneZone,
  StructureMove,
  View,
} from "@axonometric/contracts";
import { Array as Arr } from "effect";
import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

import { useDragPreview } from "./drag-preview-context.ts";
import { shiftDrawing } from "./drag-shift.ts";
import { useEditing } from "./editing-context.ts";
import { groundAt } from "./ground-at.ts";
import { useDropOutlines } from "./outlines-context.ts";
import { snap } from "./snap.ts";
import { useWalkthrough } from "./walkthrough-context.ts";

/** How far a press must move before it drags a group, in pixels. */
const dragThreshold = 4;

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
  zones,
}: {
  readonly view: View;
  readonly data: Pick<MapData, "structures">;
  /** The layout as the page shows it now. */
  readonly layout: Layout;
  /** The zones the view draws, whose titles are the handles. */
  readonly zones: readonly SceneZone[];
}) {
  const editing = useEditing();
  const { state } = useWalkthrough();
  const preview = useDragPreview();
  const setOutlines = useDropOutlines()?.set;
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
        hops: state.data.hops,
        by: drag?.by,
      });
    }
  }, [drag, view, state.data.hops]);

  // The outlines are drawn in a layer under the zones.
  useEffect(() => {
    setOutlines?.(
      drag === undefined
        ? undefined
        : {
            moving: Arr.map(drag.members, ([id, from]) => ({
              id,
              from,
              to: { ...from, x: from.x + drag.by.x, y: from.y + drag.by.y },
            })),
            refusal: drag.refusal,
          }
    );
  }, [drag, setOutlines]);

  useEffect(() => {
    const moves = drag === undefined ? [] : movesBy(drag.members, drag.by);

    if (drag === undefined || !Arr.isReadonlyArrayNonEmpty(moves)) {
      preview?.clear();

      return;
    }

    preview?.show({
      changes: [{ id: "preview", kind: "move", moves }],
      refusal: drag.refusal,
    });
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
      {live
        ? Arr.flatMap(zones, ({ zone, title }) =>
            title === undefined
              ? []
              : [
                  <polygon
                    key={zone.group.id}
                    data-zone-title-hit={zone.group.id}
                    points={toPoints(title)}
                    fill="transparent"
                    stroke="none"
                    className="cursor-move"
                  >
                    <title>
                      Drag to move every structure in {zone.group.title}
                    </title>
                  </polygon>,
                ]
          )
        : null}
    </g>
  );
}
