import { groundProjections, samePosition } from "@axonometric/contracts";
import type {
  GridPoint,
  LayoutChange,
  Placement,
  StructureMove,
  View,
} from "@axonometric/contracts";
import {
  GroundDrag,
  GroundHandle,
} from "@axonometric/ui/components/ground-drag";
import type {
  GroundBox,
  GroundCorner,
  GroundDraft,
  GroundPress,
} from "@axonometric/ui/components/ground-drag";
import { Array as Arr } from "effect";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import { useDragPreview } from "./drag-preview-context.ts";
import { dragShiftOf, useShiftDrawing } from "./drag-shift.ts";
import { useEditing } from "./editing-context.ts";
import { groundAt } from "./ground-at.ts";
import {
  boxOf,
  largeStep,
  movesTo,
  picks,
  saveMove,
  step,
} from "./ground-moves.ts";
import { useDropOutlines } from "./outlines-context.ts";
import { useSelection } from "./selection-context.ts";
import { useStructuresById } from "./structures.ts";
import { useDrop } from "./use-drop.ts";
import { useWalkthrough } from "./walkthrough-context.ts";

/** The smallest footprint side, in grid units. */
const minSide = 0.5;

const corners: ReadonlyArray<GroundCorner> = ["nw", "ne", "se", "sw"];

const cornerNames = {
  ne: "north-east",
  nw: "north-west",
  se: "south-east",
  sw: "south-west",
} as const satisfies Record<GroundCorner, string>;

const isEast = (corner: GroundCorner) => corner === "ne" || corner === "se";

const isSouth = (corner: GroundCorner) => corner === "se" || corner === "sw";

/** Where a corner sits on a footprint, on the ground. */
const cornerPoint = (
  placement: Placement,
  corner: GroundCorner
): GridPoint => ({
  x: isEast(corner) ? placement.x + placement.w : placement.x,
  y: isSouth(corner) ? placement.y + placement.d : placement.y,
});

const placementOf = ({ height, width, x, y }: GroundBox): Placement => ({
  d: height,
  w: width,
  x,
  y,
});

interface Drag {
  /** The structure under the pointer. */
  readonly id: string;
  /**
   * Every structure that moves with it: the multi-selection when the press
   * is on one of its structures, else just `id`.
   */
  readonly ids: ReadonlyArray<string>;
  readonly moves: ReadonlyArray<StructureMove>;
  readonly next: Placement;
  /** Why dropping here would be refused, or nothing when it wouldn't. */
  readonly refusal: string | undefined;
  /** Whether a corner handle is resizing the footprint, not moving it. */
  readonly resizing: boolean;
  readonly start: Placement;
}

/** The moves as the one move change a drop would make, or none. */
const movesChange = (
  moves: ReadonlyArray<StructureMove>
): ReadonlyArray<LayoutChange> =>
  Arr.isReadonlyArrayNonEmpty(moves)
    ? [{ by: "engineer", id: "preview", kind: "move", moves }]
    : [];

/** The layout changes a drag would make, for the warnings beside the map. */
const previewChanges = (drag: Drag): ReadonlyArray<LayoutChange> =>
  drag.resizing
    ? [
        {
          by: "engineer",
          footprint: { d: drag.next.d, w: drag.next.w },
          id: "preview",
          kind: "resize",
          target: { id: drag.id, kind: "structure" },
        },
        ...(samePosition(drag.next, drag.start) ? [] : movesChange(drag.moves)),
      ]
    : movesChange(drag.moves);

/**
 * Moves and resizes structures, while the page can edit. It wraps a view's
 * drawing, inside the viewport's transformed group, and works the same in
 * both views.
 *
 * - A press on a structure that moves 3 px drags it along the ground,
 *   snapped to half units, with the multi-selection when the structure is in
 *   it. A press that doesn't move is left to the structure's click and
 *   double-click. Escape puts the drag back.
 * - Alt and an arrow key nudge the multi-selection, or else the focused
 *   structure, by half a unit along the ground, and Shift too by two. Each
 *   press is one change and one undo step. A held key's repeats are
 *   ignored, so holding an arrow doesn't write a change per repeat; drag to
 *   go far.
 * - The selected structure gets a handle on each corner of its footprint,
 *   on the ground in both views. Dragging one, or an arrow key on it,
 *   resizes the footprint, and the opposite corner stays put.
 * - While a drop would make footprints overlap, the footprint is outlined
 *   in red, and dropping there snaps the structure back.
 */
export function LayoutEditor({
  children,
  placements,
  view,
}: {
  readonly children: ReactNode;
  /** Where each structure is shown now. */
  readonly placements: Readonly<Partial<Record<string, Placement>>>;
  readonly view: View;
}) {
  const editing = useEditing();
  const dropping = useDrop();
  const preview = useDragPreview();
  const setOutlines = useDropOutlines()?.set;
  const { state } = useWalkthrough();
  const { multiSelection, selected } = useSelection();
  const byId = useStructuresById();
  const root = useRef<SVGGElement>(null);
  const [drag, setDrag] = useState<Drag | undefined>();
  const live = editing?.canEdit === true;

  const boxes = useMemo(() => {
    const all: Record<string, GroundBox> = {};

    for (const [id, placement] of Object.entries(placements)) {
      if (placement !== undefined) {
        all[id] = boxOf(placement);
      }
    }

    return all;
  }, [placements]);

  const shift = useMemo(
    () =>
      dragShiftOf({
        by:
          drag === undefined
            ? undefined
            : { x: drag.next.x - drag.start.x, y: drag.next.y - drag.start.y },
        changing: drag?.ids,
        hops: state.data.hops,
        ids: drag === undefined || drag.resizing ? [] : drag.ids,
        view,
      }),
    [drag, view, state.data.hops]
  );

  useShiftDrawing({ root, shift });

  // Whatever is dragged or resized, the panel beside the map says what the
  // drop would leave: its reason when refused, else every warning `check`
  // would report.
  useEffect(() => {
    if (drag === undefined) {
      preview?.clear();

      return;
    }

    preview?.show({ changes: previewChanges(drag), refusal: drag.refusal });
  }, [drag, preview]);

  // The outlines are drawn in a layer under the zones and the text.
  useEffect(() => {
    setOutlines?.(
      drag === undefined
        ? undefined
        : {
            moving: drag.resizing
              ? [{ from: drag.start, id: drag.id, to: drag.next }]
              : Arr.flatMap(drag.moves, ({ position, target }) => {
                  const from = placements[target.id];

                  return from === undefined
                    ? []
                    : [{ from, id: target.id, to: { ...from, ...position } }];
                }),
            refusal: drag.refusal,
          }
    );
  }, [drag, placements, setOutlines]);

  const moveRefusal = (
    to: Readonly<Record<string, GridPoint>>,
    id: string,
    next: Placement
  ) =>
    Object.keys(to).length > 1
      ? editing?.refusalOfMoves(movesTo(to))
      : dropping.refusalOf(id, next);

  const dragOf = (draft: GroundDraft): Drag | undefined => {
    if (draft.kind === "resize") {
      const start = placementOf(draft.from);
      const next = placementOf(draft.to);

      return {
        id: draft.key,
        ids: [draft.key],
        moves: movesTo({ [draft.key]: { x: next.x, y: next.y } }),
        next,
        refusal: dropping.refusalOf(draft.key, next),
        resizing: true,
        start,
      };
    }

    const [id] = draft.keys;

    if (id === undefined) {
      return undefined;
    }

    const start = placements[id];
    const at = draft.to[id];

    if (start === undefined || at === undefined) {
      return undefined;
    }

    const next = { ...start, ...at };

    return {
      id,
      ids: Object.keys(draft.to),
      moves: movesTo(draft.to),
      next,
      refusal: moveRefusal(draft.to, id, next),
      resizing: false,
      start,
    };
  };

  const keysFor = (target: Element | null, press: GroundPress) => {
    const { input } = press;

    if (picks(press)) {
      return [];
    }

    if (input === "keyboard" && multiSelection.size > 0) {
      return [...multiSelection];
    }

    const id =
      target?.closest<SVGElement>("[data-structure]")?.dataset.structure ??
      (input === "keyboard"
        ? target?.closest<SVGElement>("[data-resize-handles]")?.dataset
            .resizeHandles
        : undefined);

    if (id === undefined) {
      return [];
    }

    // Pressing a structure of the multi-selection moves the whole set.
    return multiSelection.has(id)
      ? [id, ...[...multiSelection].filter((other) => other !== id)]
      : [id];
  };

  const onResize = (id: string, box: GroundBox) =>
    dropping.drop(id, placementOf(box)) === undefined;

  const handlesAt =
    selected === null || multiSelection.size > 0
      ? undefined
      : drag?.id === selected
        ? drag.next
        : placements[selected];

  return (
    <GroundDrag
      boxes={boxes}
      data-layout-editor={live ? "on" : "off"}
      disabled={!live}
      groundAt={(element, at) =>
        element instanceof SVGGraphicsElement
          ? groundAt({ element, event: at, view })
          : undefined
      }
      keysFor={keysFor}
      label={(id) => byId.get(id)?.name}
      largeStep={largeStep}
      minSize={minSide}
      onDraft={(draft) => {
        setDrag(draft === null ? undefined : dragOf(draft));
      }}
      onMove={(to, { input }) =>
        saveMove({
          // The drawing can lag the latest map while a worker draws new
          // data (see `useDrawnMap`), so a move keeps the footprint the
          // latest map gives the structure, and changes its position alone.
          dropOne: (id, next) => {
            const now = state.layout.structures[id];

            return dropping.drop(
              id,
              now === undefined ? next : { ...next, d: now.d, w: now.w }
            );
          },
          editing,
          input,
          placements,
          to,
        })
      }
      onResize={onResize}
      ref={root}
      step={step}
    >
      {children}
      {live && selected !== null && handlesAt !== undefined ? (
        <ResizeHandles
          id={selected}
          name={byId.get(selected)?.name ?? selected}
          placement={handlesAt}
          view={view}
        />
      ) : null}
    </GroundDrag>
  );
}

/** How big a resize handle is, in drawing units. */
const handleSize = 12;

function ResizeHandles({
  id,
  name,
  placement,
  view,
}: {
  readonly id: string;
  readonly name: string;
  readonly placement: Placement;
  readonly view: View;
}) {
  const ground = groundProjections[view];

  return (
    <g data-resize-handles={id}>
      {Arr.map(corners, (corner) => {
        const at = ground.toScreen(cornerPoint(placement, corner));

        return (
          <GroundHandle
            aria-label={`Resize ${name} from its ${cornerNames[corner]} corner`}
            className="fill-paper stroke-pending focus-visible:outline-ink outline-none focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-dashed"
            corner={corner}
            height={handleSize}
            key={corner}
            owner={id}
            strokeWidth={1.5}
            width={handleSize}
            x={at.sx - handleSize / 2}
            y={at.sy - handleSize / 2}
          />
        );
      })}
    </g>
  );
}
