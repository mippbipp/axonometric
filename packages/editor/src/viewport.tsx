import { textZoomOf } from "@axonometric/contracts";
import type { GroundProjection } from "@axonometric/contracts";
import type { ReactNode } from "react";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useRef,
} from "react";

import type { Bounds } from "./bounds.ts";
import { controlClass } from "./control-class.ts";
import { settledScale } from "./settled-scale.ts";

/** Where the drawing sits in the canvas: its zoom and its pan, in pixels. */
interface Camera {
  readonly scale: number;
  readonly x: number;
  readonly y: number;
}

interface Size {
  readonly width: number;
  readonly height: number;
}

/** Space left around the bounds when they're fitted, in screen pixels. */
const fitPadding = 48;

/**
 * The most that fitting may zoom in. A chapter with one or two structures
 * would otherwise fill the window at several times real size, with oversized
 * tags. Zooming by hand can still go further.
 */
const maxFitScale = 1.5;

/** How far a press may move before it counts as a drag, in pixels. */
const dragThreshold = 4;

/** How much one press of + or - zooms. */
const zoomStep = 1.25;

const emptyBounds: Bounds = { minX: -1, minY: -1, maxX: 1, maxY: 1 };

const noFloor = (scale: number) => scale;

/** The zoom that fits `bounds` in `size`, capped at `maxFitScale`. */
const scaleToFit = (bounds: Bounds, size: Size) =>
  Math.max(
    Math.min(
      (size.width - fitPadding * 2) / Math.max(bounds.maxX - bounds.minX, 1),
      (size.height - fitPadding * 2) / Math.max(bounds.maxY - bounds.minY, 1),
      maxFitScale
    ),
    0.01
  );

const fitted = ({
  boundsAt,
  size,
  floor,
}: {
  /** The drawing's bounds when it's drawn at a zoom. */
  readonly boundsAt: (zoom: number) => Bounds;
  readonly size: Size;
  readonly floor: (scale: number) => number;
}): Camera => {
  const scale = floor(settledScale((zoom) => scaleToFit(boundsAt(zoom), size)));

  const bounds = boundsAt(scale);

  // Centring the bounds keeps a capped or floored drawing in the middle of
  // the window.

  return {
    scale,
    x: size.width / 2 - ((bounds.minX + bounds.maxX) / 2) * scale,
    y: size.height / 2 - ((bounds.minY + bounds.maxY) / 2) * scale,
  };
};

/**
 * Zoom limits. Out to half the fitted scale or half size, whichever is
 * smaller; in to four times the fitted scale or four times real size,
 * whichever is larger.
 */
const limitsFor = (fitScale: number) => ({
  min: Math.min(fitScale, 1) / 2,
  max: Math.max(fitScale, 1) * 4,
});

/**
 * The camera that shows, in `next`'s projection, the ground point `camera` shows
 * in the middle of a canvas of `size` in `previous`'s projection, with a
 * grid unit as long on screen as before.
 */
const reprojected = ({
  camera,
  size,
  previous,
  next,
}: {
  readonly camera: Camera;
  readonly size: Size;
  readonly previous: GroundProjection;
  readonly next: GroundProjection;
}): Camera => {
  const middle = previous.toGround({
    sx: (size.width / 2 - camera.x) / camera.scale,
    sy: (size.height / 2 - camera.y) / camera.scale,
  });

  const scale = (camera.scale * previous.unit) / next.unit;
  const at = next.toScreen(middle);

  return {
    scale,
    x: size.width / 2 - at.sx * scale,
    y: size.height / 2 - at.sy * scale,
  };
};

/** Zooms `camera` by `factor` around the screen point `at`, within limits. */
const zoomed = ({
  camera,
  factor,
  at,
  limits,
}: {
  readonly camera: Camera;
  readonly factor: number;
  readonly at: { readonly x: number; readonly y: number };
  readonly limits: { readonly min: number; readonly max: number };
}): Camera => {
  const scale = Math.min(
    Math.max(camera.scale * factor, limits.min),
    limits.max
  );

  const applied = scale / camera.scale;

  return {
    scale,
    x: at.x - (at.x - camera.x) * applied,
    y: at.y - (at.y - camera.y) * applied,
  };
};

const wheelZoomFactor = (event: WheelEvent) => {
  const lines = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : 1;
  const pixels = event.deltaY * lines;
  // Trackpad pinches arrive as wheel events with ctrlKey set and small deltas.
  const rate = event.ctrlKey ? 0.01 : 0.0015;

  return Math.exp(-pixels * rate);
};

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT");

/**
 * Presses that start on a structure, a packet or a resize handle don't pan,
 * so clicks and drags on them still land.
 */
const startsOnStructure = (target: EventTarget | null) =>
  target instanceof Element &&
  target.closest("[data-structure], [data-packet], [data-resize-handle]") !==
    null;

interface Gestures {
  readonly current: () => Camera;
  readonly limits: () => { readonly min: number; readonly max: number };
  readonly show: (next: Camera) => void;
  readonly zoomBy: (
    factor: number,
    at?: { readonly x: number; readonly y: number }
  ) => void;
}

/**
 * Pans on a drag over empty space, zooms on the wheel or a pinch, and returns
 * a function that stops listening. The listeners go on directly because
 * React's wheel listener is passive, so it can't stop the page scrolling.
 */
const listenForGestures = (svg: SVGSVGElement, gestures: Gestures) => {
  const local = (event: { clientX: number; clientY: number }) => {
    const rect = svg.getBoundingClientRect();

    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const pointers = new Map<number, { x: number; y: number }>();
  let press: { x: number; y: number; camera: Camera } | undefined;
  let dragging = false;
  let pinch: { distance: number; camera: Camera } | undefined;

  const pinchSpan = () => {
    const [a, b] = [...pointers.values()];

    return a === undefined || b === undefined
      ? undefined
      : {
          distance: Math.hypot(a.x - b.x, a.y - b.y),
          centre: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        };
  };

  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    gestures.zoomBy(wheelZoomFactor(event), local(event));
  };

  const onPointerDown = (event: PointerEvent) => {
    // Every press starts fresh. A touch pan fires no click, so waiting for
    // one to clear the flag would swallow the next real click.
    dragging = false;

    if (event.button !== 0) {
      return;
    }

    pointers.set(event.pointerId, local(event));

    if (pointers.size === 2) {
      const span = pinchSpan();

      press = undefined;
      pinch =
        span === undefined
          ? undefined
          : { distance: span.distance, camera: gestures.current() };
    } else if (!startsOnStructure(event.target) && !event.shiftKey) {
      // A Shift-drag on empty space draws a selection box instead.
      press = { ...local(event), camera: gestures.current() };
    }
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!pointers.has(event.pointerId)) {
      return;
    }

    const at = local(event);

    pointers.set(event.pointerId, at);

    if (pinch !== undefined) {
      const span = pinchSpan();

      if (span !== undefined && pinch.distance > 0) {
        gestures.show(
          zoomed({
            camera: pinch.camera,
            factor: span.distance / pinch.distance,
            at: span.centre,
            limits: gestures.limits(),
          })
        );
      }

      return;
    }

    if (press === undefined) {
      return;
    }

    const dx = at.x - press.x;
    const dy = at.y - press.y;

    if (!dragging && Math.hypot(dx, dy) < dragThreshold) {
      return;
    }

    // Capture only once it's a drag, so a plain click keeps its target.
    if (!dragging) {
      dragging = true;
      svg.setPointerCapture(event.pointerId);
    }

    gestures.show({
      ...press.camera,
      x: press.camera.x + dx,
      y: press.camera.y + dy,
    });
  };

  const onPointerUp = (event: PointerEvent) => {
    pointers.delete(event.pointerId);

    if (pointers.size < 2) {
      pinch = undefined;
    }

    if (pointers.size === 0) {
      press = undefined;
    }
  };

  // A mouse drag ends with a click on whatever is under the pointer; swallow
  // it.
  const onClick = (event: MouseEvent) => {
    if (dragging) {
      dragging = false;
      event.stopPropagation();
      event.preventDefault();
    }
  };

  svg.addEventListener("wheel", onWheel, { passive: false });
  svg.addEventListener("pointerdown", onPointerDown);
  svg.addEventListener("pointermove", onPointerMove);
  svg.addEventListener("pointerup", onPointerUp);
  svg.addEventListener("pointercancel", onPointerUp);
  svg.addEventListener("click", onClick, { capture: true });

  return () => {
    svg.removeEventListener("wheel", onWheel);
    svg.removeEventListener("pointerdown", onPointerDown);
    svg.removeEventListener("pointermove", onPointerMove);
    svg.removeEventListener("pointerup", onPointerUp);
    svg.removeEventListener("pointercancel", onPointerUp);
    svg.removeEventListener("click", onClick, { capture: true });
  };
};

/**
 * An SVG canvas you can pan and zoom. It fits `fit` to its size on first
 * draw, when `fitKey` changes, when it's resized and when the engineer asks.
 * Other changes to `fit`, such as a moved structure, keep the current zoom
 * and pan; the next fit uses the new bounds. Drag on empty space
 * to pan (Shift-drag is left to the selection box); the wheel or a pinch zooms; `+`, `-` and `0` zoom in, out and to
 * fit. The camera lives in a transform on one group, so panning doesn't
 * re-render `children`. When `ground` changes to another view's projection,
 * the ground point in the middle stays in the middle, and a grid unit keeps
 * its length on screen. `onTextZoom` hears the zoom the text should be
 * sized for (see `textZoomOf`) whenever it changes step.
 */
export function Viewport({
  fit = emptyBounds,
  fitAt,
  fitKey = "",
  fitFloor = noFloor,
  onTextZoom,
  ground,
  title,
  children,
}: {
  readonly fit?: Bounds | undefined;
  /**
   * The bounds to fit when the drawing is shown at a zoom, for a drawing
   * whose text grows as it zooms out. Takes the place of `fit`.
   */
  readonly fitAt?: ((zoom: number) => Bounds | undefined) | undefined;
  /** Names what `fit` holds, such as a chapter. A new key refits the view. */
  readonly fitKey?: string;
  /**
   * The zoom to fit at, given the zoom that fits `fit`: the same or larger.
   * Defaults to the zoom that fits.
   */
  readonly fitFloor?: (scale: number) => number;
  /** Called with the zoom text is sized for, each time it changes. */
  readonly onTextZoom?: ((zoom: number) => void) | undefined;
  /** How the drawing projects the ground, to keep the middle on a switch. */
  readonly ground?: GroundProjection | undefined;
  readonly title: string;
  readonly children: ReactNode;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const worldRef = useRef<SVGGElement>(null);
  const camera = useRef<Camera>({ scale: 1, x: 0, y: 0 });
  const fitScale = useRef(1);
  const titleId = useId();
  const boundsAt = useRef((zoom: number) => fitAt?.(zoom) ?? fit);
  const floor = useRef(fitFloor);
  const textZoom = useRef<number | undefined>(undefined);

  useLayoutEffect(() => {
    boundsAt.current = (zoom: number) => fitAt?.(zoom) ?? fit;
    floor.current = fitFloor;
  });

  const hearTextZoom = useRef(onTextZoom);

  useLayoutEffect(() => {
    hearTextZoom.current = onTextZoom;
  });

  const show = useCallback((next: Camera) => {
    camera.current = next;
    worldRef.current?.setAttribute(
      "transform",
      `translate(${next.x} ${next.y}) scale(${next.scale})`
    );

    if (svgRef.current !== null) {
      svgRef.current.dataset.scale = String(next.scale);
    }

    const zoom = textZoomOf(next.scale);

    if (zoom !== textZoom.current) {
      textZoom.current = zoom;
      hearTextZoom.current?.(zoom);
    }
  }, []);

  const zoomToFit = useCallback(() => {
    const svg = svgRef.current;

    if (svg === null) {
      return;
    }

    const next = fitted({
      boundsAt: boundsAt.current,
      size: { width: svg.clientWidth, height: svg.clientHeight },
      floor: floor.current,
    });

    fitScale.current = next.scale;
    show(next);
  }, [show]);

  const zoomBy = useCallback(
    (factor: number, at?: { readonly x: number; readonly y: number }) => {
      const svg = svgRef.current;

      if (svg === null) {
        return;
      }

      const centre = at ?? { x: svg.clientWidth / 2, y: svg.clientHeight / 2 };

      show(
        zoomed({
          camera: camera.current,
          factor,
          at: centre,
          limits: limitsFor(fitScale.current),
        })
      );
    },
    [show]
  );

  const fittedFor = useRef<string | undefined>(undefined);
  const projectedBy = useRef(ground);

  // Keep the middle before the first paint in the new projection. A new
  // chapter in the same render refits anyway, below.
  useLayoutEffect(() => {
    const previous = projectedBy.current;
    const svg = svgRef.current;

    projectedBy.current = ground;

    if (
      previous === undefined ||
      ground === undefined ||
      previous === ground ||
      svg === null
    ) {
      return;
    }

    const next = reprojected({
      camera: camera.current,
      size: { width: svg.clientWidth, height: svg.clientHeight },
      previous,
      next: ground,
    });

    fitScale.current = (fitScale.current * previous.unit) / ground.unit;
    show(next);
  }, [ground, show]);

  // Fit before the first paint, and again when the key changes.
  useLayoutEffect(() => {
    if (fittedFor.current !== fitKey) {
      fittedFor.current = fitKey;
      zoomToFit();
    }
  }, [fitKey, zoomToFit]);

  useEffect(() => {
    const observer = new ResizeObserver(zoomToFit);

    if (svgRef.current !== null) {
      observer.observe(svgRef.current);
    }

    return () => {
      observer.disconnect();
    };
  }, [zoomToFit]);

  useEffect(() => {
    const svg = svgRef.current;

    return svg === null
      ? undefined
      : listenForGestures(svg, {
          current: () => camera.current,
          limits: () => limitsFor(fitScale.current),
          show,
          zoomBy,
        });
  }, [show, zoomBy]);

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (
      event.defaultPrevented ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      isTyping(event.target)
    ) {
      return;
    }

    if (event.key === "+" || event.key === "=") {
      zoomBy(zoomStep);
    } else if (event.key === "-" || event.key === "_") {
      zoomBy(1 / zoomStep);
    } else if (event.key === "0") {
      zoomToFit();
    } else {
      return;
    }

    event.preventDefault();
  });

  useEffect(() => {
    globalThis.addEventListener("keydown", onKeyDown);

    return () => {
      globalThis.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return (
    <div className="relative size-full">
      <svg
        ref={svgRef}
        aria-labelledby={titleId}
        className="text-ink block size-full cursor-grab touch-none select-none active:cursor-grabbing"
      >
        <title id={titleId}>{title}</title>
        <g ref={worldRef} data-viewport="">
          {children}
        </g>
      </svg>
      <div className="absolute right-3 bottom-3 flex gap-1.5 font-mono">
        <button
          type="button"
          className={controlClass}
          aria-label="Zoom in"
          title="Zoom in (+)"
          onClick={() => {
            zoomBy(zoomStep);
          }}
        >
          +
        </button>
        <button
          type="button"
          className={controlClass}
          aria-label="Zoom out"
          title="Zoom out (-)"
          onClick={() => {
            zoomBy(1 / zoomStep);
          }}
        >
          −
        </button>
        <button
          type="button"
          className={controlClass}
          title="Zoom to fit (0)"
          onClick={zoomToFit}
        >
          Zoom to fit
        </button>
      </div>
    </div>
  );
}
