import { useEffect, useEffectEvent } from "react";

import { isTyping } from "./chapter-keys.ts";
import { useEditMode } from "./edit-mode-context.ts";
import { useHopDraft } from "./hop-draft-context.ts";
import { useNewGroupForm } from "./new-group-context.ts";
import { useNoteTool } from "./note-tool-context.ts";
import { usePlacing } from "./place-context.ts";
import { useSelection } from "./selection-context.ts";

/** The key that turns Edit on and off. */
export const editKey = "e";

/**
 * Turns Edit on or off. Turning it off also closes what editing had open: the
 * add and group forms, a hop being drawn, the armed Note tool and the
 * multi-selection, so none of them is left without its controls.
 */
export const useSwitchEdit = () => {
  const mode = useEditMode();
  const placing = usePlacing();
  const newGroup = useNewGroupForm();
  const drafting = useHopDraft();
  const tool = useNoteTool();
  const { clearMultiSelection } = useSelection();

  return (on: boolean) => {
    if (!on) {
      placing?.setOpen(false);
      newGroup?.setOpen(false);
      drafting?.cancel();
      drafting?.stretchTo(null);
      tool?.arm(false);
      clearMultiSelection();
    }

    mode?.set(on);
  };
};

/**
 * Switches Edit with `e`. Keys typed into a field, or pressed with a
 * modifier, are left alone.
 */
export const useEditToggleKey = () => {
  const mode = useEditMode();
  const switchEdit = useSwitchEdit();

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (
      mode === null ||
      event.defaultPrevented ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      isTyping(event.target) ||
      event.key.toLowerCase() !== editKey
    ) {
      return;
    }

    event.preventDefault();
    switchEdit(!mode.on);
  });

  useEffect(() => {
    globalThis.addEventListener("keydown", onKeyDown);

    return () => {
      globalThis.removeEventListener("keydown", onKeyDown);
    };
  }, []);
};
