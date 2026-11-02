import { groundProjections } from "@axonometric/contracts";
import type {
  GridPoint,
  Placement,
  ScreenPoint,
  ScreenRect,
  View,
} from "@axonometric/contracts";
import { Array as Arr, Option } from "effect";

/** A side of a footprint, by compass point on the ground grid. */
export type Side = "north" | "east" | "south" | "west";

export const sides: readonly Side[] = ["north", "east", "south", "west"];

/** How far an edge handle reaches from its centre, in drawing units. */
export const handleRadius = 5;

/** The air kept between a handle and any text, in drawing units. */
const air = 3;

/** Where along a side a handle tries to sit: the middle, then either quarter. */
const shares: readonly number[] = [0.5, 0.25, 0.75];

/** The ground point at `share` of the way along `side` of `placement`. */
const pointOn = (
  { x, y, w, d }: Placement,
  side: Side,
  share: number
): GridPoint => {
  if (side === "north") {
    return { x: x + w * share, y };
  }

  if (side === "south") {
    return { x: x + w * share, y: y + d };
  }

  return side === "west"
    ? { x, y: y + d * share }
    : { x: x + w, y: y + d * share };
};

const reach = handleRadius + air;

const touches = (at: ScreenPoint, rect: ScreenRect): boolean =>
  at.sx + reach > rect.left &&
  at.sx - reach < rect.right &&
  at.sy + reach > rect.top &&
  at.sy - reach < rect.bottom;

/** One handle: the side it is on, and where it is drawn. */
export interface EdgeSpot {
  readonly side: Side;
  readonly at: ScreenPoint;
  /** The ground point it sits on. */
  readonly ground: GridPoint;
}

/**
 * Where the edge handles of a footprint go: one per side, at the middle of
 * the side, or a quarter along it when the middle is within reach of text.
 * A side with no clear spot has no handle, since the structure's panel and
 * menu offer "Draw hop from here". `texts` are the boxes of every name tag,
 * code chip and hop label drawn.
 */
export const edgeSpots = ({
  placement,
  view,
  texts,
}: {
  readonly placement: Placement;
  readonly view: View;
  readonly texts: readonly ScreenRect[];
}): readonly EdgeSpot[] => {
  const projection = groundProjections[view];

  return Arr.flatMap(sides, (side): readonly EdgeSpot[] =>
    Option.match(
      Arr.findFirst(
        Arr.map(shares, (share): EdgeSpot => {
          const ground = pointOn(placement, side, share);

          return { side, at: projection.toScreen(ground), ground };
        }),
        ({ at }) => !Arr.some(texts, (rect) => touches(at, rect))
      ),
      { onNone: () => [], onSome: (spot) => [spot] }
    )
  );
};

/** The pieces of a scene that carry text: name tags, code chips and hop labels. */
export interface Texted {
  readonly structures: readonly {
    readonly tag: ScreenRect;
    readonly chip: ScreenRect | undefined;
  }[];
  readonly hops: readonly { readonly label: ScreenRect | undefined }[];
}

/** The box of every name tag, code chip and hop label a scene draws. */
export const textBoxesOf = (scene: Texted): readonly ScreenRect[] => [
  ...Arr.map(scene.structures, ({ tag }) => tag),
  ...Arr.flatMap(scene.structures, ({ chip }) =>
    chip === undefined ? [] : [chip]
  ),
  ...Arr.flatMap(scene.hops, ({ label }) =>
    label === undefined ? [] : [label]
  ),
];
