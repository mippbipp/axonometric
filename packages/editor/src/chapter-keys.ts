import { useEffect, useEffectEvent } from "react";

import { useWalkthrough } from "./walkthrough.tsx";

/** Keys that move to the next and the previous chapter. */
const nextKeys = new Set(["ArrowRight", "]"]);

const backKeys = new Set(["ArrowLeft", "["]);

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement);

/**
 * Moves between chapters with → and ←, or ] and [. Pass `enabled: false`
 * while something else owns those keys, such as a selected structure that →
 * and ← take inside and out of. Keys typed into a field, or pressed with a
 * modifier, are left alone.
 */
export const useChapterKeys = (enabled: boolean) => {
  const { next, back } = useWalkthrough();

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (
      !enabled ||
      event.defaultPrevented ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      isTyping(event.target)
    ) {
      return;
    }

    if (nextKeys.has(event.key)) {
      event.preventDefault();
      next();
    } else if (backKeys.has(event.key)) {
      event.preventDefault();
      back();
    }
  });

  useEffect(() => {
    globalThis.addEventListener("keydown", onKeyDown);

    return () => {
      globalThis.removeEventListener("keydown", onKeyDown);
    };
  }, []);
};
