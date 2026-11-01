import { groundProjections } from "@axonometric/contracts";
import type { GridPoint, View } from "@axonometric/contracts";

/**
 * Maps a pointer to the ground: through the viewport's transform into
 * drawing units, then through the view's inverse projection.
 */
export const groundAt = ({
  element,
  event,
  view,
}: {
  readonly element: SVGGraphicsElement;
  readonly event: { readonly clientX: number; readonly clientY: number };
  readonly view: View;
}): GridPoint | undefined => {
  const matrix = element.getScreenCTM();

  if (matrix === null) {
    return undefined;
  }

  const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(
    matrix.inverse()
  );

  return groundProjections[view].toGround({ sx: point.x, sy: point.y });
};
