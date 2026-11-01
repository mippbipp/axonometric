import { Array as Arr } from "effect";
import { dual } from "effect/Function";

import { tiny } from "./geometry.ts";
import { sceneClashes, tagScene } from "./scene.ts";
import type { SceneClash, SceneSource } from "./scene.ts";

// The scene places text at the size it's drawn, so a page computes a scene
// for the zoom it shows. Zoom changes every frame of a pinch, so the zoom
// text is sized for moves in steps: the zoom rounded down to a step, so
// text never draws smaller than its minimum.

/** How far apart, as a ratio, the zooms text is sized for are. */
const textZoomStep = 1.1;

/** The zoom at and above which text draws at its own size. */
const fullSize = 1;

/** The smallest zoom text is ever sized for. */
const smallestTextZoom = 0.05;

/**
 * The zoom text is sized for at view zoom `zoom`: 1 at and above it, else
 * the largest of 1, 1 / 1.1, 1 / 1.1² … at or below `zoom`. Text sized for
 * that zoom draws at least at its minimum.
 */
export const textZoomOf = (zoom: number) => {
  if (zoom >= fullSize) {
    return fullSize;
  }

  const steps = Math.ceil(
    Math.log(fullSize / Math.max(zoom, smallestTextZoom)) /
      Math.log(textZoomStep) -
      tiny
  );

  return fullSize / textZoomStep ** steps;
};

/** The zooms text is sized for, from 1 down to the one for `from`. */
const textZoomsFrom = (from: number) => {
  const zooms: number[] = [];

  for (let zoom = fullSize; zoom >= textZoomOf(from); zoom /= textZoomStep) {
    zooms.push(zoom);
  }

  return zooms;
};

/** Whether a clash puts a name tag over another tag or over a box. */
const tagClash = ({ parts: [first, second] }: SceneClash) =>
  (first.kind === "tag" && (second.kind === "tag" || second.kind === "box")) ||
  (first.kind === "box" && second.kind === "tag");

/** The name tag clashes in `source`'s bare scene at `zoom`, as keys. */
const tagClashesAt = (source: SceneSource, zoom: number) => {
  const scene = tagScene({ ...source, zoom });
  const clashes = Arr.filter(sceneClashes(scene), tagClash);

  return new Set(Arr.map(clashes, ({ between }) => Arr.join(between, " × ")));
};

/**
 * The zoom zoom to fit uses for `source`'s drawing, given the zoom
 * `fitScale` that fits: the same, unless its name tags, placed at the size
 * they're drawn at that zoom, overlap each other or a box where they don't
 * at full size. Then it's the smallest zoom text is sized for at which they
 * don't, so the engineer pans for the rest. Hop labels, chips and zone
 * titles never stop it: they hide where they don't fit.
 *
 * Clashes the drawing already has at full size don't count: `check`
 * warns about those, and no text size makes them worse.
 */
export const fitFloorOf: {
  (fitScale: number): (source: SceneSource) => number;
  (source: SceneSource, fitScale: number): number;
} = dual(2, (source: SceneSource, fitScale: number): number => {
  const atFullSize = tagClashesAt(source, fullSize);

  const clear = (zoom: number) =>
    Arr.every([...tagClashesAt(source, zoom)], (clash) =>
      atFullSize.has(clash)
    );

  if (clear(textZoomOf(fitScale))) {
    return fitScale;
  }

  // Tags only grow as the zoom falls, so once they clash they keep clashing.
  let floor = fullSize;

  for (const zoom of textZoomsFrom(fitScale)) {
    if (!clear(zoom)) {
      break;
    }

    floor = zoom;
  }

  return Math.max(fitScale, floor);
});
