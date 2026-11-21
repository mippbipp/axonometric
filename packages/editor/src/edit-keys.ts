import { useEffect, useEffectEvent } from "react";

import { isTyping } from "./chapter-keys.ts";
import { useEditing } from "./editing-context.ts";

const isUndo = (event: KeyboardEvent) =>
  (event.ctrlKey || event.metaKey) &&
  !event.shiftKey &&
  !event.altKey &&
  event.key.toLowerCase() === "z";

const isRedo = (event: KeyboardEvent) =>
  (event.ctrlKey || event.metaKey) &&
  !event.altKey &&
  ((event.shiftKey && event.key.toLowerCase() === "z") ||
    (event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === "y"));

/**
 * Ctrl or Cmd+Z undoes, and Ctrl or Cmd+Shift+Z or Ctrl+Y redoes, while the
 * page can edit. Keys typed into a field are left alone, so a field keeps
 * its own undo. Alt and an arrow key nudge structures in `LayoutEditor`.
 */
export const useEditKeys = () => {
  const editing = useEditing();

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (
      editing === null ||
      !editing.canEdit ||
      event.defaultPrevented ||
      isTyping(event.target)
    ) {
      return;
    }

    if (isUndo(event)) {
      event.preventDefault();
      editing.undo();

      return;
    }

    if (isRedo(event)) {
      event.preventDefault();
      editing.redo();
    }
  });

  useEffect(() => {
    globalThis.addEventListener("keydown", onKeyDown);

    return () => {
      globalThis.removeEventListener("keydown", onKeyDown);
    };
  }, []);
};
