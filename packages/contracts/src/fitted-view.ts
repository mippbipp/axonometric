import { Array as Arr, Order } from "effect";
import { dual } from "effect/Function";

import type { ChapterStop } from "./chapters.ts";
import { boundsOfPoints, tiny } from "./geometry.ts";
import { isoHeights } from "./iso-heights.ts";
import { corners, tagDrop } from "./iso.ts";
import type { ScreenPoint, ScreenRect } from "./iso.ts";
import type { MapState } from "./map-state.ts";
import type { View } from "./plan.ts";
import { cachedRoutesOf, cachedSceneOf } from "./scene-cache.ts";
import { sceneClashes, tagScene } from "./scene.ts";
import type {
  Scene,
  SceneClash,
  SceneSource,
  SceneStructure,
} from "./scene.ts";

// What Zoom to fit shows is worked out here from the map state, the chapter,
// the view and the canvas size, and the page's viewport only applies the
// camera. The scene places text at the size it's drawn, so a page computes a scene
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
  const zooms: Array<number> = [];

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

/**
 * Where the drawing sits in the canvas: the screen position of the drawing's
 * origin in pixels, and its zoom. These are the numbers ui-sdk's viewport
 * keeps, so a page can hand a camera to it as it is.
 */
export interface Camera {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

/** The size of the canvas, in pixels. */
export interface CanvasSize {
  readonly height: number;
  readonly width: number;
}

/** Space left around what's fitted, in screen pixels. */
export const fitPadding = 48;

/**
 * The most that fitting may zoom in. A chapter with one or two structures
 * would otherwise fill the window at several times real size, with oversized
 * tags. Zooming by hand can still go further.
 */
export const maxFitZoom = 1.5;

/** The smallest zoom fitting returns, however large the drawing. */
const smallestFitZoom = 0.01;

/** How many times a fit re-measures a drawing whose text grows. */
const fitRounds = 4;

/**
 * The zoom that draws something whose text grows as it zooms out. Zoomed
 * out, text grows, so the drawing reaches further and fits at a smaller
 * zoom: `zoomAt(zoom)` is the zoom that fits it drawn for `zoom`. This
 * starts from the zoom that fits at full size and fits again at each zoom
 * it finds, until it settles.
 */
export const settledScale = (zoomAt: (zoom: number) => number) => {
  let scale = zoomAt(1);

  for (let round = 0; round < fitRounds; round += 1) {
    scale = Math.min(scale, zoomAt(scale));
  }

  return scale;
};

/** Something drawn, with the structures it belongs to and the points it reaches. */
export interface Drawn {
  /** The structures it belongs to: one for a structure, two for a hop. */
  readonly ids: ReadonlyArray<string>;
  readonly points: ReadonlyArray<ScreenPoint>;
}

/** The screen points a structure's drawing reaches in `view`, tag included. */
// oxlint-disable-next-line effecttsgo/missing-pipeable-signature -- called with both arguments in hand, never piped.
export const structureExtentOf = (
  view: View,
  { outline, placement, structure, tag }: SceneStructure
): ReadonlyArray<ScreenPoint> => {
  if (view === "plan") {
    return [
      ...outline,
      { sx: tag.left, sy: tag.top },
      { sx: tag.right, sy: tag.bottom },
    ];
  }

  const ground = corners(placement, 0);
  const top = corners(placement, isoHeights[structure.shape]);

  return [
    top.back,
    top.left,
    top.right,
    ground.left,
    ground.right,
    { sx: tag.left, sy: ground.front.sy + tagDrop },
    { sx: tag.right, sy: ground.front.sy + tagDrop },
    // A grown tag may move off the front corner and reach further.
    { sx: tag.left, sy: tag.top },
    { sx: tag.right, sy: tag.bottom },
  ];
};

/** Everything a scene draws, with the structures each belongs to. */
export const drawnIn = (scene: Scene): ReadonlyArray<Drawn> => [
  ...Arr.map(scene.structures, (item) => ({
    ids: [item.structure.id],
    points: structureExtentOf(scene.view, item),
  })),
  ...Arr.map(scene.hops, ({ hop, label, points }) => ({
    ids: [hop.from, hop.to],
    points:
      label === undefined
        ? points
        : [
            ...points,
            { sx: label.left, sy: label.top },
            { sx: label.right, sy: label.bottom },
          ],
  })),
  ...Arr.map(scene.zones, ({ plate, title, zone }) => ({
    ids: zone.members,
    points: [...plate, ...(title ?? [])],
  })),
];

/** The smallest rect holding everything the scene draws. */
export const sceneExtentOf = (scene: Scene): ScreenRect =>
  boundsOfPoints(Arr.flatMap(drawnIn(scene), ({ points }) => points));

/**
 * The key that names a set of structures to fit. It changes when the set
 * does (a new chapter) and not when the geometry does (a moved structure).
 */
export const fitKeyOf = (fitTo: Iterable<string>): string =>
  Arr.join(Arr.sort(Arr.dedupe([...fitTo]), Order.String), "\n");

/** What Zoom to fit is computed from. */
export interface FittedViewSource {
  /** The chapter shown: what it reveals, and the hops it plays. */
  readonly chapter: Pick<ChapterStop, "plays" | "revealed">;
  /**
   * More points that count in the fit at each scene it tries, such as an
   * editing layer's markers. An export's extent leaves them out.
   */
  readonly extra?: ((scene: Scene) => ReadonlyArray<ScreenPoint>) | undefined;
  /** The structures to fit. Defaults to the chapter's revealed ones. */
  readonly fitTo?: ReadonlySet<string> | undefined;
  readonly size: CanvasSize;
  readonly state: Pick<MapState, "data" | "layout">;
  readonly view: View;
}

/** What Zoom to fit shows. */
export interface FittedView {
  readonly camera: Camera;
  /** The scene, with its text sized for the camera's zoom. */
  readonly scene: Scene;
  /** The zoom the scene's text is sized for (see `textZoomOf`). */
  readonly textZoom: number;
}

/** The zoom that fits `box` in `size`, capped at `maxFitZoom`. */
const zoomToFit = (box: ScreenRect, size: CanvasSize) =>
  Math.max(
    Math.min(
      (size.width - fitPadding * 2) / Math.max(box.right - box.left, 1),
      (size.height - fitPadding * 2) / Math.max(box.bottom - box.top, 1),
      maxFitZoom
    ),
    smallestFitZoom
  );

const emptyBox: ScreenRect = { bottom: 1, left: -1, right: 1, top: -1 };

/**
 * What Zoom to fit shows for a chapter in a view: the camera that puts what
 * the chapter reveals in the middle of the canvas, with room round it, no
 * larger than `maxFitZoom` and no smaller than the zoom its name tags need
 * to stay clear; the zoom the text is sized for; and the scene drawn for it.
 *
 * Zoomed out, text grows and the drawing reaches further, so the fit settles
 * on a zoom by drawing at each one it tries (see `settledScale`).
 */
export const fittedViewOf = ({
  chapter,
  extra,
  fitTo = chapter.revealed,
  size,
  state: { data, layout },
  view,
}: FittedViewSource): FittedView => {
  const { revealed } = chapter;
  const routes = cachedRoutesOf({ data, layout, revealed });

  const source: SceneSource = {
    data,
    labelFirst: chapter.plays,
    layout,
    revealed,
    routes,
    view,
  };

  const sceneFor = (zoom: number) =>
    cachedSceneOf({ ...source, zoom: textZoomOf(zoom) });

  const boxAt = (zoom: number): ScreenRect => {
    const scene = sceneFor(zoom);

    const points = [
      ...Arr.flatMap(drawnIn(scene), ({ ids, points: reached }) =>
        Arr.every(ids, (id) => fitTo.has(id)) ? reached : []
      ),
      ...(extra?.(scene) ?? []),
    ];

    return points.length === 0 ? emptyBox : boundsOfPoints(points);
  };

  const zoom = fitFloorOf(
    source,
    settledScale((at) => zoomToFit(boxAt(at), size))
  );

  const box = boxAt(zoom);

  // Centring the box keeps a capped or floored drawing in the middle of the
  // canvas.
  return {
    camera: {
      x: size.width / 2 - ((box.left + box.right) / 2) * zoom,
      y: size.height / 2 - ((box.top + box.bottom) / 2) * zoom,
      zoom,
    },
    scene: sceneFor(zoom),
    textZoom: textZoomOf(zoom),
  };
};
