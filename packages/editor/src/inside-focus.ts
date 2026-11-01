import { useLayoutEffect, useRef } from "react";

/**
 * Moves keyboard focus across the swap between the map and an inside view.
 * Going inside focuses the breadcrumb's Come out button. Coming out focuses
 * the structure that was open, which stays selected.
 */
export const useInsideFocus = (inside: string | null) => {
  const previous = useRef(inside);

  useLayoutEffect(() => {
    const was = previous.current;

    previous.current = inside;

    if (inside !== null && was !== inside) {
      document
        .querySelector<HTMLElement>(
          '[data-breadcrumb] [data-control="come-out"]'
        )
        ?.focus();
    } else if (inside === null && was !== null) {
      document
        .querySelector<SVGElement>(`[data-structure="${CSS.escape(was)}"]`)
        ?.focus();
    }
  }, [inside]);
};
