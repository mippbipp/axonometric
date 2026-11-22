import { usePannableCanvas } from "@axonometric/ui/components/pannable-canvas";
import type { PannableCanvasApi } from "@axonometric/ui/components/pannable-canvas";
import { announce } from "@axonometric/ui/lib/announce";
import {
  createChange,
  createFocusRecovery,
  createRovingFocus,
  createSelection,
  definePrimitive,
  spatialMove,
  type ChangeDetails,
} from "@ui-sdk/core";
import { usePart, usePrimitive, type PartProps } from "@ui-sdk/react/primitive";
import { Array as Arr } from "effect";
import type { FocusEvent, ReactNode } from "react";

type CanvasItemsReason = "item-press";

interface Box {
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
  readonly top: number;
}

interface CanvasItemsOptions {
  /**
   * The canvas the items sit on. `CanvasItems` passes it, so focus that
   * loses its item can be placed by where the item was on the canvas.
   */
  readonly canvas?: PannableCanvasApi;
  /** Whether Shift with a press adds to and takes from the selection. */
  readonly multiple?: boolean;
  readonly onSelectedChange?: (
    value: Array<string>,
    details: ChangeDetails<CanvasItemsReason>
  ) => void;
  /**
   * The item a plain press picked, if any. It holds the Tab stop until focus
   * has been in the group, and the first Shift press into an empty selection
   * keeps it in the selection too.
   */
  readonly pinned?: string | null;
  /** The selected keys. Controlled: pass back what `onSelectedChange` gives. */
  readonly selected: ReadonlyArray<string>;
}

interface CanvasItemsState {
  readonly focused: string | null;
  readonly pinned: string | null;
  readonly selected: Array<string>;
}

interface CanvasItemProps {
  /** Enter without Shift, when it does more than a press. */
  readonly onOpen?: () => void;
  /** A plain press: a click, Space, or Enter when there's no `onOpen`. */
  readonly onPress?: (event?: Event) => void;
  /** Whether Shift presses toggle it in the selection. */
  readonly selectable?: boolean;
  /** The item's key, unique in the group. */
  readonly value: string;
}

const centreOf = (box: Box) => ({
  x: (box.left + box.right) / 2,
  y: (box.top + box.bottom) / 2,
});

const labelOf = (el: Element) => el.getAttribute("aria-label") ?? "the map";

const arrows = new Set(["ArrowDown", "ArrowLeft", "ArrowRight", "ArrowUp"]);

const canvasItems = definePrimitive({
  api: (context) => {
    const { store } = context;
    const change = createChange(context);

    const roving = createRovingFocus<CanvasItemsState, CanvasItemProps>(
      context,
      {
        key: "focused",
        move: spatialMove(),
        preferred: (item) => item.key === store.get().pinned,
        slot: "item",
      }
    );

    // Where the focused item was on the canvas, in canvas units, which a
    // refit doesn't change. An unmounted item can't be measured, so this is
    // noted as focus arrives and again as the item leaves, if it still can.
    let seen: { readonly box: Box; readonly key: string } | null = null;

    const note = (key: string, el: Element) => {
      const { canvas } = context.options();

      if (canvas !== undefined && el.isConnected) {
        seen = { box: canvas.viewport.rectOf(el), key };
      }
    };

    // When the focused item leaves, focus goes to the nearest item still on
    // the map, or the canvas itself with none left, so it never falls to the
    // page. spatialMove needs a direction and this has none, so nearness is
    // the plain distance between centres.
    const recovery = createFocusRecovery<CanvasItemProps>({
      fallback: (lost) => {
        const { canvas } = context.options();

        // A map under an inert layer, such as one an inside view covers,
        // can't take focus, and nothing was lost from the engineer's view.
        if (lost.el.closest("[inert]") !== null) {
          seen = null;

          return null;
        }

        const from = seen?.key === lost.key ? seen.box : null;

        seen = null;

        const left = Arr.filter(roving.items(), (item) => item.el !== lost.el);
        let target: HTMLElement | undefined;

        if (canvas === undefined || from === null) {
          target = left[0]?.el;
        } else {
          const here = centreOf(from);
          let best = Infinity;

          for (const item of left) {
            const there = centreOf(canvas.viewport.rectOf(item.el));
            const distance = Math.hypot(there.x - here.x, there.y - here.y);

            if (distance < best) {
              best = distance;
              target = item.el;
            }
          }
        }

        const next = target ?? canvas?.surface();

        if (next === undefined || next === null) {
          return null;
        }

        announce(
          `${labelOf(lost.el)} is no longer shown. Focus moved to ${labelOf(next)}.`
        );

        return next;
      },
    });

    const selectableKeys = () => {
      const keys: Array<string> = [];

      for (const item of roving.items()) {
        if (item.props.selectable === true) {
          keys.push(item.key);
        }
      }

      return keys;
    };

    const selection = createSelection(context, {
      key: "selected",
      multiple: () => context.options().multiple === true,
      order: selectableKeys,
      selectable: (key) => selectableKeys().includes(key),
      set: (value, details) => change("selected", value, details),
    });

    const activate = (
      key: string,
      props: CanvasItemProps,
      { enter, event, shift }: { enter: boolean; event?: Event; shift: boolean }
    ) => {
      if (
        shift &&
        props.selectable === true &&
        context.options().multiple === true
      ) {
        const { pinned, selected } = store.get();

        if (selected.length === 0 && pinned !== null) {
          store.set({ selected: [pinned] });
        }

        selection.toggle(key, { event, reason: "item-press" });

        return;
      }

      if (enter && !shift && props.onOpen !== undefined) {
        props.onOpen();

        return;
      }

      props.onPress?.(event);
    };

    return { activate, note, recovery, roving };
  },
  controlled: ["selected"],
  name: "canvas-items",
  options: {
    canvas: "value",
    multiple: "boolean",
    onSelectedChange: "callback",
    pinned: "value",
    selected: "value",
  },
  slots: (slot) => ({
    item: slot<CanvasItemProps>({
      attrs: (state, part) => ({
        tabindex: part.api.roving.tabIndex(state, part),
      }),
      bind: (el, part) => {
        const unbindFocus = part.api.roving.bind(el, part);
        const unbindRecovery = part.api.recovery.bind(el, part);

        const onFocusIn = () => {
          part.api.note(part.key, el);
        };

        el.addEventListener("focusin", onFocusIn);

        return () => {
          if (el.contains(document.activeElement)) {
            part.api.note(part.key, el);
          }

          el.removeEventListener("focusin", onFocusIn);
          unbindRecovery();
          unbindFocus();
        };
      },
      focus: "roving",
      on: {
        keydown: (event, { api, el, key, props }) => {
          // ui-sdk's press hears only clicks, and a <g> turns no key into a
          // click: https://github.com/vercel-labs/ui/issues/958
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            api.activate(key, props, {
              enter: event.key === "Enter",
              event,
              shift: event.shiftKey,
            });

            return;
          }

          if (el !== undefined) {
            api.roving.keydown(event, el);
          }

          // The arrows are the group's even at an edge, where nothing moves.
          // Left alone there, one would scroll the canvas's pane, which the
          // viewport turns into a pan.
          if (
            arrows.has(event.key) &&
            !event.altKey &&
            !event.ctrlKey &&
            !event.metaKey
          ) {
            event.preventDefault();
          }
        },
      },
      press: ({ api, key, props }, event) => {
        api.activate(key, props, {
          enter: false,
          event,
          shift: event instanceof MouseEvent && event.shiftKey,
        });
      },
      props: {
        onOpen: "callback",
        onPress: "callback",
        selectable: "boolean",
        value: "string",
      },
      role: "button",
    }),
    root: slot({}),
  }),
  state: (options: CanvasItemsOptions): CanvasItemsState => ({
    focused: null,
    pinned: options.pinned ?? null,
    selected: [...options.selected],
  }),
  sync: (options) => ({
    pinned: options.pinned ?? null,
    selected: [...options.selected],
  }),
});

const itemSelector = '[data-slot="canvas-items-item"]';

/**
 * The pressable items on a `PannableCanvas`, such as a map's structures,
 * sharing one Tab stop. The arrow keys move focus to the nearest item on
 * screen in their direction, and stay the group's at an edge, so they reach
 * no listener above it. Home and End go to the first and last. Enter,
 * Space and a click press an item; Enter opens it instead when it has
 * `onOpen`. With `multiple`, Shift and a press toggles a `selectable` item in
 * `selected`, which `onSelectedChange` reports. `pinned` holds the Tab stop
 * until focus has been in the group. An item that takes keyboard focus off
 * screen is panned into view.
 */
function CanvasItems({
  children,
  multiple,
  onSelectedChange,
  pinned,
  selected,
}: Omit<CanvasItemsOptions, "canvas"> & { readonly children: ReactNode }) {
  const canvas = usePannableCanvas();

  const handle = usePrimitive(canvasItems, {
    canvas,
    multiple,
    onSelectedChange,
    pinned,
    selected,
  });

  const { viewport } = canvas;

  const reveal = (event: FocusEvent<SVGGElement>) => {
    const item =
      event.target instanceof Element
        ? event.target.closest(itemSelector)
        : null;

    if (item?.matches(":focus-visible") === true) {
      viewport.reveal(viewport.rectOf(item), { padding: 24 });
    }
  };

  return usePart(handle, "root", {}, { children, onFocus: reveal }, "g");
}

/** One item, a `<g>` with the button role. Its `value` is its key. */
function CanvasItem({
  onOpen,
  onPress,
  selectable,
  value,
  ...props
}: CanvasItemProps & PartProps<"g">) {
  return usePart(
    canvasItems,
    "item",
    { onOpen, onPress, selectable, value },
    props,
    "g"
  );
}

export { CanvasItem, CanvasItems };
export type { CanvasItemProps, CanvasItemsOptions, CanvasItemsState };
