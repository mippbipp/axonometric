import type { FocusEvent, KeyboardEvent, PointerEvent, SVGProps } from "react";

import { useSelection } from "./selection-context.ts";
import { useStructuresById } from "./structures.ts";
import { useTooltipActions } from "./tooltip-context.ts";

/**
 * The `<g>` that draws structure `id` in a view, with `data-structure` and
 * `data-selected` on it. Hover and keyboard focus show the tooltip, a click
 * pins the structure, a double-click goes inside it, and Enter or Space pin
 * it from the keyboard.
 *
 * Clicks are plain `onClick`, with no pointer capture, so a pan-and-zoom
 * wrapper that leaves presses on `[data-structure]` alone can't swallow
 * them. Pass the drawing as `children` and any other attributes as props.
 */
export function StructureTarget({
  id,
  children,
  ...rest
}: SVGProps<SVGGElement> & { readonly id: string }) {
  const { selected, select, goInside } = useSelection();
  const { show, hide } = useTooltipActions();
  const name = useStructuresById().get(id)?.name ?? id;
  const isSelected = selected === id;

  const showAtPointer = (event: PointerEvent) => {
    show({ id, x: event.clientX, y: event.clientY });
  };

  const showOnKeyboardFocus = (event: FocusEvent<SVGGElement>) => {
    if (event.currentTarget.matches(":focus-visible")) {
      const box = event.currentTarget.getBoundingClientRect();

      show({ id, x: box.right, y: box.top });
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      select(id);
    }
  };

  return (
    <g
      {...rest}
      data-structure={id}
      data-selected={isSelected}
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- SVG has no <button> element, so the structure's group takes the button role.
      role="button"
      tabIndex={0}
      aria-label={name}
      aria-pressed={isSelected}
      onClick={() => {
        select(id);
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
