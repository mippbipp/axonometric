import { textZoomOf } from "@axonometric/contracts";
import type {
  Camera,
  CanvasSize,
  GroundProjection,
} from "@axonometric/contracts";
import { PannableCanvas } from "@axonometric/ui/components/pannable-canvas";
import type { PannableCanvasApi } from "@axonometric/ui/components/pannable-canvas";
import { WithTooltip } from "@axonometric/ui/components/tooltip";
import type { ReactNode } from "react";
import { useCallback, useLayoutEffect, useRef } from "react";

import { controlClass } from "./control-class.ts";

/** How much one press of + or - zooms. */
const zoomStep = 1.25;

/**
 * Zoom limits. Out to half the fitted scale or half size, whichever is
 * smaller; in to four times the fitted scale or four times real size,
 * whichever is larger.
 */
const limitsFor = (fitScale: number) => ({
  max: Math.max(fitScale, 1) * 4,
  min: Math.min(fitScale, 1) / 2,
});

/**
 * The camera that shows, in `next`'s projection, the ground point `camera` shows
 * in the middle of a canvas of `size` in `previous`'s projection, with a
 * grid unit as long on screen as before.
 */
const reprojected = ({
  camera,
  next,
  previous,
  size,
}: {
  readonly camera: Camera;
  readonly next: GroundProjection;
  readonly previous: GroundProjection;
  readonly size: CanvasSize;
}): Camera => {
  const middle = previous.toGround({
    sx: (size.width / 2 - camera.x) / camera.zoom,
    sy: (size.height / 2 - camera.y) / camera.zoom,
  });

  const scale = (camera.zoom * previous.unit) / next.unit;
  const at = next.toScreen(middle);

  return {
    x: size.width / 2 - at.sx * scale,
    y: size.height / 2 - at.sy * scale,
    zoom: scale,
  };
};

/**
 * Presses that start on a structure, a packet, a resize handle, a segment of
 * a hop's route or a zone's title don't pan, so clicks and drags on them
 * still land. Nor does a Shift press, which draws a selection box.
 */
const claims = (event: PointerEvent) =>
  event.shiftKey ||
  (event.target instanceof Element &&
    event.target.closest(
      "[data-structure], [data-packet], [data-resize-handle], [data-edge-handle], [data-route-segment], [data-zone-title-hit]"
    ) !== null);

/**
 * An SVG canvas you can pan and zoom. It shows the camera `fit` returns for
 * its size on first draw, when `fitKey` changes, when it's resized and when
 * the engineer asks. Other changes, such as a moved structure, keep the
 * current zoom and pan; the next fit uses the new geometry. Drag on empty
 * space to pan (Shift-drag is left to the selection box); the wheel or a
 * pinch zooms; `+`, `-` and `0` zoom in, out and to fit. When `ground`
 * changes to another view's projection, the ground point in the middle stays
 * in the middle, and a grid unit keeps its length on screen. `onTextZoom`
 * hears the zoom the text should be sized for (see `textZoomOf`) whenever it
 * changes step.
 */
export function Viewport({
  children,
  fit,
  fitKey = "",
  ground,
  onTextZoom,
  title,
}: {
  readonly children: ReactNode;
  /** The camera that fits the drawing to a canvas of the given size. */
  readonly fit: (size: CanvasSize) => Camera;
  /** Names what `fit` fits, such as a chapter. A new key refits the view. */
  readonly fitKey?: string;
  /** How the drawing projects the ground, to keep the middle on a switch. */
  readonly ground?: GroundProjection | undefined;
  /** Called with the zoom text is sized for, each time it changes. */
  readonly onTextZoom?: ((zoom: number) => void) | undefined;
  readonly title: string;
}) {
  const canvas = useRef<PannableCanvasApi>(null);
  const textZoom = useRef<number | undefined>(undefined);
  const fittedFor = useRef<string | undefined>(undefined);
  const projectedBy = useRef(ground);

  const hearTextZoom = useRef(onTextZoom);

  useLayoutEffect(() => {
    hearTextZoom.current = onTextZoom;
  });

  const hearCamera = useCallback((camera: Camera) => {
    const zoom = textZoomOf(camera.zoom);

    if (zoom !== textZoom.current) {
      textZoom.current = zoom;
      hearTextZoom.current?.(zoom);
    }
  }, []);

  // Keep the middle before the first paint in the new projection. A new
  // chapter in the same render refits anyway, below.
  useLayoutEffect(() => {
    const previous = projectedBy.current;
    const api = canvas.current;

    projectedBy.current = ground;

    if (
      previous === undefined ||
      ground === undefined ||
      previous === ground ||
      api === null
    ) {
      return;
    }

    api.reframe(
      reprojected({
        camera: api.viewport.get(),
        next: ground,
        previous,
        size: api.size(),
      }),
      (api.fitScale() * previous.unit) / ground.unit
    );
  }, [ground]);

  // Fit before the first paint, and again when the key changes.
  useLayoutEffect(() => {
    if (fittedFor.current !== fitKey) {
      fittedFor.current = fitKey;
      canvas.current?.fit();
    }
  }, [fitKey]);

  const zoomBy = (factor: number, event: Event) => {
    canvas.current?.viewport.zoomBy(factor, undefined, {
      event,
      reason: "zoom-key",
    });
  };

  return (
    <PannableCanvas
      claims={claims}
      controls={
        <>
          <WithTooltip
            control={
              <button
                aria-label="Zoom in"
                className={controlClass}
                onClick={(event) => {
                  zoomBy(zoomStep, event.nativeEvent);
                }}
                type="button"
              >
                +
              </button>
            }
          >
            Zoom in (+)
          </WithTooltip>
          <WithTooltip
            control={
              <button
                aria-label="Zoom out"
                className={controlClass}
                onClick={(event) => {
                  zoomBy(1 / zoomStep, event.nativeEvent);
                }}
                type="button"
              >
                −
              </button>
            }
          >
            Zoom out (-)
          </WithTooltip>
          <WithTooltip
            control={
              <button
                className={controlClass}
                onClick={(event) => {
                  canvas.current?.fit({
                    event: event.nativeEvent,
                    reason: "zoom-key",
                  });
                }}
                type="button"
              >
                Zoom to fit
              </button>
            }
          >
            Zoom to fit (0)
          </WithTooltip>
        </>
      }
      fit={fit}
      limits={limitsFor}
      onCameraChange={hearCamera}
      ref={canvas}
      title={title}
    >
      {children}
    </PannableCanvas>
  );
}
