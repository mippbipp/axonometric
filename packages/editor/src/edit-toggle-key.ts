import { useEffect, useEffectEvent } from "react";

import { isTyping } from "./chapter-keys.ts";
import { useEditSwitch } from "./edit-context.ts";
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
  const edit = useEditSwitch();
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
      tool?.arm(false);
      clearMultiSelection();
    }

    edit?.set(on);
  };
};

/**
 * Switches Edit with `e`. Keys typed into a field, or pressed with a
 * modifier, are left alone.
 */
export const useEditToggleKey = () => {
  const edit = useEditSwitch();
  const switchEdit = useSwitchEdit();

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (
      edit === null ||
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
    switchEdit(!edit.on);
  });

  useEffect(() => {
    globalThis.addEventListener("keydown", onKeyDown);

    return () => {
      globalThis.removeEventListener("keydown", onKeyDown);
    };
  }, []);
};
