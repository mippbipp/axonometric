import type { MouseEvent, ReactNode } from "react";

import { useSelection } from "./selection-context.ts";

/**
 * The area around a view. A click that lands on nothing, not a structure, a
 * packet or a control, clears the selection. The inside view ignores such
 * clicks, so a stray one doesn't close it. A pan that ends over empty
 * space doesn't count: the viewport swallows the click that ends a drag.
 */
export function MapSurface({ children }: { readonly children: ReactNode }) {
  const { inside, select } = useSelection();

  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    if (
      inside === null &&
      event.target instanceof Element &&
      event.target.closest("button, [role='button'], a, input") === null
    ) {
      select(null);
    }
  };

  return (
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- clicking empty space is a mouse shortcut; Escape clears the selection from the keyboard.
    <div data-map-surface className="relative min-w-0 flex-1" onClick={onClick}>
      {children}
    </div>
  );
}
