import { cn } from "@axonometric/ui/lib/utils";
import type { FocusEvent, KeyboardEvent, PointerEvent, SVGProps } from "react";

import { pendingStructures, useEditing } from "./editing-context.ts";
import { useSelection } from "./selection-context.ts";
import { useStructuresById } from "./structures.ts";
import { useTooltipActions } from "./tooltip-context.ts";

/**
 * The `<g>` that draws structure `id` in a view, with `data-structure`,
 * `data-selected`, `data-multi-selected` and `data-pending` on it. Hover and
 * keyboard focus show the tooltip. A click pins the structure, and a
 * Shift-click adds it to or takes it out of the multi-selection. A
 * double-click goes inside it. A pinned structure reports `aria-pressed`;
 * one in the multi-selection says so in its accessible name, because ARIA
 * has no multi-selection state for a button. Enter and Space do what a click does, and
 * Shift+Enter and Shift+Space what a Shift-click does.
 *
 * Clicks are plain `onClick`, with no pointer capture, so a pan-and-zoom
 * wrapper that leaves presses on `[data-structure]` alone can't swallow
 * them. Pass the drawing as `children` and any other attributes as props.
 */
export function StructureTarget({
  id,
  children,
  className,
  ...rest
}: SVGProps<SVGGElement> & { readonly id: string }) {
  const { selected, multiSelection, select, toggleMultiSelected, goInside } =
    useSelection();

  const { show, hide } = useTooltipActions();
  const name = useStructuresById().get(id)?.name ?? id;
  const isSelected = selected === id;
  const editing = useEditing();
  const isMultiSelected = multiSelection.has(id);

  const isPending = pendingStructures(editing).has(id);

  const showAtPointer = (event: PointerEvent) => {
    show({ id, x: event.clientX, y: event.clientY });
  };

  const showOnKeyboardFocus = (event: FocusEvent<SVGGElement>) => {
    if (event.currentTarget.matches(":focus-visible")) {
      const box = event.currentTarget.getBoundingClientRect();

      show({ id, x: box.right, y: box.top });
    }
  };

  // Shift picks several structures to edit together. A page that can't edit
  // has nothing to do with a set, so there it pins.
  const activate = (shift: boolean) => {
    if (shift && editing?.canEdit === true) {
      toggleMultiSelected(id);
    } else {
      select(id);
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      activate(event.shiftKey);
    }
  };

  return (
    <g
      {...rest}
      className={cn(
        "focus-visible:outline-ink cursor-pointer outline-none focus-visible:outline-1 focus-visible:outline-offset-4 focus-visible:outline-dashed",
        className
      )}
      data-structure={id}
      data-selected={isSelected}
      data-multi-selected={isMultiSelected}
      data-pending={isPending}
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- SVG has no <button> element, so the structure's group takes the button role.
      role="button"
      tabIndex={0}
      aria-label={isMultiSelected ? `${name}, in the multi-selection` : name}
      aria-pressed={isSelected}
      onClick={(event) => {
        activate(event.shiftKey);
      }}
      onDoubleClick={() => {
        goInside(id);
      }}
      onPointerEnter={showAtPointer}
      onPointerMove={showAtPointer}
      onPointerLeave={() => {
        hide(id);
      }}
      onFocus={showOnKeyboardFocus}
      onBlur={() => {
        hide(id);
      }}
      onKeyDown={onKeyDown}
    >
      {children}
    </g>
  );
}
