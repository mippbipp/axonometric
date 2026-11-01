import type { ReactNode } from "react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef } from "react";

import type { Bounds } from "./bounds.ts";

interface View {
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

/** How far a press may move before it counts as a drag, in pixels. */
const dragThreshold = 4;

/** How much one press of + or - zooms. */
const zoomStep = 1.25;

const emptyBounds: Bounds = { minX: -1, minY: -1, maxX: 1, maxY: 1 };

const fitted = (bounds: Bounds, size: Size): View => {
  const width = Math.max(bounds.maxX - bounds.minX, 1);
  const height = Math.max(bounds.maxY - bounds.minY, 1);

  const scale = Math.max(
    Math.min(
      (size.width - fitPadding * 2) / width,
      (size.height - fitPadding * 2) / height
    ),
    0.01
  );

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

/** Zooms `view` by `factor` around the screen point `at`, within limits. */
const zoomed = ({
  view,
  factor,
  at,
  limits,
}: {
  readonly view: View;
  readonly factor: number;
  readonly at: { readonly x: number; readonly y: number };
  readonly limits: { readonly min: number; readonly max: number };
}): View => {
  const scale = Math.min(Math.max(view.scale * factor, limits.min), limits.max);
  const applied = scale / view.scale;

  return {
    scale,
    x: at.x - (at.x - view.x) * applied,
    y: at.y - (at.y - view.y) * applied,
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

/** Presses that start on a structure don't pan, so clicks on it still land. */
const startsOnStructure = (target: EventTarget | null) =>
  target instanceof Element && target.closest("[data-structure]") !== null;

interface Gestures {
  readonly current: () => View;
  readonly limits: () => { readonly min: number; readonly max: number };
  readonly show: (next: View) => void;
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
  let press: { x: number; y: number; view: View } | undefined;
  let dragging = false;
  let pinch: { distance: number; view: View } | undefined;

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
          : { distance: span.distance, view: gestures.current() };
    } else if (!startsOnStructure(event.target)) {
      press = { ...local(event), view: gestures.current() };
      dragging = false;
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
            view: pinch.view,
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
      ...press.view,
      x: press.view.x + dx,
      y: press.view.y + dy,
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

  // A drag ends with a click on whatever is under the pointer; swallow it.
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

const controlClass =
  "border-ink bg-paper text-ink hover:bg-face focus-visible:outline-ink h-7 min-w-7 border-2 px-2 text-xs shadow-hard focus-visible:outline-2 focus-visible:outline-offset-2 active:translate-px active:shadow-none";

/**
 * An SVG canvas you can pan and zoom. It fits `fit` to its size on first
 * draw, whenever `fit` changes and whenever it's resized. Drag on empty space
 * to pan; the wheel or a pinch zooms; `+`, `-` and `0` zoom in, out and to
 * fit. The view lives in a transform on one group, so panning doesn't
 * re-render `children`.
 */
export function Viewport({
  fit = emptyBounds,
  title,
  children,
}: {
  readonly fit?: Bounds | undefined;
  readonly title: string;
  readonly children: ReactNode;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const worldRef = useRef<SVGGElement>(null);
  const view = useRef<View>({ scale: 1, x: 0, y: 0 });
  const fitScale = useRef(1);
  const titleId = useId();
  const { minX, minY, maxX, maxY } = fit;

  const show = useCallback((next: View) => {
    view.current = next;
    worldRef.current?.setAttribute(
      "transform",
      `translate(${next.x} ${next.y}) scale(${next.scale})`
    );

    if (svgRef.current !== null) {
      svgRef.current.dataset.scale = String(next.scale);
    }
  }, []);

  const zoomToFit = useCallback(() => {
    const svg = svgRef.current;

    if (svg === null) {
      return;
    }

    const next = fitted(
      { minX, minY, maxX, maxY },
      { width: svg.clientWidth, height: svg.clientHeight }
    );

    fitScale.current = next.scale;
    show(next);
  }, [minX, minY, maxX, maxY, show]);

  const zoomBy = useCallback(
    (factor: number, at?: { readonly x: number; readonly y: number }) => {
      const svg = svgRef.current;

      if (svg === null) {
        return;
      }

      const centre = at ?? { x: svg.clientWidth / 2, y: svg.clientHeight / 2 };

      show(
        zoomed({
          view: view.current,
          factor,
          at: centre,
          limits: limitsFor(fitScale.current),
        })
      );
    },
    [show]
  );

  // Fit before the first paint, and again when the bounds change.
  useLayoutEffect(zoomToFit, [zoomToFit]);

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
          current: () => view.current,
          limits: () => limitsFor(fitScale.current),
          show,
          zoomBy,
        });
  }, [show, zoomBy]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
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
    };

    globalThis.addEventListener("keydown", onKeyDown);

    return () => {
      globalThis.removeEventListener("keydown", onKeyDown);
    };
  }, [zoomBy, zoomToFit]);

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
      <div className="absolute right-4 bottom-4 flex gap-2 font-mono">
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
