/** A box on screen, in pixels. */
export interface Box {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** The gap between the tooltip and the box it describes, in pixels. */
const gap = 10;

/** The gap the tooltip keeps from the canvas's edges, in pixels. */
const edge = 4;

const overlap = (a: Box, b: Box) =>
  Math.max(
    0,
    Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left)
  ) *
  Math.max(
    0,
    Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top)
  );

const clamp = (value: number, low: number, high: number) =>
  Math.max(low, Math.min(value, high));

/**
 * Where to put a tooltip of `size` for the structure drawn in `target`,
 * inside `canvas`, covering as little of the other structures and name tags
 * as it can. It tries above the structure, then below, then right and left.
 * Above and below, it tries centred on `pointerX`, then lined up with the
 * structure's left and right edges. Each spot is clamped to the canvas, and
 * the first that covers the least wins.
 */
export const tooltipPlacement = ({
  canvas,
  target,
  others,
  tags,
  size,
  pointerX,
}: {
  readonly canvas: Box;
  readonly target: Box;
  /** Other structures' boxes. */
  readonly others: readonly Box[];
  /** Name tags, which matter half as much as structures. */
  readonly tags: readonly Box[];
  readonly size: { readonly width: number; readonly height: number };
  readonly pointerX: number;
}): { readonly left: number; readonly top: number } => {
  const middleY = target.top + target.height / 2 - size.height / 2;
  const centredX = pointerX - size.width / 2;

  const above = target.top - gap - size.height;
  const below = target.top + target.height + gap;
  const alignedLeft = target.left;
  const alignedRight = target.left + target.width - size.width;

  const spots = [
    ...[centredX, alignedLeft, alignedRight].map((left) => ({
      left,
      top: above,
    })),
    ...[centredX, alignedLeft, alignedRight].map((left) => ({
      left,
      top: below,
    })),
    { left: target.left + target.width + gap, top: middleY },
    { left: target.left - gap - size.width, top: middleY },
  ];

  const clamped = spots.map((spot) => ({
    left: clamp(
      spot.left,
      canvas.left + edge,
      canvas.left + canvas.width - size.width - edge
    ),
    top: clamp(
      spot.top,
      canvas.top + edge,
      canvas.top + canvas.height - size.height - edge
    ),
  }));

  const cost = (spot: { readonly left: number; readonly top: number }) => {
    const box = { ...spot, ...size };

    // Covering the hovered structure itself is worse than covering another.
    return (
      overlap(box, target) * 2 +
      others.reduce((sum, other) => sum + overlap(box, other), 0) +
      tags.reduce((sum, tag) => sum + overlap(box, tag) / 2, 0)
    );
  };

  let best = clamped[0] ?? { left: canvas.left + edge, top: canvas.top + edge };

  for (const spot of clamped) {
    if (cost(spot) < cost(best)) {
      best = spot;
    }
  }

  return best;
};
