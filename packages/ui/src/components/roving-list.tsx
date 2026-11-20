import { cn } from "@axonometric/ui/lib/utils";
import {
  createFocusRecovery,
  createRovingFocus,
  definePrimitive,
} from "@ui-sdk/core";
import { createParts } from "@ui-sdk/react/primitive";
import { Array as Arr, Option } from "effect";
import type { ComponentProps } from "react";

interface RovingListOptions {
  readonly loop?: boolean;
  readonly orientation?: "horizontal" | "vertical";
  /** The key of the item that holds the Tab stop, such as the selected one. */
  readonly value?: string | null;
}

interface RovingListState {
  readonly focused: string | null;
  readonly value: string | null;
}

const rovingList = definePrimitive({
  api: (context) => {
    const roving = createRovingFocus<RovingListState>(context, {
      claims: (state, item) => state.value === null || item.key === state.value,
      key: "focused",
      loop: () => Boolean(context.options().loop),
      orientation: () => context.options().orientation ?? "vertical",
      preferred: (item) => item.key === context.store.get().value,
      remember: false,
      slot: "item",
    });

    let order: Array<string> = [];

    const recovery = createFocusRecovery({
      fallback: (lost) => {
        const remaining = new Map(
          Arr.map(roving.items(), ({ el, key }) => [key, el] as const)
        );
        const at = order.indexOf(lost.key);
        const after = order.slice(at + 1);
        const before = Arr.reverse(order.slice(0, Math.max(at, 0)));

        return Arr.findFirst(
          Arr.map([lost.key, ...after, ...before], (key) => remaining.get(key)),
          (el) => el !== undefined
        ).pipe(Option.getOrNull);
      },
    });

    return {
      recovery,
      roving,
      track: () => {
        order = Arr.map(roving.items(), ({ key }) => key);
      },
    };
  },
  name: "roving-list",
  options: {
    loop: "boolean",
    orientation: "string",
    value: "value",
  },
  slots: (slot) => ({
    item: slot<{ value: string }>({
      attrs: (state, part) => ({
        tabindex: part.api.roving.tabIndex(state, part),
        type: "button",
      }),
      bind: (el, part) => {
        const unbindRoving = part.api.roving.bind(el, part);
        const unbindRecovery = part.api.recovery.bind(el, part);

        return () => {
          unbindRoving();
          unbindRecovery();
        };
      },
      on: {
        focusin: (_event, { api }) => {
          api.track();
        },
        keydown: (event, { api, el }) => {
          if (el) {
            api.roving.keydown(event, el);
          }
        },
      },
      press: { none: "A press is the item's own click." },
      props: { value: "string" },
    }),
    root: slot({}),
  }),
  state: (options: RovingListOptions) => ({
    focused: null as string | null,
    value: options.value ?? null,
  }),
  sync: (options) => ({ value: options.value ?? null }),
});

const parts = createParts(rovingList, {
  item: "button",
  root: "nav",
});

type WithClassName<Props> = Omit<Props, "className"> & {
  readonly className?: string;
};

/**
 * A navigation landmark whose buttons share one Tab stop. Arrow keys along
 * `orientation` (vertical by default), Home and End move focus between the
 * items; `loop` wraps past either end. `value` is the key of the item that
 * holds the stop, so Tab lands on it each time. It sets no roles, so give the
 * nav an `aria-label` and mark the current item with `aria-current` yourself.
 */
function RovingList({
  className,
  ...props
}: WithClassName<ComponentProps<typeof parts.Root>>) {
  return <parts.Root className={cn(className)} {...props} />;
}

/** One button in the list. Its `value` is its key. */
function RovingListItem({
  className,
  ...props
}: WithClassName<ComponentProps<typeof parts.Item>>) {
  return <parts.Item className={cn(className)} {...props} />;
}

export { RovingList, RovingListItem, rovingList };
export type { RovingListOptions, RovingListState };
