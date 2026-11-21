// oxlint-disable effecttsgo/missing-pipeable-signature -- called with its arguments in hand from a pointerdown handler, never piped.
import { bindDrag, dragThreshold } from "@ui-sdk/core";

interface CanvasDragHandlers {
  /** The pointer lifted, or Escape or the browser canceled the drag. */
  readonly onEnd: (end: { readonly canceled: boolean }) => void;
  /** At most once per frame, with the pointer's window position. */
  readonly onMove: (position: {
    readonly clientX: number;
    readonly clientY: number;
  }) => void;
  /** Runs once, on the first move past the threshold. */
  readonly onStart?: () => void;
}

/**
 * Follows the press `down` on `el` as a drag: moves wait for ui-sdk's drag
 * threshold, Escape cancels, the click after a drag is swallowed, and the
 * pointer is captured. Returns a function that stops it without `onEnd`.
 */
export function bindCanvasDrag(
  el: Element,
  down: PointerEvent,
  { onEnd, onMove, onStart }: CanvasDragHandlers
) {
  return bindDrag(
    // bindDrag only uses pointer capture and ownerDocument, which SVG
    // elements have, but types the element as HTMLElement.
    // https://github.com/vercel-labs/ui/issues/959
    el as HTMLElement,
    down,
    {
      cancelOnEscape: true,
      onEnd: (_event, canceled) => {
        onEnd({ canceled });
      },
      onMove: ({ x, y }) => {
        onMove({ clientX: x, clientY: y });
      },
      onStart: () => {
        onStart?.();
      },
      threshold: dragThreshold,
    }
  );
}
