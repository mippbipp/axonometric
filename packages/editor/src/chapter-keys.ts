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
 * while something else owns → and ←, such as a selected structure that they
 * take inside and out of; ] and [ keep working. Keys typed into a field, or
 * pressed with a modifier, are left alone.
 */
export const useChapterKeys = (arrows: boolean) => {
  const { next: nextChapter, back: previousChapter } = useWalkthrough();

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
