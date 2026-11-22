import { useShortcut } from "@axonometric/ui/lib/shortcuts";

import { useEditing } from "./editing-context.ts";
import { isTyping } from "./engineer-busy.ts";

/**
 * Ctrl or Cmd+Z undoes, and Ctrl or Cmd+Shift+Z or Ctrl+Y redoes, while the
 * page can edit, on every platform. Keys typed into a field are left alone,
 * so a field keeps its own undo. Alt and an arrow key nudge structures in
 * `LayoutEditor`.
 */
export const useEditKeys = () => {
  const editing = useEditing();
  const options = {
    repeat: true,
    when: () => editing?.canEdit === true && !isTyping(document.activeElement),
  };
  const undo = () => editing?.undo();
  const redo = () => editing?.redo();

  useShortcut("ctrl+z", undo, options);
  useShortcut("meta+z", undo, options);
  useShortcut("ctrl+shift+z", redo, options);
  useShortcut("meta+shift+z", redo, options);
  useShortcut("ctrl+y", redo, options);
};
