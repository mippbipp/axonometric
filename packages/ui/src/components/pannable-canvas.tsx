import { dragThreshold } from "@axonometric/ui/lib/canvas-drag";
import {
  createViewport,
  definePrimitive,
  live,
  type Viewport,
  type ViewportReason,
} from "@ui-sdk/core";
import { usePart, usePrimitive, createParts } from "@ui-sdk/react/primitive";
import {
  createContext,
  use,
  useId,
  useImperativeHandle,
  type ReactNode,
  type Ref,
} from "react";

/** Where the canvas's origin sits on screen, and its scale. */
type Camera = Viewport;

/** The size of the canvas, in pixels. */
interface CanvasSize {
  readonly height: number;
  readonly width: number;
}

/** Why the camera moved, and the event that moved it, if there was one. */
interface CameraDetails {
  readonly event?: Event;
  readonly reason: ViewportReason;
}

interface PannableCanvasOptions {
  /** Presses that belong to the content, so they never pan. */
  readonly claims: (event: PointerEvent) => boolean;
  /** The camera Zoom to fit shows for a canvas of the given size. */
  readonly fit: (size: CanvasSize) => Camera;
  /** The zoom limits, from the scale that Zoom to fit last showed. */
  readonly limits: (fitScale: number) => {
    readonly max: number;
    readonly min: number;
  };
  /** Hears every camera change that was accepted, with the reason. */
  readonly onCameraChange?: (camera: Camera, details: CameraDetails) => void;
}

interface PannableCanvasState {
  /** The pane's resting scroll, which the world and the svg compensate for. */
  readonly findable: { readonly x: number; readonly y: number };
  /** Not rendered. Written only by `reframe`. */
  readonly fitScale: number;
  readonly viewport: Camera;
}

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT");

const wheelZoomFactor = (event: WheelEvent) => {
  const lines = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : 1;

  return Math.exp(-event.deltaY * lines * 0.0015);
};

type Press =
  | { readonly kind: "idle" }
  | { readonly down: PointerEvent; readonly kind: "held" }
  | { readonly down: PointerEvent; readonly kind: "pending" }
  | { readonly kind: "panning"; readonly pointers: ReadonlySet<number> };

const idle: Press = { kind: "idle" };

type ViewportApi = ReturnType<typeof createViewport<PannableCanvasState>>;

/**
 * Hands a press to ui-sdk's viewport only once it is a drag or a pinch.
 * `viewport.pointerdown` captures the pointer on the surface at once, and
 * then the click lands on the surface, so a plain click on the content
 * (the note tool's spot picker, say) would never arrive.
 */
const routePresses = ({
  claims,
  inControls,
  root,
  viewport,
}: {
  readonly claims: (event: PointerEvent) => boolean;
  readonly inControls: (target: EventTarget | null) => boolean;
  readonly root: HTMLElement;
  readonly viewport: ViewportApi;
}) => {
  let press: Press = idle;
  let swallow = false;

  const isPrimary = (event: PointerEvent) =>
    event.button === 0 && !inControls(event.target);

  const startsPan = (event: PointerEvent) => isPrimary(event) && !claims(event);

  const firstPress = (event: PointerEvent): Press => {
    if (startsPan(event)) {
      return { down: event, kind: "pending" };
    }

    return isPrimary(event) ? { down: event, kind: "held" } : idle;
  };

  const startPinch = (first: PointerEvent, second: PointerEvent): Press => {
    viewport.pointerdown(first);
    viewport.pointerdown(second);

    return {
      kind: "panning",
      pointers: new Set([first.pointerId, second.pointerId]),
    };
  };

  const onPointerDown = (event: PointerEvent) => {
    // Every press starts fresh. A touch pan fires no click, so waiting for
    // one to clear the flag would swallow the next real click.
    swallow = false;

    switch (press.kind) {
      case "idle": {
        press = firstPress(event);
        break;
      }
      case "held":
      case "pending": {
        if (event.pointerId === press.down.pointerId) {
          press = firstPress(event);
          break;
        }

        press = startPinch(press.down, event);
        break;
      }
      case "panning": {
        viewport.pointerdown(event);
        press = {
          kind: "panning",
          pointers: new Set([...press.pointers, event.pointerId]),
        };
        break;
      }
      default: {
        break;
      }
    }
  };

  const onPointerMove = (event: PointerEvent) => {
    if (press.kind !== "pending" || event.pointerId !== press.down.pointerId) {
      return;
    }

    const { down } = press;
    const dx = event.clientX - down.clientX;
    const dy = event.clientY - down.clientY;

    if (Math.abs(dx) < dragThreshold && Math.abs(dy) < dragThreshold) {
      return;
    }

    // ui-sdk adds its own move listener during this dispatch, so it misses
    // this move. Its next move pans from the press, so nothing counts twice.
    viewport.pointerdown(down);
    viewport.panBy(dx, dy, { event, reason: "drag" });
    swallow = down.pointerType !== "touch";
    press = { kind: "panning", pointers: new Set([down.pointerId]) };
  };

  const onPointerEnd = (event: PointerEvent) => {
    if (press.kind === "pending" || press.kind === "held") {
      if (event.pointerId === press.down.pointerId) {
        press = idle;
      }
    } else if (press.kind === "panning") {
      const pointers = new Set(press.pointers);

      pointers.delete(event.pointerId);
      press = pointers.size === 0 ? idle : { kind: "panning", pointers };
    }
  };

  // A mouse drag ends with a click on whatever is under the pointer.
  // `createViewport` doesn't swallow it, so this does, until
  // https://github.com/vercel-labs/ui/issues/925 gives a public way. It runs
  // before the content's own click listeners.
  const onClick = (event: MouseEvent) => {
    if (swallow) {
      swallow = false;
      event.stopPropagation();
      event.preventDefault();
    }
  };

  const capture = { capture: true } as const;

  root.addEventListener("pointerdown", onPointerDown, capture);
  root.addEventListener("pointermove", onPointerMove, capture);
  root.addEventListener("pointerup", onPointerEnd, capture);
  root.addEventListener("pointercancel", onPointerEnd, capture);
  root.addEventListener("click", onClick, capture);

  return () => {
    root.removeEventListener("pointerdown", onPointerDown, capture);
    root.removeEventListener("pointermove", onPointerMove, capture);
    root.removeEventListener("pointerup", onPointerEnd, capture);
    root.removeEventListener("pointercancel", onPointerEnd, capture);
    root.removeEventListener("click", onClick, capture);
  };
};

const pannableCanvas = definePrimitive({
  api: (context) => {
    const { store } = context;

    const viewport = createViewport(context, {
      key: "viewport",
      maxZoom: () => context.options().limits(store.get().fitScale).max,
      minZoom: () => context.options().limits(store.get().fitScale).min,
      set: (value, details) => {
        store.set({ viewport: value });
        context.options().onCameraChange?.(value, details);

        return true;
      },
      surface: () => context.element("root"),
    });

    const size = (): CanvasSize => {
      const root = context.element("root");

      return { height: root?.clientHeight ?? 0, width: root?.clientWidth ?? 0 };
    };

    const reframe = (
      camera: Camera,
      fitScale: number,
      details?: CameraDetails
    ) => {
      store.set({ fitScale });
      viewport.setViewport(camera, details);
    };

    const fit = (details?: CameraDetails) => {
      const camera = context.options().fit(size());

      reframe(camera, camera.zoom, details);
    };

    return {
      claims: (event: PointerEvent) => context.options().claims(event),
      fit,
      fitScale: () => store.get().fitScale,
      inControls: (target: EventTarget | null) =>
        target instanceof Node &&
        (context.element("controls")?.contains(target) ?? false),
      reframe,
      size,
      viewport,
    };
  },
  live: ["viewport", "findable"],
  name: "pannable-canvas",
  options: {
    claims: "value",
    fit: "value",
    limits: "value",
    onCameraChange: "callback",
  },
  slots: (slot) => ({
    controls: slot({}),
    offset: slot({
      live: live((state) => ({
        transform: `translate(${-state.findable.x} ${-state.findable.y})`,
      })),
    }),
    pane: slot({
      bind: (el, { api, store }) => {
        const unbind = api.viewport.bindFindable(el);

        // ui-sdk rests the pane scrolled far from its origin, and says
        // where only through the pane itself.
        store.set({ findable: { x: el.scrollLeft, y: el.scrollTop } });

        return () => {
          unbind();
          store.set({ findable: { x: 0, y: 0 } });
        };
      },
    }),
    // The surface is the root and not the svg, because ui-sdk types it as an
    // HTMLElement (https://github.com/vercel-labs/ui/issues/959).
    root: slot({
      bind: (el, { api }) => {
        const unroute = routePresses({
          claims: api.claims,
          inControls: api.inControls,
          root: el,
          viewport: api.viewport,
        });

        const onWheel = (event: WheelEvent) => {
          if (api.inControls(event.target)) {
            return;
          }

          if (event.ctrlKey || event.metaKey) {
            api.viewport.wheel(event);

            return;
          }

          event.preventDefault();
          api.viewport.zoomBy(
            wheelZoomFactor(event),
            { x: event.clientX, y: event.clientY },
            { event, reason: "wheel" }
          );
        };

        const onKeyDown = (event: KeyboardEvent) => {
          if (
            event.defaultPrevented ||
            event.ctrlKey ||
            event.metaKey ||
            event.altKey ||
            isTyping(event.target)
          ) {
            return;
          }

          if (event.key === "0") {
            event.preventDefault();
            api.fit({ event, reason: "zoom-key" });
          } else {
            api.viewport.keydown(event);
          }
        };

        // React's wheel listener is passive, so it can't stop the page
        // scrolling.
        el.addEventListener("wheel", onWheel, { passive: false });
        globalThis.addEventListener("keydown", onKeyDown);

        const observer = new ResizeObserver(() => {
          api.fit();
        });

        observer.observe(el);

        return () => {
          observer.disconnect();
          globalThis.removeEventListener("keydown", onKeyDown);
          el.removeEventListener("wheel", onWheel);
          unroute();
        };
      },
    }),
    svg: slot({
      live: live((state) => ({
        "data-scale": String(state.viewport.zoom),
        style: `position:absolute;left:${state.findable.x}px;top:${state.findable.y}px;width:100%;height:100%;pointer-events:auto;display:block`,
      })),
    }),
    world: slot({
      live: live((state, { api }) => ({
        style: api.viewport.style(state),
      })),
    }),
  }),
  state: (_options: PannableCanvasOptions): PannableCanvasState => ({
    findable: { x: 0, y: 0 },
    fitScale: 1,
    viewport: { x: 0, y: 0, zoom: 1 },
  }),
});

const parts = createParts(pannableCanvas, {
  controls: "div",
  offset: "g",
  pane: "div",
  svg: "svg",
  world: "g",
});

type PannableCanvasApi = ReturnType<typeof pannableCanvas>["api"];

const CanvasContext = createContext<PannableCanvasApi | null>(null);

/** The nearest canvas's api, for content drawn inside it. */
function usePannableCanvas(): PannableCanvasApi {
  const api = use(CanvasContext);

  if (api === null) {
    throw new Error("usePannableCanvas must be used inside a PannableCanvas.");
  }

  return api;
}

interface PannableCanvasProps extends PannableCanvasOptions {
  /** Drawn inside the world, in canvas units. */
  readonly children: ReactNode;
  /** Drawn over the canvas's bottom right. Presses on them never pan. */
  readonly controls?: ReactNode;
  readonly ref?: Ref<PannableCanvasApi>;
  /** The svg's name for a screen reader. */
  readonly title: string;
}

/**
 * An SVG canvas you can pan and zoom, on ui-sdk's viewport. Drag on empty
 * space to pan; a press that moves under 3 px along both axes, ui-sdk's drag
 * threshold, is still a click on what it landed on. A pinch or Ctrl and the
 * wheel zooms at the pointer, the wheel alone zooms too, `+` and `-` zoom
 * from the middle and `0` shows what `fit` returns. The browser's find in page and focus bring what they find into
 * view. Everything is positioned in canvas units inside the world, whose
 * camera is one transform, so panning renders nothing. Reach the viewport
 * through `ref`, or `usePannableCanvas` from inside.
 */
function PannableCanvas({
  children,
  controls,
  ref,
  title,
  ...options
}: PannableCanvasProps) {
  const handle = usePrimitive(pannableCanvas, options);
  const titleId = useId();

  useImperativeHandle(ref, () => handle.api, [handle]);

  const root = usePart(
    handle,
    "root",
    {},
    {
      children: (
        <>
          <parts.Pane className="pointer-events-none absolute inset-0 touch-none [scrollbar-width:none] overflow-scroll">
            {/* geometricPrecision draws text at the width the scene measured.
                With the default, Chromium rounds each glyph's advance to a
                whole pixel on screen, so a 9 px label is drawn at 5 px a
                character, not 5.4. */}
            <parts.Svg
              aria-labelledby={titleId}
              className="touch-none"
              textRendering="geometricPrecision"
            >
              <title id={titleId}>{title}</title>
              <parts.Offset>
                <parts.World data-viewport="">{children}</parts.World>
              </parts.Offset>
            </parts.Svg>
          </parts.Pane>
          {controls === undefined ? null : (
            <parts.Controls className="absolute right-3 bottom-3 flex gap-1.5 font-mono">
              {controls}
            </parts.Controls>
          )}
        </>
      ),
      className:
        "relative size-full cursor-grab touch-none overflow-clip select-none active:cursor-grabbing",
    },
    "div"
  );

  return <CanvasContext value={handle.api}>{root}</CanvasContext>;
}

export { PannableCanvas, pannableCanvas, usePannableCanvas };
export type {
  CameraDetails,
  CanvasSize,
  Camera,
  PannableCanvasApi,
  PannableCanvasOptions,
  PannableCanvasProps,
  PannableCanvasState,
};
