import { useEffect, useEffectEvent } from "react";

import { isTyping } from "./chapter-keys.ts";
import { useSelection } from "./selection-context.ts";

/**
 * Keys for the selected structure: → goes inside it, and ← or Escape come
 * out of the inside view, or clear the selection when it's not open. Pair
 * it with `useChapterKeys(selected === null)`, so → and ← change chapter
 * only when nothing is selected.
 */
export const useSelectionKeys = () => {
  const { selected, inside, select, goInside, comeOut } = useSelection();

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (
      selected === null ||
      event.defaultPrevented ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      isTyping(event.target)
    ) {
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
