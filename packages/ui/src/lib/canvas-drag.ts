// oxlint-disable effecttsgo/missing-pipeable-signature -- called with its arguments in hand from a pointerdown handler, never piped.
import { bindDrag, dragThreshold } from "@ui-sdk/core";

/**
 * How far a press moves, along either axis, in pixels, before it is a drag:
 * ui-sdk's, so every canvas drag starts at the same point.
 */
export { dragThreshold } from "@ui-sdk/core";

const drags = { open: 0 };

/** Whether a canvas drag is in progress, past its threshold. */
export const canvasDragging = () => drags.open > 0;

/**
 * Counts one drag in progress until the returned function is called, which
 * is safe to call twice. `bindCanvasDrag` calls it for every canvas drag, so
 * a page tool can refuse while the engineer is mid-drag. A drag that doesn't
 * use `bindCanvasDrag` calls it once. A counter, not a flag, so overlapping
 * sources (a drag and a page state that shows one) don't release each other.
 */
export const markDragging = () => {
  let held = true;

  drags.open += 1;

  return () => {
    if (held) {
      held = false;
      drags.open -= 1;
    }
  };
};

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
  let release: (() => void) | undefined;
  const letGo = () => {
    release?.();
    release = undefined;
  };

  const stop = bindDrag(
    // bindDrag only uses pointer capture and ownerDocument, which SVG
    // elements have, but types the element as HTMLElement.
    // https://github.com/vercel-labs/ui/issues/959
    el as HTMLElement,
    down,
    {
      cancelOnEscape: true,
      onEnd: (_event, canceled) => {
        letGo();
        onEnd({ canceled });
      },
      onMove: ({ x, y }) => {
        onMove({ clientX: x, clientY: y });
      },
      onStart: () => {
        release ??= markDragging();
        onStart?.();
      },
      threshold: dragThreshold,
    }
  );

  return () => {
    stop();
    letGo();
  };
}
