import { announce } from "@axonometric/ui/lib/announce";
import { useLayoutEffect, useRef } from "react";

/**
 * Moves keyboard focus across the swap between the map and an inside view.
 * Going inside focuses the breadcrumb's Come out button. Coming out focuses
 * the structure that was open, which stays selected. When a chapter change
 * hid that structure and closed the inside view, focus goes to the map's Tab
 * stop, or the map itself, and a screen reader hears it.
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
      const structure = document.querySelector<SVGElement>(
        `[data-structure="${CSS.escape(was)}"]`
      );

      if (structure !== null) {
        structure.focus();

        return;
      }

      const items = document.querySelectorAll<SVGElement>(
        '[data-map-layer] [data-slot="canvas-items-item"]'
      );

      const target =
        [...items].find((item) => item.getAttribute("tabindex") === "0") ??
        items[0] ??
        document.querySelector<HTMLElement>(
          '[data-map-layer] [data-slot="pannable-canvas"]'
        );

      target?.focus();
      announce(
        `The inside view closed because this chapter no longer shows it. Focus moved to ${
          target?.getAttribute("aria-label") ?? "the map"
        }.`
      );
    }
  }, [inside]);
};
