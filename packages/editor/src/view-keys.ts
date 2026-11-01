import { useEffect, useEffectEvent } from "react";

import { isTyping } from "./chapter-keys.ts";

/** The key that switches between the iso view and Plan view. */
export const viewKey = "v";

/**
 * Switches between the views with `v`. Keys typed into a field, or pressed
 * with a modifier, are left alone.
 */
export const useViewKey = (toggle: () => void) => {
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (
      event.defaultPrevented ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      isTyping(event.target) ||
      event.key.toLowerCase() !== viewKey
    ) {
      return;
    }

    event.preventDefault();
    toggle();
  });

  useEffect(() => {
    globalThis.addEventListener("keydown", onKeyDown);

    return () => {
      globalThis.removeEventListener("keydown", onKeyDown);
    };
  }, []);
};
