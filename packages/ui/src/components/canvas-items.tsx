import { usePannableCanvas } from "@axonometric/ui/components/pannable-canvas";
import {
  createChange,
  createRovingFocus,
  createSelection,
  definePrimitive,
  spatialMove,
  type ChangeDetails,
} from "@ui-sdk/core";
import { usePart, usePrimitive, type PartProps } from "@ui-sdk/react/primitive";
import type { FocusEvent, ReactNode } from "react";

type CanvasItemsReason = "item-press";

interface CanvasItemsOptions {
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

    return { activate, roving };
  },
  controlled: ["selected"],
  name: "canvas-items",
  options: {
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
      bind: (el, part) => part.api.roving.bind(el, part),
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
}: CanvasItemsOptions & { readonly children: ReactNode }) {
  const handle = usePrimitive(canvasItems, {
    multiple,
    onSelectedChange,
    pinned,
    selected,
  });

  const { viewport } = usePannableCanvas();

  // A press focuses the item too, and that shouldn't move the map.
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

export { CanvasItem, CanvasItems, canvasItems };
export type { CanvasItemProps, CanvasItemsOptions, CanvasItemsState };
