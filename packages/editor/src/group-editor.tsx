import { groupMembers, nudgeMoves, toPoints } from "@axonometric/contracts";
import type {
  GridPoint,
  Layout,
  MapData,
  Placement,
  SceneZone,
  StructureMove,
  View,
} from "@axonometric/contracts";
import { CanvasItem } from "@axonometric/ui/components/canvas-items";
import { GroundDrag } from "@axonometric/ui/components/ground-drag";
import type {
  GroundBox,
  GroundDraft,
  GroundInput,
} from "@axonometric/ui/components/ground-drag";
import { Array as Arr } from "effect";
import { useEffect, useMemo, useRef, useState } from "react";

import { useDragPreview } from "./drag-preview-context.ts";
import { shiftDrawing } from "./drag-shift.ts";
import { useEditing } from "./editing-context.ts";
import { groundAt } from "./ground-at.ts";
import { boxOf, largeStep, movesTo, step } from "./ground-moves.ts";
import { useDropOutlines } from "./outlines-context.ts";
import { useSelection } from "./selection-context.ts";
import { useStructuresById } from "./structures.ts";
import { useWalkthrough } from "./walkthrough-context.ts";

/** A drag of a group by its zone's title, and where it would put it. */
interface Drag {
  readonly by: GridPoint;
  readonly group: string;
  /** Every member of the group and where it was shown at the press. */
  readonly members: ReadonlyArray<readonly [string, Placement]>;
  /** Where each member goes, as the drop would put it. */
  readonly moves: ReadonlyArray<StructureMove>;
  /** Why dropping here would be refused, or nothing when it wouldn't. */
  readonly refusal: string | undefined;
}

const titleSelector = "[data-zone-title-hit]";

const shifted = (event: Event | undefined) =>
  (event instanceof MouseEvent || event instanceof KeyboardEvent) &&
  event.shiftKey;

/** Selects the title box of the pinned group's panel, once it has drawn. */
const selectTitleBox = () => {
  requestAnimationFrame(() => {
    document
      .querySelector<HTMLInputElement>("[data-group-panel] [data-group-title]")
      ?.select();
  });
};

/**
 * Moves a whole group by dragging its zone's title, or with Alt and an arrow
 * key on the focused title, while the page can edit. It wraps the zones'
 * drawing, inside the viewport's transformed group, and works the same in
 * both views.
 *
 * - Each title is one of the map's canvas items, named for its group. A
 *   click, Enter or Space opens the group's panel, with its rename form, and
 *   a double-click goes on to the title box.
 * - Every structure the layout places in the group moves, as one change and
 *   one undo step, snapped to half units. That includes members the chapter
 *   hasn't revealed, so the group stays together. A nudge moves them half a
 *   unit, and Shift too by two. Escape puts a drag back.
 * - The zone and its members follow the pointer, and the dashed outlines
 *   show where each member would land. They turn red, with the reason in
 *   their title, while a footprint would overlap a structure outside the
 *   group, and dropping there writes nothing.
 * - The warnings the move would add show as the drag goes.
 */
export function GroupEditor({
  data,
  layout,
  view,
  zones,
}: {
  readonly data: Pick<MapData, "structures">;
  /** The layout as the page shows it now. */
  readonly layout: Layout;
  readonly view: View;
  /** The zones the view draws, whose titles are the handles. */
  readonly zones: ReadonlyArray<SceneZone>;
}) {
  const editing = useEditing();
  const { state } = useWalkthrough();
  const { selectGroup } = useSelection();
  const preview = useDragPreview();
  const setOutlines = useDropOutlines()?.set;
  const byId = useStructuresById();
  const root = useRef<SVGGElement>(null);
  const [drag, setDrag] = useState<Drag | undefined>();
  const live = editing?.canEdit === true;

  const boxes = useMemo(() => {
    const all: Record<string, GroundBox> = {};

    for (const [id, placement] of Object.entries(layout.structures)) {
      all[id] = boxOf(placement);
    }

    return all;
  }, [layout.structures]);

  // The drawing is shifted from the whole canvas, because the members are
  // drawn in the structure layer, beside the zones.
  useEffect(() => {
    const canvas = root.current?.ownerSVGElement;

    if (canvas !== null && canvas !== undefined) {
      shiftDrawing({
        by: drag?.by,
        groups: drag === undefined ? [] : [drag.group],
        hops: state.data.hops,
        ids: drag === undefined ? [] : Arr.map(drag.members, ([id]) => id),
        root: canvas,
        view,
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
              from,
              id,
              to: { ...from, x: from.x + drag.by.x, y: from.y + drag.by.y },
            })),
            refusal: drag.refusal,
          }
    );
  }, [drag, setOutlines]);

  useEffect(() => {
    if (drag === undefined || !Arr.isReadonlyArrayNonEmpty(drag.moves)) {
      preview?.clear();

      return;
    }

    preview?.show({
      changes: [
        { by: "engineer", id: "preview", kind: "move", moves: drag.moves },
      ],
      refusal: drag.refusal,
    });
  }, [drag, preview]);

  const dragOf = (draft: GroundDraft): Drag | undefined => {
    if (draft.kind !== "move") {
      return undefined;
    }

    const members = Arr.flatMap(
      draft.keys,
      (id): ReadonlyArray<readonly [string, Placement]> => {
        const at = layout.structures[id];

        return at === undefined ? [] : [[id, at]];
      }
    );

    const [[first, start] = []] = members;
    const group = first === undefined ? undefined : byId.get(first)?.group;
    const at = first === undefined ? undefined : draft.to[first];

    if (group === undefined || start === undefined || at === undefined) {
      return undefined;
    }

    const by = { x: at.x - start.x, y: at.y - start.y };

    return {
      by,
      group,
      members,
      moves: movesTo(draft.to),
      refusal:
        by.x === 0 && by.y === 0
          ? undefined
          : editing?.refusalOfMoves(movesTo(draft.to)),
    };
  };

  /** The members of the group whose title `target` is, revealed or not. */
  const keysFor = (target: Element | null) => {
    const group =
      target?.closest<SVGElement>(titleSelector)?.dataset.zoneTitleHit;

    return group === undefined ? [] : groupMembers({ data, group, layout });
  };

  const onMove = (
    to: Readonly<Record<string, GridPoint>>,
    { input }: { readonly input: GroundInput }
  ) => {
    const ids = Object.keys(to);
    const [id] = ids;
    const start = id === undefined ? undefined : layout.structures[id];
    const at = id === undefined ? undefined : to[id];

    if (
      editing === null ||
      id === undefined ||
      start === undefined ||
      at === undefined
    ) {
      return false;
    }

    // A nudge is planned on the latest list, so quick presses add up, and
    // `arrange` shows a refusal as a notice.
    if (input === "keyboard") {
      const delta = { x: at.x - start.x, y: at.y - start.y };

      return (
        editing.arrange((latest) =>
          nudgeMoves({ delta, ids, placements: latest })
        ) === undefined
      );
    }

    // The red outline already said why a drop is refused, so it writes
    // nothing.
    return (
      editing.refusalOfMoves(movesTo(to)) === undefined &&
      editing.arrange(() => movesTo(to)) === undefined
    );
  };

  const pin = (group: string, event: Event | undefined) => {
    if (!shifted(event)) {
      selectGroup(group);
    }
  };

  return (
    <GroundDrag
      boxes={boxes}
      data-group-editor={live ? "on" : "off"}
      disabled={!live}
      groundAt={(element, at) =>
        element instanceof SVGGraphicsElement
          ? groundAt({ element, event: at, view })
          : undefined
      }
      keysFor={keysFor}
      label={(id) => byId.get(id)?.name}
      largeStep={largeStep}
      onDraft={(draft) => {
        setDrag(draft === null ? undefined : dragOf(draft));
      }}
      onMove={onMove}
      ref={root}
      step={step}
    >
      {live
        ? Arr.flatMap(zones, ({ title, zone }) =>
            title === undefined
              ? []
              : [
                  <CanvasItem
                    aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown Alt+ArrowLeft Alt+ArrowRight"
                    aria-label={`Group ${zone.group.title}`}
                    className="focus-visible:outline-ink cursor-move outline-none focus-visible:outline-1 focus-visible:outline-offset-4 focus-visible:outline-dashed"
                    data-zone-title-hit={zone.group.id}
                    key={zone.group.id}
                    onDoubleClick={() => {
                      selectGroup(zone.group.id);
                      selectTitleBox();
                    }}
                    onPress={(event) => {
                      pin(zone.group.id, event);
                    }}
                    value={`group:${zone.group.id}`}
                  >
                    <polygon
                      fill="transparent"
                      points={toPoints(title)}
                      stroke="none"
                    >
                      <title>
                        Click to open {zone.group.title}, double-click to rename
                        it, drag to move every structure in it
                      </title>
                    </polygon>
                  </CanvasItem>,
                ]
          )
        : null}
    </GroundDrag>
  );
}
