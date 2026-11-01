import { useEffect, useEffectEvent } from "react";

import { isTyping } from "./chapter-keys.ts";
import { useSelection } from "./selection-context.ts";

/**
 * Keys for the selected structure: → goes inside it, and ← or Escape come
 * out of the inside view, or clear the selection when it's not open. Pair
 * it with `useChapterKeys(selected === null)`, so → and ← change chapter
 * only when nothing is selected.
 *
 * Escape first empties the multi-selection, and a second press clears the
 * selection. While the multi-selection can be nudged (`nudging`), the arrow
 * keys are the nudge's and go unhandled here.
 */
export const useSelectionKeys = (nudging: boolean) => {
  const { selected, inside, marked, select, goInside, comeOut, clearMarked } =
    useSelection();

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (
      event.defaultPrevented ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      isTyping(event.target)
    ) {
      return;
    }

    if (event.key === "Escape" && marked.size > 0) {
      event.preventDefault();
      clearMarked();

      return;
    }

    if (selected === null || (nudging && event.key.startsWith("Arrow"))) {
      return;
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();

      if (inside === null) {
        goInside(selected);
      }
    } else if (event.key === "ArrowLeft" || event.key === "Escape") {
      event.preventDefault();

      if (inside === null) {
        select(null);
      } else {
        comeOut();
      }
    }
  });

  useEffect(() => {
    globalThis.addEventListener("keydown", onKeyDown);

    return () => {
      globalThis.removeEventListener("keydown", onKeyDown);
    };
  }, []);
};
