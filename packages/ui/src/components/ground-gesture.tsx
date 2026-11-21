import type { GroundPoint } from "@axonometric/ui/components/ground-drag";
import { bindCanvasDrag } from "@axonometric/ui/lib/canvas-drag";
import { definePrimitive } from "@ui-sdk/core";
import { usePart, usePrimitive, type PartProps } from "@ui-sdk/react/primitive";

/** A press that moved past the threshold: what it started, and its span. */
interface GroundStroke<T> {
  /** Where the press landed, on the ground. */
  readonly from: GroundPoint;
  /** What `starts` returned for the press. */
  readonly payload: T;
  /** Where the pointer is now, on the ground. */
  readonly to: GroundPoint;
}

interface GroundGestureOptions<T = unknown> {
  readonly disabled?: boolean;
  /** The ground point under a window point, through `el`'s transform. */
  readonly groundAt: (
    el: Element,
    at: { readonly clientX: number; readonly clientY: number }
  ) => GroundPoint | undefined;
  /** One call per release. A canceled stroke commits nothing. */
  readonly onCommit: (stroke: GroundStroke<T>) => void;
  /** Hears the stroke each time it changes, and `null` when it ends. */
  readonly onDraft?: (stroke: GroundStroke<T> | null) => void;
  /**
   * The click of a press `starts` took that never passed the threshold. The
   * click goes no further than this.
   */
  readonly onPress?: (payload: T, event: MouseEvent) => void;
  /** What a press anywhere on the canvas starts, or nothing. */
  readonly starts: (event: PointerEvent) => T | undefined;
}

interface GroundGestureState {
  readonly stroke: GroundStroke<unknown> | null;
}

/**
 * The svg the root is drawn in, which every press on the canvas reaches.
 * ui-sdk types a part's element as an HTMLElement, even an SVG one:
 * https://github.com/vercel-labs/ui/issues/959
 */
const canvasOf = (el: HTMLElement) =>
  (el instanceof SVGElement ? (el.ownerSVGElement ?? el) : el) as HTMLElement;

const groundGesture = definePrimitive({
  api: (context) => {
    const { store } = context;
    const options = () => context.options();
    let stop: (() => void) | undefined;
    // The press `starts` took, until its click or the next press.
    let pressed:
      | { readonly payload: unknown; readonly target: EventTarget | null }
      | undefined;

    const pointerdown = (event: PointerEvent) => {
      pressed = undefined;

      const root = context.element("root");

      if (
        event.button !== 0 ||
        options().disabled === true ||
        root === undefined
      ) {
        return;
      }

      const payload = options().starts(event);
      const from =
        payload === undefined ? undefined : options().groundAt(root, event);

      if (from === undefined) {
        return;
      }

      stop?.();
      pressed = { payload, target: event.target };

      const unbind = bindCanvasDrag(canvasOf(root), event, {
        onEnd: ({ canceled }) => {
          const { stroke } = store.get();

          stop = undefined;
          store.set({ stroke: null });

          if (!canceled && stroke !== null) {
            options().onCommit(stroke);
          }
        },
        onMove: (at) => {
          const to = options().groundAt(root, at);

          if (to !== undefined) {
            store.set({ stroke: { from, payload, to } });
          }
        },
        onStart: () => {
          pressed = undefined;
        },
      });

      stop = () => {
        unbind();
        stop = undefined;
        store.set({ stroke: null });
      };
    };

    // In the capture phase, so the click is handled before listeners above
    // the canvas that treat a click on no control as a click on nothing.
    const click = (event: MouseEvent) => {
      const press = pressed;
      const { onPress } = options();

      pressed = undefined;

      if (
        press === undefined ||
        onPress === undefined ||
        !(press.target instanceof Node) ||
        !(event.target instanceof Node) ||
        !press.target.contains(event.target)
      ) {
        return;
      }

      event.stopPropagation();
      event.preventDefault();
      onPress(press.payload, event);
    };

    const listen = (el: HTMLElement) => {
      const canvas = canvasOf(el);

      canvas.addEventListener("pointerdown", pointerdown);
      canvas.addEventListener("click", click, { capture: true });

      return () => {
        canvas.removeEventListener("pointerdown", pointerdown);
        canvas.removeEventListener("click", click, { capture: true });
        stop?.();
      };
    };

    let sent: GroundStroke<unknown> | null = null;

    context.onDestroy(
      store.subscribe(() => {
        const { stroke } = store.get();

        if (stroke !== sent) {
          sent = stroke;
          options().onDraft?.(stroke);
        }
      })
    );
    context.onOptions((next) => {
      if (next.disabled === true) {
        stop?.();
      }
    });
    context.onDestroy(() => stop?.());

    return { listen };
  },
  live: ["stroke"],
  name: "ground-gesture",
  options: {
    disabled: "boolean",
    groundAt: "value",
    onCommit: "callback",
    onDraft: "callback",
    onPress: "callback",
    starts: "value",
  },
  slots: (slot) => ({
    root: slot({
      bind: (el, { api }) => api.listen(el),
    }),
  }),
  state: (_options: GroundGestureOptions): GroundGestureState => ({
    stroke: null,
  }),
});

/**
 * A press on the canvas that follows the pointer along the ground, in any
 * projection, for what it wraps inside a canvas's world. `starts` decides
 * which presses start one, and what they carry. Once a press moves 3 px,
 * `onDraft` hears the stroke as it changes, and letting go is one
 * `onCommit`; Escape lets go and commits nothing. A press that never moves
 * 3 px stays a click, which `onPress` takes.
 */
function GroundGesture<T>({
  disabled,
  groundAt,
  onCommit,
  onDraft,
  onPress,
  starts,
  ...props
}: GroundGestureOptions<T> & PartProps<"g">) {
  // The primitive carries the payload as `unknown`; it only hands back what
  // `starts` gave it.
  const handle = usePrimitive(groundGesture, {
    disabled,
    groundAt,
    onCommit: onCommit as GroundGestureOptions["onCommit"],
    onDraft: onDraft as GroundGestureOptions["onDraft"],
    onPress: onPress as GroundGestureOptions["onPress"],
    starts,
  });

  return usePart(handle, "root", {}, props, "g");
}

export { GroundGesture };
export type { GroundGestureOptions, GroundStroke };
