import { Array as Arr } from "effect";

import type { ScreenPoint, ScreenRect } from "./iso.ts";
import type { Scene } from "./scene.ts";

/**
 * What a scene drew, for the editing layers that must keep clear of it: the
 * box of every name tag, code chip and hop label, the outline of every
 * structure, and the zoom the text is sized for, which turns a gap of screen
 * pixels into drawing units.
 */
export interface SceneFacts {
  readonly outlines: ReadonlyArray<ReadonlyArray<ScreenPoint>>;
  readonly texts: ReadonlyArray<ScreenRect>;
  readonly zoom: number;
}

/** The scenes `sceneFactsOf` has read, so a scene gives the same facts each time. */
const factsCache = new WeakMap<Scene, SceneFacts>();

/**
 * The facts of `scene`, the same object for the same scene. The page keeps a
 * scene until the map, the layout or the zoom changes, so the layers that
 * read the facts redraw only then.
 */
export const sceneFactsOf = (scene: Scene): SceneFacts => {
  const cached = factsCache.get(scene);

  if (cached !== undefined) {
    return cached;
  }

  const made: SceneFacts = {
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
    zoom: scene.zoom,
  };

  factsCache.set(scene, made);

  return made;
};
