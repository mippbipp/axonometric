import { cn } from "@axonometric/ui/lib/utils";

import { controlClass } from "./control-class.ts";
import { useEditMode } from "./edit-mode-context.ts";
import { editKey, useSwitchEdit } from "./edit-toggle-key.ts";

/**
 * The header's Edit button, pressed while Edit is on. Only a page that can
 * edit has it. It is off at first and stays as the browser left it.
 */
export function EditToggle() {
  const mode = useEditMode();
  const switchEdit = useSwitchEdit();

  if (mode === null) {
    return null;
  }

  return (
    <button
      type="button"
      data-edit-toggle=""
      aria-pressed={mode.on}
      title={
        mode.on ? `Stop editing (${editKey})` : `Edit the map (${editKey})`
      }
      className={cn(controlClass, mode.on && "bg-ink text-paper")}
      onClick={() => {
        switchEdit(!mode.on);
      }}
    >
      Edit
    </button>
  );
}
