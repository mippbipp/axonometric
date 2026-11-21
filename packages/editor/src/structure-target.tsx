import { marked as marksOf, removedMark } from "@axonometric/contracts";
import { CanvasItem } from "@axonometric/ui/components/canvas-items";
import { TooltipTrigger } from "@axonometric/ui/components/tooltip";
import { cn } from "@axonometric/ui/lib/utils";
import { Array as Arr } from "effect";
import type { FocusEvent, PointerEvent, SVGProps } from "react";

import { useChapterPendingStructures } from "./chapter-marks-context.ts";
import { spokenMarks, useCompare } from "./compare-context.ts";
import { useConnections } from "./connections-context.ts";
import {
  agentStructures,
  pendingStructures,
  useEditingIgnoringEdit,
} from "./editing-context.ts";
import { useHopsDescription } from "./hop-description.ts";
import { drawHopKey, useHopDraft } from "./hop-draft-context.ts";
import { useProposedMapIgnoringEdit } from "./proposed-context.ts";
import { useSelection } from "./selection-context.ts";
import { useStructuresById } from "./structures.ts";
import { useTooltipActions } from "./tooltip-context.ts";

/**
 * The `<g>` that draws structure `id` in a view, one of the map's canvas
 * items, with `data-structure`, `data-selected`, `data-multi-selected` and
 * `data-pending` on it. Hover and keyboard focus show the tooltip. A click
 * or Space pins the structure, and Enter or a double-click goes inside it.
 * While the page can edit, Shift with a click, Enter or Space adds it to or
 * takes it out of the multi-selection (see `CanvasItems`). A pinned
 * structure reports `aria-pressed`; one in the multi-selection says so in
 * its accessible name, because ARIA has no multi-selection state for a
 * button. Its description lists its hops, and while a hop can be drawn,
 * `h` starts one from it (see `EdgeHandles`).
 *
 * Presses use no pointer capture, so a pan-and-zoom wrapper that leaves
 * presses on `[data-structure]` alone can't swallow them. Pass the drawing
 * as `children` and any other attributes as props.
 */
export function StructureTarget({
  children,
  className,
  id,
  ...rest
}: SVGProps<SVGGElement> & { readonly id: string }) {
  const { goInside, multiSelection, select, selected } = useSelection();

  const { controller, hide, show } = useTooltipActions();
  const name = useStructuresById().get(id)?.name ?? id;
  const connections = useConnections();
  const drafting = useHopDraft();
  const canDrawHop = connections?.canPropose === true && drafting !== null;
  const isSelected = selected === id;
  const editingIgnoringEdit = useEditingIgnoringEdit();
  const isMultiSelected = multiSelection.has(id);

  const proposed = useProposedMapIgnoringEdit();

  const isRemoved =
    proposed !== undefined && marksOf(proposed, removedMark).has(id);

  // A chapter proposal tints the structure in its own chapter only.
  const chapterPending = useChapterPendingStructures().has(id);

  const layoutPending = pendingStructures(editingIgnoringEdit).has(id);

  const isPending =
    layoutPending || proposed?.structures.has(id) === true || chapterPending;

  // Both authors on one structure should not happen (the engineer's edit
  // takes over), so the agent's mark wins only as a tie-break.
  const pendingBy = layoutPending
    ? agentStructures(editingIgnoringEdit).has(id)
      ? "agent"
      : "engineer"
    : undefined;

  const marks = useCompare();
  const kinds = marks?.structures.get(id);
  const marked = spokenMarks({ id, marks });

  // ui-sdk opens the tooltip. The structure also says where the pointer is,
  // or where the focused box is, so the tooltip is placed clear of the others.
  // The spotlight and edge handles follow the same hovered structure.
  const showAtPointer = (event: PointerEvent) => {
    show({ id, x: event.clientX, y: event.clientY });
  };

  const showOnKeyboardFocus = (event: FocusEvent<SVGGElement>) => {
    if (event.currentTarget.matches(":focus-visible")) {
      const box = event.currentTarget.getBoundingClientRect();

      show({ id, x: box.right, y: box.top });
    }
  };

  const hops = useHopsDescription(id);

  return (
    <TooltipTrigger
      controller={controller}
      payload={id}
      render={
        <CanvasItem
          {...rest}
          aria-description={hops}
          aria-keyshortcuts={canDrawHop ? drawHopKey.toUpperCase() : undefined}
          aria-label={Arr.join(
            [
              isMultiSelected ? `${name}, in the multi-selection` : name,
              ...(isPending
                ? [
                    pendingBy === "agent"
                      ? "pending change by the agent"
                      : "pending change",
                  ]
                : []),
              ...(isRemoved ? ["proposed for deletion"] : []),
              ...(marked === undefined ? [] : [marked]),
            ],
            ", "
          )}
          aria-pressed={isSelected}
          className={cn(
            "focus-visible:outline-ink cursor-pointer outline-none focus-visible:outline-1 focus-visible:outline-offset-4 focus-visible:outline-dashed",
            className
          )}
          data-compare={kinds?.join(" ")}
          data-multi-selected={isMultiSelected}
          data-pending={isPending}
          data-pending-by={pendingBy}
          data-removed={isRemoved}
          data-selected={isSelected}
          data-structure={id}
          onBlur={() => {
            hide(id);
          }}
          onDoubleClick={() => {
            goInside(id);
          }}
          onFocus={showOnKeyboardFocus}
          onOpen={() => {
            goInside(id);
          }}
          onPointerEnter={showAtPointer}
          onPointerLeave={() => {
            hide(id);
          }}
          onPointerMove={showAtPointer}
          onPress={() => {
            select(id);
          }}
          selectable
          value={id}
        />
      }
    >
      {children}
    </TooltipTrigger>
  );
}
