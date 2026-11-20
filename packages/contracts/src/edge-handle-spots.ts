import { Array as Arr, Option } from "effect";

import type { ScreenPoint, ScreenRect } from "./iso.ts";
import type { GridPoint, Placement } from "./layout.ts";
import { gapAt } from "./note-markers.ts";
import { groundProjections } from "./plan.ts";
import { sceneFactsOf } from "./scene-facts.ts";
import type { Scene } from "./scene.ts";

/** A side of a footprint, by compass point on the ground grid. */
export type Side = "north" | "east" | "south" | "west";

export const sides: ReadonlyArray<Side> = ["north", "east", "south", "west"];

/** How far an edge handle reaches from its centre, in drawing units. */
export const handleRadius = 5;

/** The width of a handle's outline, in drawing units. */
export const handleStroke = 1.5;

/** Where along a side a handle tries to sit: the middle, then either quarter. */
const shares: ReadonlyArray<number> = [0.5, 0.25, 0.75];

/** The ground point at `share` of the way along `side` of `placement`. */
const pointOn = (
  { d, w, x, y }: Placement,
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

/**
 * How far a handle's centre must be from a text box on every side: the
 * handle's radius and half its outline, then the gap every editing mark keeps
 * from what it clears, which is at least `minScreenGap` screen pixels at the
 * zoom the scene is drawn for (see `gapAt`).
 */
const reachAt = (zoom: number) => handleRadius + handleStroke / 2 + gapAt(zoom);

const touches = ({
  at,
  reach,
  rect,
}: {
  readonly at: ScreenPoint;
  readonly reach: number;
  readonly rect: ScreenRect;
}): boolean =>
  at.sx + reach > rect.left &&
  at.sx - reach < rect.right &&
  at.sy + reach > rect.top &&
  at.sy - reach < rect.bottom;

/**
 * One handle: the structure and side it is on, and where it is drawn. A
 * handle is a port for drawing a hop, so it has a key of its own, and `at` is
 * the point a pointer or keyboard connection snaps to.
 */
export interface EdgeSpot {
  readonly at: ScreenPoint;
  /** The ground point it sits on. */
  readonly ground: GridPoint;
  /** The handle's key, unique on the page: the owner and the side. */
  readonly id: string;
  /** The structure whose edge it is on. */
  readonly owner: string;
  readonly side: Side;
}

/**
 * Where the edge handles of structure `structure` go in `scene`: one per
 * side, at the middle of the side, or a quarter along it when the middle is
 * within reach of a name tag, code chip or hop label. A side with no clear
 * spot has no handle, since the structure's panel and menu offer "Draw hop
 * from here". A structure the scene doesn't draw has none.
 */
export const edgeSpotsOf = ({
  scene,
  structure,
}: {
  readonly scene: Scene;
  readonly structure: string;
}): ReadonlyArray<EdgeSpot> => {
  const drawn = Arr.findFirst(
    scene.structures,
    (item) => item.structure.id === structure
  );

  if (Option.isNone(drawn)) {
    return [];
  }

  const { placement } = drawn.value;
  const { texts, zoom } = sceneFactsOf(scene);
  const projection = groundProjections[scene.view];
  const reach = reachAt(zoom);

  return Arr.flatMap(sides, (side): ReadonlyArray<EdgeSpot> =>
    Option.match(
      Arr.findFirst(
        Arr.map(shares, (share): EdgeSpot => {
          const ground = pointOn(placement, side, share);

          return {
            at: projection.toScreen(ground),
            ground,
            id: `${structure}:${side}`,
            owner: structure,
            side,
          };
        }),
        ({ at }) => !Arr.some(texts, (rect) => touches({ at, reach, rect }))
      ),
      { onNone: () => [], onSome: (spot) => [spot] }
    )
  );
};
