import { useEffect, useEffectEvent } from "react";

import { isTyping } from "./chapter-keys.ts";
import { useSelection } from "./selection-context.ts";

/**
 * Escape empties the multi-selection, else clears the selected hop, else
 * comes out of the inside view or clears the selection. In the inside view
 * ← comes out too. Pair it with `useChapterKeys(inside === null)`, so ←
 * doesn't also change chapter there.
 */
export const useSelectionKeys = () => {
  const {
    clearMultiSelection,
    comeOut,
    inside,
    multiSelection,
    select,
    selected,
    selectedHop,
    selectHop,
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

    if (event.key === "Escape" && selectedHop !== null) {
      event.preventDefault();
      selectHop(null);

      return;
    }

    if (selected === null) {
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();

      if (inside === null) {
        select(null);
      } else {
        comeOut();
      }
    } else if (event.key === "ArrowLeft" && inside !== null) {
      event.preventDefault();
      comeOut();
    }
  });

  useEffect(() => {
    globalThis.addEventListener("keydown", onKeyDown);

    return () => {
      globalThis.removeEventListener("keydown", onKeyDown);
    };
  }, []);
};
