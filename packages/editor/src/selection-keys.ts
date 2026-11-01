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
 * selection. The arrow keys are handled only when `arrows` is true, which
 * is when this is their owner (see `useArrowOwner`).
 */
export const useSelectionKeys = (arrows: boolean) => {
  const {
    selected,
    inside,
    multiSelection,
    select,
    goInside,
    comeOut,
    clearMultiSelection,
  } = useSelection();

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

    if (event.key === "Escape" && multiSelection.size > 0) {
      event.preventDefault();
      clearMultiSelection();

      return;
    }

    if (selected === null || (!arrows && event.key.startsWith("Arrow"))) {
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
