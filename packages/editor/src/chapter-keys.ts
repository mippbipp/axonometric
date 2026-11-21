import { useEffect, useEffectEvent } from "react";

import { useWalkthrough } from "./walkthrough-context.ts";

/** Keys that move to the next and the previous chapter. */
const nextKeys = new Set(["ArrowRight", "]"]);

const backKeys = new Set(["ArrowLeft", "["]);

const arrowKeys = new Set(["ArrowRight", "ArrowLeft"]);

export const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement);

/**
 * Moves between chapters with → and ←, or ] and [. Pass `arrows: false`
 * while something else owns → and ←, such as the inside view, where ← comes
 * out; ] and [ keep working. The map's items take the arrows while they have
 * focus, so → and ← change chapter only with focus outside the map. Keys
 * typed into a field, or pressed with a modifier, are left alone.
 */
export const useChapterKeys = (arrows: boolean) => {
  const { back: previousChapter, next: nextChapter } = useWalkthrough();

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

    if (!arrows && arrowKeys.has(event.key)) {
      return;
    }

    if (nextKeys.has(event.key)) {
      event.preventDefault();
      nextChapter();
    } else if (backKeys.has(event.key)) {
      event.preventDefault();
      previousChapter();
    }
  });

  useEffect(() => {
    globalThis.addEventListener("keydown", onKeyDown);

    return () => {
      globalThis.removeEventListener("keydown", onKeyDown);
    };
  }, []);
};
