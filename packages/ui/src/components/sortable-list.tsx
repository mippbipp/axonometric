import { cn } from "@axonometric/ui/lib/utils";
import {
  createChange,
  createReorder,
  definePrimitive,
  type ChangeDetails,
  type ReorderDraft,
  type ReorderReason,
} from "@ui-sdk/core";
import { createParts } from "@ui-sdk/react/primitive";
import type { ComponentProps } from "react";

interface SortableListOptions {
  readonly disabled?: boolean;
  /** The name a screen reader hears for a row's key. */
  readonly label?: (key: string) => string | undefined;
  readonly onValueChange?: (
    value: Array<string>,
    details: ChangeDetails<ReorderReason>
  ) => void;
  readonly value?: Array<string>;
}

interface SortableListState {
  readonly moving: ReorderDraft | null;
  readonly value: Array<string>;
}

const sortableList = definePrimitive({
  api: (context) => {
    const change = createChange(context);

    const reorder = createReorder<SortableListState>(context, {
      disabled: () => Boolean(context.options().disabled),
      draft: "moving",
      key: "value",
      label: (key) => context.options().label?.(key),
      set: (value, details) => change("value", value, details),
      slot: "item",
    });

    return { reorder };
  },
  controlled: ["value"],
  name: "sortable-list",
  options: {
    disabled: "boolean",
    label: "value",
    onValueChange: "callback",
    value: "value",
  },
  slots: (slot) => ({
    handle: slot<{ value: string }, { grabbed: boolean }>({
      attrs: (state, { api, key }) => ({
        "aria-pressed": String(api.reorder.moving(state, key)),
        disabled: state.disabled ? "" : undefined,
        type: "button",
      }),
      on: {
        keydown: (event, { api, key }) => {
          api.reorder.keydown(event, key);
        },
        pointerdown: (event, { api, key }) => {
          api.reorder.pointerdown(event, key);
        },
      },
      press: { none: "The handle's own keydown picks up and drops." },
      props: { value: "string" },
      state: (state, { api, key }) => ({
        grabbed: api.reorder.moving(state, key),
      }),
    }),
    item: slot<{ value: string }, { dragging: boolean; grabbed: boolean }>({
      attrs: (state, { api, key }) => ({
        "data-dragging": api.reorder.dragging(state, key) ? "" : undefined,
        "data-grabbed": api.reorder.moving(state, key) ? "" : undefined,
      }),
      bind: (el, part) => part.api.reorder.bind(el, part),
      props: { value: "string" },
      state: (state, { api, key }) => ({
        dragging: api.reorder.dragging(state, key),
        grabbed: api.reorder.moving(state, key),
      }),
    }),
    root: slot<object, { order: Array<string> }>({
      state: (state, { api }) => ({ order: api.reorder.order(state) }),
    }),
  }),
  state: (options: SortableListOptions) => ({
    disabled: Boolean(options.disabled),
    moving: null as ReorderDraft | null,
    value: options.value ?? [],
  }),
  sync: (options) => {
    const disabled = Boolean(options.disabled);

    if (options.value === undefined) {
      return { disabled };
    }

    return { disabled, value: options.value };
  },
});

const parts = createParts(sortableList, {
  handle: "button",
  item: "li",
  root: "ol",
});

type WithClassName<Props> = Omit<Props, "className"> & {
  readonly className?: string;
};

/**
 * An ordered list whose rows are reordered with a grip. Pass `value` (the
 * order of row keys) and `onValueChange`, which runs once per drop with the
 * whole new order. Render rows from the order the children function gets: it
 * follows the row being moved before it is dropped. Pick a row up with Space
 * or Enter on its grip, move it with the arrow keys, Home or End, and drop it
 * with Space or Enter. Escape puts it back, and Tab puts it back and moves
 * on. A pointer drag on the grip moves it too. `label` names a row for the
 * announcements.
 */
function SortableList({
  className,
  ...props
}: WithClassName<ComponentProps<typeof parts.Root>>) {
  return <parts.Root className={cn("flex flex-col", className)} {...props} />;
}

/** One row. Its `value` is its key in the list's order. */
function SortableListItem({
  className,
  ...props
}: WithClassName<ComponentProps<typeof parts.Item>>) {
  return (
    <parts.Item
      className={cn(
        "data-[grabbed]:relative data-[grabbed]:z-10 data-[grabbed]:[transform:translate(var(--drag-x,0px),var(--drag-y,0px))] data-[grabbed]:bg-background data-[grabbed]:text-foreground",
        className
      )}
      {...props}
    />
  );
}

/**
 * The grip that moves its row, a button with `aria-pressed` while the row is
 * picked up. Give it an accessible name that says how to use it.
 */
function SortableListHandle({
  className,
  ...props
}: WithClassName<ComponentProps<typeof parts.Handle>>) {
  return (
    <parts.Handle
      className={cn(
        "cursor-grab touch-none rounded-none outline-none select-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-40 data-[grabbed]:cursor-grabbing",
        className
      )}
      {...props}
    />
  );
}

export { SortableList, SortableListHandle, SortableListItem, sortableList };
export type { SortableListOptions, SortableListState };
