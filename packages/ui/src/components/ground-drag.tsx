import { bindCanvasDrag } from "@axonometric/ui/lib/canvas-drag";
import {
  createMove,
  createResize,
  definePrimitive,
  live,
  type MoveDraft,
  type ResizeBox,
  type ResizeDraft,
} from "@ui-sdk/core";
import { usePart, usePrimitive, type PartProps } from "@ui-sdk/react/primitive";

/** A point on the ground, in grid units. */
interface GroundPoint {
  readonly x: number;
  readonly y: number;
}

/** A footprint on the ground: `width` along x, `height` along y. */
interface GroundBox extends GroundPoint {
  readonly height: number;
  readonly width: number;
}

/** A footprint corner, by compass point on the ground. */
type GroundCorner = "ne" | "nw" | "se" | "sw";

/** What started a move or a resize. */
type GroundInput = "keyboard" | "pointer";

/** What a drag would do now, snapped by the same ui-sdk call that commits. */
type GroundDraft =
  | {
      readonly from: Readonly<Record<string, GroundPoint>>;
      /** The pressed item first. */
      readonly keys: ReadonlyArray<string>;
      readonly kind: "move";
      readonly to: Readonly<Record<string, GroundPoint>>;
    }
  | {
      readonly from: GroundBox;
      readonly handle: GroundCorner;
      readonly key: string;
      readonly kind: "resize";
      readonly to: GroundBox;
    };

interface GroundDragOptions {
  /** Every item's footprint, shown or not, so hidden items can move too. */
  readonly boxes: Readonly<Record<string, GroundBox>>;
  readonly disabled?: boolean;
  /** The ground point under a window point, through `el`'s transform. */
  readonly groundAt: (
    el: Element,
    at: { readonly clientX: number; readonly clientY: number }
  ) => GroundPoint | undefined;
  /**
   * The keys a press or an Alt+arrow on `target` moves, the pressed item
   * first, or none. For a key, `target` is the focused element.
   */
  readonly keysFor: (
    target: Element | null,
    input: GroundInput
  ) => ReadonlyArray<string> | undefined;
  /** The name a screen reader hears for an item. */
  readonly label?: (key: string) => string | undefined;
  /** How far Shift with the arrows moves. */
  readonly largeStep: number;
  /** The smallest width and height. */
  readonly minSize: number;
  /** Hears the draft each time it changes, and `null` when the drag ends. */
  readonly onDraft?: (draft: GroundDraft | null) => void;
  /**
   * One call per drop or nudge, with the moved keys' new positions. Returns
   * false when it was refused.
   */
  readonly onMove: (
    to: Readonly<Record<string, GroundPoint>>,
    details: { readonly input: GroundInput }
  ) => boolean;
  /** One call per resize drop or resize key. Returns false when refused. */
  readonly onResize: (
    key: string,
    box: GroundBox,
    details: { readonly input: GroundInput }
  ) => boolean;
  /** The grid drops land on, and how far an arrow moves. */
  readonly step: number;
}

interface GroundDragState {
  /**
   * The boxes the running move or resize starts from. createMove reads their
   * `x` and `y` as its positions.
   */
  readonly boxes: Record<string, ResizeBox>;
  readonly draft: GroundDraft | null;
  /** createMove's and createResize's own drafts, unused. */
  readonly moving: MoveDraft | null;
  readonly resizing: ResizeDraft | null;
}

interface GroundHandleProps {
  readonly corner: GroundCorner;
  /** The key of the box the handle resizes. */
  readonly owner: string;
  readonly value: string;
}

/** What a `set` call does: record a dry run's value, or commit. */
type Call =
  | { readonly input: GroundInput; readonly kind: "commit" }
  | {
      box?: GroundBox;
      readonly kind: "trial";
      moved?: Readonly<Record<string, GroundPoint>>;
    };

const arrows = new Map<string, GroundPoint>([
  ["ArrowDown", { x: 0, y: 1 }],
  ["ArrowLeft", { x: -1, y: 0 }],
  ["ArrowRight", { x: 1, y: 0 }],
  ["ArrowUp", { x: 0, y: -1 }],
]);

/** Which edges each corner drags: east moves the x edge at the far side. */
const edgesOf = {
  ne: { east: true, south: false },
  nw: { east: false, south: false },
  se: { east: true, south: true },
  sw: { east: false, south: true },
} as const satisfies Record<
  GroundCorner,
  { readonly east: boolean; readonly south: boolean }
>;

const handleSelector = '[data-slot="ground-drag-handle"]';

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT");

const samePoints = (
  a: Readonly<Record<string, GroundPoint>>,
  b: Readonly<Record<string, GroundPoint>>
) => {
  for (const key in a) {
    if (a[key]?.x !== b[key]?.x || a[key]?.y !== b[key]?.y) {
      return false;
    }
  }

  return true;
};

const sameBox = (a: GroundBox, b: GroundBox) =>
  a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

const sameDraft = (a: GroundDraft, b: GroundDraft) =>
  a.kind === "move"
    ? b.kind === "move" && samePoints(a.to, b.to)
    : b.kind === "resize" && sameBox(a.to, b.to);

/** Where each of `keys` that `from` has sits. */
const pointsOf = (
  keys: ReadonlyArray<string>,
  from: Readonly<Record<string, GroundPoint>>
) => {
  const points: Record<string, GroundPoint> = {};

  for (const key of keys) {
    const at = from[key];

    if (at !== undefined) {
      points[key] = { x: at.x, y: at.y };
    }
  }

  return points;
};

const groundDrag = definePrimitive({
  api: (context) => {
    const { store } = context;
    const options = () => context.options();
    let call: Call = { kind: "trial" };
    let stop: (() => void) | undefined;
    // The keys the running moveBy or resizeBy is for.
    let moving: Array<string> = [];
    let resizing = "";

    const commitWith = (input: GroundInput, run: () => boolean) => {
      call = { input, kind: "commit" };

      try {
        return run();
      } finally {
        call = { kind: "trial" };
      }
    };

    /** What `run` would ask `set` for, without committing it. */
    const trial = (run: () => boolean) => {
      const seen: Call = { kind: "trial" };

      call = seen;
      run();
      call = { kind: "trial" };

      return seen;
    };

    const move = createMove<GroundDragState>(context, {
      draft: "moving",
      key: "boxes",
      label: (key) => options().label?.(key),
      largeStep: () => options().largeStep,
      set: (value) => {
        if (call.kind === "trial") {
          call.moved = value;

          return false;
        }

        return options().onMove(pointsOf(moving, value), { input: call.input });
      },
      step: () => options().step,
    });

    const resize = createResize<GroundDragState>(context, {
      boxes: (state) => state.boxes,
      draft: "resizing",
      label: (key) => options().label?.(key),
      largeStep: () => options().largeStep,
      min: () => ({ height: options().minSize, width: options().minSize }),
      set: (value) => {
        const box = value[resizing];

        if (call.kind === "trial") {
          call.box = box;

          return false;
        }

        return (
          box !== undefined &&
          options().onResize(resizing, box, { input: call.input })
        );
      },
      step: () => options().step,
    });

    // Each move or resize starts from the boxes as they are when it starts,
    // so a render during a drag doesn't move its start.
    const startFrom = () => {
      store.set({ boxes: { ...options().boxes } });
    };

    const moveBy = (
      keys: ReadonlyArray<string>,
      by: GroundPoint,
      event?: Event
    ) => {
      const { boxes } = store.get();

      // createMove puts a key it has no position for at the origin.
      moving = [];

      for (const key of keys) {
        if (boxes[key] !== undefined) {
          moving.push(key);
        }
      }

      // moveBy rounds every reason but "drag" to whole units, so a nudge by
      // half a unit says it's a drag: https://github.com/vercel-labs/ui/issues/957
      return move.moveBy(moving, by.x, by.y, { event, reason: "drag" });
    };

    const round = (value: number) =>
      Math.round(value / options().step) * options().step;

    // resizeBy never rounds, so a drag snaps the edges it moves itself.
    const snappedResizeBy = (
      key: string,
      corner: GroundCorner,
      by: GroundPoint
    ) => {
      const from = store.get().boxes[key];

      if (from === undefined) {
        return false;
      }

      const { east, south } = edgesOf[corner];
      const edgeX = east ? from.x + from.width : from.x;
      const edgeY = south ? from.y + from.height : from.y;

      resizing = key;

      return resize.resizeBy(
        key,
        corner,
        round(edgeX + by.x) - edgeX,
        round(edgeY + by.y) - edgeY,
        { reason: "drag" }
      );
    };

    // createMove's and createResize's pointerdown turn pixels into units by
    // one scale, which can't follow the Iso view's projection, so drags go
    // through groundAt and commit with moveBy and resizeBy. Move back once
    // they take a projection: https://github.com/vercel-labs/ui/issues/956
    const follow = (
      down: PointerEvent,
      draftAt: (by: GroundPoint) => GroundDraft,
      drop: (by: GroundPoint) => void
    ) => {
      const root = context.element("root");
      const start = root && options().groundAt(root, down);

      if (root === undefined || start === undefined) {
        return;
      }

      stop?.();

      let offset: GroundPoint | undefined;

      const unbind = bindCanvasDrag(root, down, {
        onEnd: ({ canceled }) => {
          stop = undefined;
          store.set({ draft: null });

          if (!canceled && offset !== undefined) {
            drop(offset);
          }
        },
        onMove: (at) => {
          const ground = options().groundAt(root, at);

          if (ground === undefined) {
            return;
          }

          offset = { x: ground.x - start.x, y: ground.y - start.y };

          const next = draftAt(offset);
          const { draft } = store.get();

          if (draft === null || !sameDraft(draft, next)) {
            store.set({ draft: next });
          }
        },
      });

      stop = () => {
        unbind();
        stop = undefined;
        store.set({ draft: null });
      };
    };

    const press = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;

      // A Shift-press picks items or starts a selection box.
      if (
        event.button !== 0 ||
        event.shiftKey ||
        options().disabled === true ||
        target?.closest(handleSelector)
      ) {
        return;
      }

      const keys = options().keysFor(target, "pointer");

      if (keys === undefined || keys.length === 0) {
        return;
      }

      startFrom();

      const from = pointsOf(keys, store.get().boxes);

      follow(
        event,
        (by) => {
          const { moved } = trial(() => moveBy(keys, by));

          return {
            from,
            keys,
            kind: "move",
            to: moved === undefined ? from : pointsOf(keys, moved),
          };
        },
        (by) => {
          commitWith("pointer", () => moveBy(keys, by));
        }
      );
    };

    const pressHandle = (
      event: PointerEvent,
      key: string,
      corner: GroundCorner
    ) => {
      if (event.button !== 0 || options().disabled === true) {
        return;
      }

      startFrom();

      const from = store.get().boxes[key];

      if (from === undefined) {
        return;
      }

      follow(
        event,
        (by) => ({
          from,
          handle: corner,
          key,
          kind: "resize",
          to: trial(() => snappedResizeBy(key, corner, by)).box ?? from,
        }),
        (by) => {
          commitWith("pointer", () => snappedResizeBy(key, corner, by));
        }
      );
    };

    const resizeKey = (
      event: KeyboardEvent,
      key: string,
      corner: GroundCorner
    ) => {
      if (
        options().disabled === true ||
        !arrows.has(event.key) ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey
      ) {
        return;
      }

      if (event.repeat) {
        event.preventDefault();

        return;
      }

      startFrom();
      resizing = key;
      commitWith("keyboard", () => resize.keydown(event, key, corner));
    };

    const nudge = (event: KeyboardEvent) => {
      const arrow = arrows.get(event.key);

      if (
        arrow === undefined ||
        !event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.defaultPrevented ||
        options().disabled === true ||
        isTyping(event.target)
      ) {
        return;
      }

      const keys = options().keysFor(
        event.target instanceof Element ? event.target : null,
        "keyboard"
      );

      if (keys === undefined || keys.length === 0) {
        return;
      }

      event.preventDefault();

      if (event.repeat) {
        return;
      }

      const by = event.shiftKey ? options().largeStep : options().step;

      startFrom();
      commitWith("keyboard", () =>
        moveBy(keys, { x: arrow.x * by, y: arrow.y * by }, event)
      );
    };

    // On the document, so Alt and an arrow nudge wherever focus is, unless a
    // handler above already took the key.
    const listen = (el: HTMLElement) => {
      el.ownerDocument.addEventListener("keydown", nudge);

      return () => {
        el.ownerDocument.removeEventListener("keydown", nudge);
      };
    };

    let sent: GroundDraft | null = null;

    context.onDestroy(
      store.subscribe(() => {
        const { draft } = store.get();

        if (draft !== sent) {
          sent = draft;
          options().onDraft?.(draft);
        }
      })
    );
    context.onDestroy(() => stop?.());

    return { listen, press, pressHandle, resize, resizeKey };
  },
  live: ["draft"],
  name: "ground-drag",
  options: {
    boxes: "value",
    disabled: "boolean",
    groundAt: "value",
    keysFor: "value",
    label: "value",
    largeStep: "number",
    minSize: "number",
    onDraft: "callback",
    onMove: "action",
    onResize: "action",
    step: "number",
  },
  slots: (slot) => ({
    handle: slot<GroundHandleProps>({
      attrs: (_state, { api, props }) => ({
        ...api.resize.handleAttrs(props.corner),
        "aria-keyshortcuts": "ArrowUp ArrowDown ArrowLeft ArrowRight",
        tabindex: "0",
      }),
      focus: "tab-stop",
      on: {
        keydown: (event, { api, props }) => {
          api.resizeKey(event, props.owner, props.corner);
        },
        pointerdown: (event, { api, props }) => {
          api.pressHandle(event, props.owner, props.corner);
        },
      },
      press: { none: "A handle resizes with the arrows and by dragging." },
      props: { corner: "string", owner: "string", value: "string" },
      role: "button",
    }),
    root: slot({
      bind: (el, { api }) => api.listen(el),
      live: live((state) => ({
        "data-dragging":
          state.draft === null
            ? undefined
            : state.draft.kind === "move"
              ? state.draft.keys[0]
              : state.draft.key,
      })),
      on: {
        pointerdown: (event, { api }) => {
          api.press(event);
        },
      },
    }),
  }),
  state: (options: GroundDragOptions): GroundDragState => ({
    boxes: { ...options.boxes },
    draft: null,
    moving: null,
    resizing: null,
  }),
});

/**
 * Moves and resizes footprints on the ground, in any projection, around
 * what it wraps inside a canvas's world. A press that `keysFor` claims and
 * moves 3 px drags those keys, snapped to `step` on the ground; Escape puts
 * them back. Alt and an arrow move the keys `keysFor` gives the focused
 * element, and Shift makes the step `largeStep`. Each `GroundHandle` resizes
 * its box by dragging or with the arrows, keeping the opposite corner. Each
 * drop, nudge or resize key is one `onMove` or `onResize` call. `onDraft`
 * hears what a drag would do as it changes, from the same calls that commit.
 */
function GroundDrag({
  boxes,
  disabled,
  groundAt,
  keysFor,
  label,
  largeStep,
  minSize,
  onDraft,
  onMove,
  onResize,
  step,
  ...props
}: GroundDragOptions & PartProps<"g">) {
  const handle = usePrimitive(groundDrag, {
    boxes,
    disabled,
    groundAt,
    keysFor,
    label,
    largeStep,
    minSize,
    onDraft,
    onMove,
    onResize,
    step,
  });

  return usePart(handle, "root", {}, props, "g");
}

/**
 * A focusable corner handle that resizes box `owner` from `corner`. Name it
 * with `aria-label`, and place it with `x`, `y`, `width` and `height`.
 */
function GroundHandle({
  corner,
  owner,
  ...props
}: Omit<GroundHandleProps, "value"> & PartProps<"rect">) {
  return usePart(
    groundDrag,
    "handle",
    { corner, owner, value: `${owner} ${corner}` },
    props,
    "rect"
  );
}

export { GroundDrag, GroundHandle, groundDrag };
export type {
  GroundBox,
  GroundCorner,
  GroundDraft,
  GroundDragOptions,
  GroundInput,
  GroundPoint,
};
