import { sceneClashes, sceneOf, textGrowthAt } from "@axonometric/contracts";
import type { Scene, SceneSource } from "@axonometric/contracts";
import { Array as Arr, String as Str } from "effect";
import { dual } from "effect/Function";

// The scene places text at the size it's drawn, so the page computes a scene
// for the zoom it shows. Zoom changes every frame of a pinch, so the zoom
// the text is sized for moves in steps: it's the zoom rounded down to the
// nearest of `textZooms`, so text never draws smaller than its minimum.

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
      1e-9
  );

  return fullSize / textZoomStep ** steps;
};

/** The zooms text is sized for, from `from` up to 1, largest first. */
const textZoomsFrom = (from: number) => {
  const zooms: number[] = [];

  for (let zoom = fullSize; zoom >= textZoomOf(from); zoom /= textZoomStep) {
    zooms.push(zoom);
  }

  return zooms;
};

/** Whether a clash puts a name tag over another tag or over a box. */
const tagClash = ({
  between,
}: {
  readonly between: readonly [string, string];
}) => {
  const tags = Arr.filter(between, Str.startsWith("tag:")).length;
  const boxes = Arr.filter(between, Str.startsWith("box:")).length;

  return tags === 2 || (tags === 1 && boxes === 1);
};

/** The name tag clashes in `source`'s scene at `zoom`, as keys. */
const tagClashesAt = (source: SceneSource, zoom: number) => {
  const scene = sceneOf({ ...source, zoom, tagsOnly: true });
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
  const zooms = textZoomsFrom(fitScale);
  let floor = fullSize;

  for (const zoom of zooms) {
    if (!clear(zoom)) {
      break;
    }

    floor = zoom;
  }

  return Math.max(fitScale, floor);
});

/** How much each kind of text grows at view zoom `zoom`, for the CSS. */
export const growthAt = (zoom: number) => textGrowthAt(textZoomOf(zoom));

/**
 * Scenes by what they're drawn from and the zoom their text is sized for.
 * The page keeps the same data, layout, revealed set and routes objects
 * until they change, so they key a cache the garbage collector clears.
 */
const sceneCache = new WeakMap<
  object,
  WeakMap<object, WeakMap<object, Map<string, Scene>>>
>();

/** `sceneOf(source)`, cached by its inputs. */
export const sceneAtZoom = (source: SceneSource): Scene => {
  const byLayout = sceneCache.get(source.data) ?? new WeakMap();
  const byRevealed = byLayout.get(source.layout) ?? new WeakMap();
  const byKey = byRevealed.get(source.revealed) ?? new Map<string, Scene>();

  sceneCache.set(source.data, byLayout);
  byLayout.set(source.layout, byRevealed);
  byRevealed.set(source.revealed, byKey);

  const key = Arr.join(
    [
      source.view ?? "iso",
      String(source.zoom ?? 1),
      Arr.join(source.labelFirst ?? [], ","),
    ],
    "|"
  );

  const cached = byKey.get(key);

  if (cached !== undefined) {
    return cached;
  }

  const made = sceneOf(source);

  byKey.set(key, made);

  return made;
};
