import { bindCanvasDrag, markDragging } from "@axonometric/ui/lib/canvas-drag";
import {
  connectMessage,
  createConnect,
  definePrimitive,
  live,
  type ConnectDraft,
  type ConnectMessage,
  type ConnectReason,
} from "@ui-sdk/core";
import { usePart, usePrimitive, type PartProps } from "@ui-sdk/react/primitive";

/** A point in the caller's units, such as on the ground. */
interface ConnectPoint {
  readonly x: number;
  readonly y: number;
}

interface ConnectPortsOptions {
  /** Whether a connection can go from port `from` to port `to`. */
  readonly canConnect?: (from: string, to: string) => boolean;
  readonly disabled?: boolean;
  /** A port's name for screen readers. */
  readonly label?: (key: string) => string;
  /**
   * What screen readers hear, by step. A pointer drag announces only the
   * connection, since saying each port it passes over would be noise.
   */
  readonly message?: (
    message: ConnectMessage,
    label: (key: string) => string
  ) => string;
  /** Makes the connection and returns whether it went through. */
  readonly onConnect: (
    from: string,
    to: string,
    details: { readonly event?: Event; readonly reason: ConnectReason }
  ) => boolean;
  /** Hears the draft each time it changes, and `null` when it ends. */
  readonly onDraft?: (draft: ConnectDraft | null) => void;
  /** The point in the caller's units under a window point, through `el`. */
  readonly point: (
    el: Element,
    at: { readonly clientX: number; readonly clientY: number }
  ) => ConnectPoint | undefined;
  /**
   * The port the start key starts from when `target` has focus, or `null`
   * when the key does nothing there.
   */
  readonly sourceOf: (target: Element) => string | null;
  /** The key that starts a connection from the keyboard, in lower case. */
  readonly startKey: string;
  /** The port a pointer at `at` would connect `from` to, however far away. */
  readonly targetAt: (at: ConnectPoint, from: string) => string | null;
}

interface ConnectPortsState {
  readonly connecting: ConnectDraft | null;
}

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT");

const sameDraft = (a: ConnectDraft | null, b: ConnectDraft) =>
  a !== null &&
  a.from === b.from &&
  a.to === b.to &&
  a.x === b.x &&
  a.y === b.y &&
  a.keyboard === b.keyboard;

const connectPorts = definePrimitive({
  api: (context) => {
    const { store } = context;
    const options = () => context.options();
    let stop: (() => void) | undefined;
    let releaseBusy: (() => void) | undefined;

    const pointAt = (at: {
      readonly clientX: number;
      readonly clientY: number;
    }) => {
      const root = context.element("root");

      return root === undefined ? undefined : options().point(root, at);
    };

    const can = (from: string, to: string) =>
      from !== to && (options().canConnect?.(from, to) ?? true);

    const connect = createConnect<ConnectPortsState>(context, {
      canConnect: can,
      connect: (from, to, details) => options().onConnect(from, to, details),
      draft: "connecting",
      label: (key) => options().label?.(key) ?? key,
      message: (message, label) =>
        message.type === "target" && store.get().connecting?.keyboard !== true
          ? ""
          : (options().message ?? connectMessage)(message, label),
      point: (x, y) => pointAt({ clientX: x, clientY: y }) ?? { x, y },
      slot: "port",
    });

    const draftTo = (next: ConnectDraft) => {
      if (!sameDraft(store.get().connecting, next)) {
        store.set({ connecting: next });
      }
    };

    // createConnect's pointerdown snaps only to a port within a radius of
    // the pointer, so it can't take a drop anywhere on a node. The drag goes
    // through bindCanvasDrag, and the drop through target and commit. Move
    // back once it can drop on a node: https://github.com/vercel-labs/ui/issues/960
    const press = (event: PointerEvent, from: string) => {
      const root = context.element("root");

      if (
        event.button !== 0 ||
        event.shiftKey ||
        options().disabled === true ||
        root === undefined
      ) {
        return;
      }

      event.stopPropagation();
      stop?.();

      const follow = (at: {
        readonly clientX: number;
        readonly clientY: number;
      }) => {
        const point = pointAt(at);

        if (point !== undefined) {
          const to = options().targetAt(point, from);

          draftTo({
            from,
            keyboard: false,
            to: to !== null && can(from, to) ? to : null,
            ...point,
          });
        }
      };

      const unbind = bindCanvasDrag(root, event, {
        onEnd: ({ canceled }) => {
          stop = undefined;

          if (canceled) {
            connect.cancel();

            return;
          }

          const to = store.get().connecting?.to ?? null;

          if (to !== null) {
            connect.target(to);
          }

          connect.commit({ reason: "drag" });
        },
        onMove: follow,
        onStart: () => {
          follow(event);
        },
      });

      stop = () => {
        unbind();
        stop = undefined;
        connect.cancel();
      };
    };

    const keydown = (event: KeyboardEvent) => {
      const current = store.get().connecting;

      if (current !== null) {
        if (!current.keyboard) {
          return;
        }

        if (connect.keydown(event) && event.key !== "Tab") {
          event.stopPropagation();
        }

        return;
      }

      if (
        // oxlint-disable-next-line effecttsgo/prefer-effect-string -- the ui package doesn't depend on effect.
        event.key.toLowerCase() !== options().startKey ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.repeat ||
        event.defaultPrevented ||
        options().disabled === true ||
        isTyping(event.target) ||
        !(event.target instanceof Element)
      ) {
        return;
      }

      const from = options().sourceOf(event.target);

      if (from !== null && connect.start(from)) {
        event.preventDefault();
      }
    };

    const pointerdown = () => {
      if (store.get().connecting?.keyboard === true) {
        connect.cancel();
      }
    };

    // On the document in the capture phase, so while a hop is drawn from the
    // keyboard its keys reach nothing else: not the focused item's own
    // arrows, nor the page's.
    const listen = (el: HTMLElement) => {
      const doc = el.ownerDocument;

      doc.addEventListener("keydown", keydown, true);
      doc.addEventListener("pointerdown", pointerdown, true);

      return () => {
        doc.removeEventListener("keydown", keydown, true);
        doc.removeEventListener("pointerdown", pointerdown, true);
      };
    };

    let sent: ConnectDraft | null = null;

    context.onDestroy(
      store.subscribe(() => {
        const { connecting } = store.get();

        // bindCanvasDrag counts a pointer drag; a keyboard draft counts here.
        if (connecting?.keyboard === true) {
          releaseBusy ??= markDragging();
        } else {
          releaseBusy?.();
          releaseBusy = undefined;
        }

        if (connecting !== sent) {
          sent = connecting;
          options().onDraft?.(connecting);
        }
      })
    );

    context.onOptions((next) => {
      if (next.disabled === true) {
        stop?.();
        connect.cancel();
      }
    });

    context.onDestroy(() => {
      stop?.();
      connect.cancel();
      releaseBusy?.();
      releaseBusy = undefined;

      if (sent !== null) {
        sent = null;
        options().onDraft?.(null);
      }
    });

    return { connect, listen, press };
  },
  live: ["connecting"],
  name: "connect-ports",
  options: {
    canConnect: "value",
    disabled: "boolean",
    label: "value",
    message: "value",
    onConnect: "action",
    onDraft: "callback",
    point: "value",
    sourceOf: "value",
    startKey: "string",
    targetAt: "value",
  },
  slots: (slot) => ({
    port: slot<{ value: string }>({
      attrs: () => ({ "aria-hidden": "true" }),
      live: live((state, { api, key }) => ({
        "data-connect": api.connect.role(state, key),
      })),
      on: {
        pointerdown: (event, { api, key }) => {
          api.press(event, key);
        },
      },
      props: { value: "string" },
    }),
    root: slot({
      bind: (el, { api }) => api.listen(el),
      live: live((state) => ({
        "data-connecting":
          state.connecting === null
            ? undefined
            : state.connecting.keyboard
              ? "keyboard"
              : "pointer",
      })),
    }),
  }),
  state: (_options: ConnectPortsOptions): ConnectPortsState => ({
    connecting: null,
  }),
});

/**
 * Draws connections between the `ConnectPort`s it wraps. Dragging a port
 * 3 px starts one, and `targetAt` says which port the pointer is over, so a
 * drop can land anywhere the caller likes; Escape lets go. With an element
 * `sourceOf` knows focused, `startKey` starts one from that element's port,
 * the arrows pick the nearest port in their direction, Enter connects, and
 * Escape or Tab lets go. Each step is announced. `onDraft` hears the draft
 * as it changes, in the units `point` gives. While a connection is drawn,
 * `canvasDragging()` is true.
 */
function ConnectPorts({
  canConnect,
  disabled,
  label,
  message,
  onConnect,
  onDraft,
  point,
  sourceOf,
  startKey,
  targetAt,
  ...props
}: ConnectPortsOptions & PartProps<"g">) {
  const handle = usePrimitive(connectPorts, {
    canConnect,
    disabled,
    label,
    message,
    onConnect,
    onDraft,
    point,
    sourceOf,
    startKey,
    targetAt,
  });

  return usePart(handle, "root", {}, props, "g");
}

/**
 * One port, a `<circle>` hidden from screen readers, which hear the ports
 * through the announcements. `data-connect` says its part in the
 * connection being drawn: `source`, `target` or `candidate`.
 */
function ConnectPort({
  value,
  ...props
}: { readonly value: string } & PartProps<"circle">) {
  return usePart(connectPorts, "port", { value }, props, "circle");
}

export { ConnectPort, ConnectPorts };
export type { ConnectPoint, ConnectPortsOptions };
export type { ConnectDraft, ConnectMessage } from "@ui-sdk/core";
