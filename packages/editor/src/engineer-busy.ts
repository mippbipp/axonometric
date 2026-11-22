import { canvasDragging } from "@axonometric/ui/lib/canvas-drag";

/** Whether `target` takes typed text, so a plain key there is typing. */
export const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement);

/** Whether a dialog is open on the page, which pauses the page's keys. */
export const dialogOpen = () =>
  document.querySelector(
    '[role="dialog"][data-open], [role="alertdialog"][data-open]'
  ) !== null;

/**
 * Why a view tool must wait for the engineer, or `undefined` when it can go
 * ahead. The first that applies wins: a drag in progress, an open dialog,
 * then typing in a field.
 */
export const busyReasonOf = (): string | undefined => {
  if (canvasDragging()) {
    return "The engineer is dragging on the map. Try again when they let go.";
  }

  if (dialogOpen()) {
    return "A dialog is open on the engineer's page. Try again when they close it.";
  }

  return isTyping(document.activeElement)
    ? "The engineer is typing in a field. Try again when they're done."
    : undefined;
};
