import { gapAt, groundProjections } from "@axonometric/contracts";
import type {
  GridPoint,
  Placement,
  ScreenPoint,
  ScreenRect,
  View,
} from "@axonometric/contracts";
import { Array as Arr, Option } from "effect";

import type { SceneFacts } from "./editor-view.ts";

/** A side of a footprint, by compass point on the ground grid. */
export type Side = "north" | "east" | "south" | "west";

export const sides: readonly Side[] = ["north", "east", "south", "west"];

/** How far an edge handle reaches from its centre, in drawing units. */
export const handleRadius = 5;

/** The width of a handle's outline, in drawing units. */
export const handleStroke = 1.5;

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

/**
 * How far a handle's centre must be from a text box on every side: the
 * handle's radius and half its outline, then the gap every editing mark keeps
 * from what it clears, which is at least `minScreenGap` screen pixels at the
 * zoom the scene is drawn for (see `gapAt`).
 */
const reachAt = (zoom: number) => handleRadius + handleStroke / 2 + gapAt(zoom);

const touches = ({
  at,
  rect,
  reach,
}: {
  readonly at: ScreenPoint;
  readonly rect: ScreenRect;
  readonly reach: number;
}): boolean =>
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
  zoom,
}: {
  readonly placement: Placement;
  readonly view: View;
  readonly texts: readonly ScreenRect[];
  /** The zoom the scene's text is sized for. */
  readonly zoom: number;
}): readonly EdgeSpot[] => {
  const projection = groundProjections[view];
  const reach = reachAt(zoom);

  return Arr.flatMap(sides, (side): readonly EdgeSpot[] =>
    Option.match(
      Arr.findFirst(
        Arr.map(shares, (share): EdgeSpot => {
          const ground = pointOn(placement, side, share);

          return { side, at: projection.toScreen(ground), ground };
        }),
        ({ at }) => !Arr.some(texts, (rect) => touches({ at, rect, reach }))
      ),
      { onNone: () => [], onSome: (spot) => [spot] }
    )
  );
};

/** The pieces of a scene the editing layers keep clear of. */
export interface Drawn {
  readonly zoom: number;
  readonly structures: readonly {
    readonly tag: ScreenRect;
    readonly chip: ScreenRect | undefined;
    readonly outline: readonly ScreenPoint[];
  }[];
  readonly hops: readonly { readonly label: ScreenRect | undefined }[];
}

/** What a scene drew, for `EditorSceneContext`. */
export const sceneFactsOf = (scene: Drawn): SceneFacts => ({
  zoom: scene.zoom,
  outlines: Arr.map(scene.structures, ({ outline }) => outline),
  texts: [
    ...Arr.map(scene.structures, ({ tag }) => tag),
    ...Arr.flatMap(scene.structures, ({ chip }) =>
      chip === undefined ? [] : [chip]
    ),
    ...Arr.flatMap(scene.hops, ({ label }) =>
      label === undefined ? [] : [label]
    ),
  ],
});

/** The scenes `sceneFactsOf` has read, so a scene gives the same facts each time. */
const factsCache = new WeakMap<object, SceneFacts>();

/**
 * `sceneFactsOf(scene)`, the same object for the same scene. The page keeps a
 * scene until the map, the layout or the zoom changes, so the layers that
 * read the facts redraw only then.
 */
export const stableFactsOf = (scene: Drawn & object): SceneFacts => {
  const cached = factsCache.get(scene);

  if (cached !== undefined) {
    return cached;
  }

  const made = sceneFactsOf(scene);

  factsCache.set(scene, made);

  return made;
};
