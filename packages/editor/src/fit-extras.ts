// oxlint-disable effecttsgo/missing-pipeable-signature -- called with its arguments in hand, never piped.
import { groundOutline, groundProjections } from "@axonometric/contracts";
import type {
  GridPoint,
  NoteBearers,
  Placement,
  Scene,
  ScreenPoint,
} from "@axonometric/contracts";

import { spotRingCorners } from "./note-bearers.ts";

/**
 * What the page's editing layer adds to Zoom to fit: the notes the markers
 * show, whose spot rings count, and the footprint the add form shows. Plain
 * data, so the page and the scene worker fit alike.
 */
export interface FitExtras {
  /** The new structure's footprint while the add form is open. */
  readonly candidate: Placement | null;
  /** What carries a note, or `null` on a page that can't review. */
  readonly notes: {
    readonly hops: ReadonlyArray<string>;
    readonly spots: ReadonlyArray<GridPoint>;
    readonly structures: ReadonlyArray<string>;
  } | null;
}

export const noFitExtras: FitExtras = { candidate: null, notes: null };

/** `bearers` and `candidate` as `FitExtras`. */
export const fitExtrasOf = (
  bearers: NoteBearers | null,
  candidate: Placement | undefined
): FitExtras => ({
  candidate: candidate ?? null,
  notes:
    bearers === null
      ? null
      : {
          hops: [...bearers.hops],
          spots: bearers.spots,
          structures: [...bearers.structures],
        },
});

/** One bearers object per `FitExtras`, since `placedMarkers` caches by it. */
const bearersOf = new WeakMap<FitExtras, NoteBearers | null>();

const bearersFor = (extras: FitExtras): NoteBearers | null => {
  const known = bearersOf.get(extras);

  if (known !== undefined) {
    return known;
  }

  const made =
    extras.notes === null
      ? null
      : {
          hops: new Set(extras.notes.hops),
          spots: extras.notes.spots,
          structures: new Set(extras.notes.structures),
        };

  bearersOf.set(extras, made);

  return made;
};

/**
 * The extra points `fittedViewOf` counts in `scene` for `extras`: the corners
 * of each empty spot's ring, since a spot can lie far from everything else,
 * and the add form's footprint, so it is never off the canvas.
 */
export const fitExtraPoints = (
  scene: Scene,
  extras: FitExtras
): ReadonlyArray<ScreenPoint> => [
  ...spotRingCorners(scene, bearersFor(extras)),
  ...(extras.candidate === null
    ? []
    : groundOutline(extras.candidate, groundProjections[scene.view])),
];
