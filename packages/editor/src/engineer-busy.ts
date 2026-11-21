import { canvasDragging } from "@axonometric/ui/lib/canvas-drag";

import { isTyping } from "./chapter-keys.ts";

/**
 * Why a view tool must wait for the engineer, or `undefined` when it can go
 * ahead. The first that applies wins: a drag in progress, an open dialog,
 * then typing in a field.
 */
export const busyReasonOf = (): string | undefined => {
  if (canvasDragging()) {
    return "The engineer is dragging on the map. Try again when they let go.";
  }

  if (
    document.querySelector(
      '[role="dialog"][data-open], [role="alertdialog"][data-open]'
    ) !== null
  ) {
    return "A dialog is open on the engineer's page. Try again when they close it.";
  }

  return isTyping(document.activeElement)
    ? "The engineer is typing in a field. Try again when they're done."
    : undefined;
};
