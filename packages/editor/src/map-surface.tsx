import { useEffect, useEffectEvent, useRef } from "react";
import type { ReactNode } from "react";

import { useSelection } from "./selection-context.ts";

/**
 * The area around a view. A click that lands on nothing, not a structure, a
 * packet or a control, clears the selection. The inside view ignores such
 * clicks, so a stray one doesn't close it. A pan that ends over empty space
 * doesn't count, because the viewport swallows the click that ends a drag.
 *
 * Clicking empty space is only a mouse shortcut. Escape clears the selection
 * from the keyboard. So the listener goes on the element directly, and the
 * area itself doesn't become interactive.
 */
export function MapSurface({ children }: { readonly children: ReactNode }) {
  const { inside, select } = useSelection();
  const ref = useRef<HTMLDivElement>(null);

  const onClick = useEffectEvent((event: MouseEvent) => {
    if (
      inside === null &&
      event.target instanceof Element &&
      event.target.closest("button, [role='button'], a, input") === null
    ) {
      select(null);
    }
  });

  useEffect(() => {
    const element = ref.current;

    element?.addEventListener("click", onClick);

    return () => {
      element?.removeEventListener("click", onClick);
    };
  }, []);

  return (
    <div
      ref={ref}
      data-map-surface
      className="relative min-w-0 flex-1 overflow-hidden"
    >
      {children}
    </div>
  );
}
