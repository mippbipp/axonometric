import { Array as Arr, Option, Order } from "effect";

import { clipToConvex, rectPolygon } from "./geometry.ts";
import type { Segment } from "./geometry.ts";
import { groundOutline } from "./ground-outline.ts";
import type { ScreenPoint, ScreenRect } from "./iso.ts";
import type { Placement } from "./layout.ts";
import type { GroundProjection } from "./plan.ts";

/** How much room the cross keeps from text, in screen units. */
const clearance = 2;

/** `rect` grown by `by` on every side. */
const grown = (rect: ScreenRect, by: number): ScreenRect => ({
  left: rect.left - by,
  top: rect.top - by,
  right: rect.right + by,
  bottom: rect.bottom + by,
});

/** The share of the segment between `from` and `to`, 0 at its start and 1 at its end. */
interface Share {
  readonly from: number;
  readonly to: number;
}

const byStart = Order.mapInput(Order.Number, (share: Share) => share.from);

/** The shares from 0 to 1 that `cuts` leave, in order. */
const gapsOutside = (cuts: readonly Share[]): readonly Share[] => {
  let reach = 0;
  const gaps: Share[] = [];

  for (const cut of Arr.sort(cuts, byStart)) {
    if (cut.from > reach) {
      gaps.push({ from: reach, to: cut.from });
    }

    reach = Math.max(reach, cut.to);
  }

  return reach < 1 ? [...gaps, { from: reach, to: 1 }] : gaps;
};

/** The parts of `segment` that lie outside the convex `holes`. */
const without = (
  segment: Segment,
  holes: readonly (readonly ScreenPoint[])[]
): readonly Segment[] => {
  const cuts = Arr.flatMap(holes, (hole) =>
    Option.toArray(Option.fromNullishOr(clipToConvex(segment, hole)))
  );

  const at = (share: number): ScreenPoint => ({
    sx: segment.start.sx + (segment.end.sx - segment.start.sx) * share,
    sy: segment.start.sy + (segment.end.sy - segment.start.sy) * share,
  });

  return Arr.map(gapsOutside(cuts), ({ from, to }) => ({
    start: at(from),
    end: at(to),
  }));
};

/**
 * The cross struck through a footprint: its two diagonals on the ground,
 * with every stretch inside a text box cut out. `text` holds the structure's
 * code chip and name tag, and any other text that stands on the box, so the
 * cross never crosses a letter and the text stays readable.
 */
export const strikeSegments = ({
  placement,
  ground,
  text,
}: {
  readonly placement: Placement;
  readonly ground: GroundProjection;
  /** The boxes of the text on the structure; `undefined` ones are left out. */
  readonly text: readonly (ScreenRect | undefined)[];
}): readonly Segment[] => {
  const [a, b, c, d] = groundOutline(placement, ground);

  if (
    a === undefined ||
    b === undefined ||
    c === undefined ||
    d === undefined
  ) {
    return [];
  }

  const holes = Arr.flatMap(text, (rect) =>
    rect === undefined ? [] : [rectPolygon(grown(rect, clearance))]
  );

  return [
    ...without({ start: a, end: c }, holes),
    ...without({ start: b, end: d }, holes),
  ];
};
