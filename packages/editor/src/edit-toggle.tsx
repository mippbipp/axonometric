import { Toggle } from "@axonometric/ui/components/toggle";
import { WithTooltip } from "@axonometric/ui/components/tooltip";

import { uiControlClass } from "./control-class.ts";
import { useEditSwitch } from "./edit-context.ts";
import { editKey, useSwitchEdit } from "./edit-toggle-key.ts";

/**
 * The header's Edit button, pressed while Edit is on. Only a page that can
 * edit has it. It is off at first and stays as the browser left it.
 */
export function EditToggle() {
  const edit = useEditSwitch();
  const switchEdit = useSwitchEdit();

  if (edit === null) {
    return null;
  }

  return (
    <WithTooltip
      control={
        <Toggle
          className={uiControlClass}
          data-edit-toggle=""
          onPressedChange={switchEdit}
          pressed={edit.on}
        >
          Edit
        </Toggle>
      }
    >
      {edit.on ? `Stop editing (${editKey})` : `Edit the map (${editKey})`}
    </WithTooltip>
  );
}
