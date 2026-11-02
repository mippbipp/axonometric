// oxlint-disable effecttsgo/missing-pipeable-signature -- these are called with their arguments in hand from components, never piped.

import {
  groundProjections,
  noteMarkerRadius,
  noteMarkerStroke,
  placeNoteMarkers,
} from "@axonometric/contracts";
import type {
  GridPoint,
  NoteBearers,
  PlacedMarkers,
  Scene,
  ScreenPoint,
} from "@axonometric/contracts";
import { Array as Arr } from "effect";
import { useMemo } from "react";

import { entriesOfKind, useReview } from "./review-context.ts";

/**
 * What carries a note on the page now: the structures, hops and empty spots
 * that have one the engineer hasn't dismissed. `null` on a page that can't
 * review. The object is the same until the notes change, which is what
 * `placedMarkers` caches by.
 */
export const useNoteBearers = (): NoteBearers | null => {
  const entries = useReview()?.entries;

  return useMemo((): NoteBearers | null => {
    if (entries === undefined) {
      return null;
    }

    const targets = Arr.map(
      entriesOfKind(entries, "note"),
      ({ item }) => item.target
    );

    const spots: GridPoint[] = [];

    for (const target of targets) {
      if (
        target.kind === "spot" &&
        !Arr.some(spots, ({ x, y }) => x === target.x && y === target.y)
      ) {
        spots.push({ x: target.x, y: target.y });
      }
    }

    return {
      structures: new Set(
        Arr.flatMap(targets, (target) =>
          target.kind === "structure" ? [target.id] : []
        )
      ),
      hops: new Set(
        Arr.flatMap(targets, (target) =>
          target.kind === "hop" ? [target.id] : []
        )
      ),
      spots,
    };
  }, [entries]);
};

const placements = new WeakMap<Scene, WeakMap<NoteBearers, PlacedMarkers>>();

/**
 * `placeNoteMarkers` for `scene`, cached by the scene and the bearers. The
 * page asks for the same placement on every render and for every zoom the fit
 * tries, and a placement tests many candidate spots.
 */
export const placedMarkers = (
  scene: Scene,
  bearers: NoteBearers
): PlacedMarkers => {
  const forScene = placements.get(scene) ?? new WeakMap();
  const cached = forScene.get(bearers);

  if (cached !== undefined) {
    return cached;
  }

  const made = placeNoteMarkers(scene, {
    ...bearers,
    ground: groundProjections[scene.view],
  });

  forScene.set(bearers, made);
  placements.set(scene, forScene);

  return made;
};

/** How far a ring reaches from its centre, stroke included. */
const reach = noteMarkerRadius + noteMarkerStroke / 2;

/**
 * The corners of every empty-spot ring in `scene`, for the zoom to fit: a
 * spot can be a thousand units out, so a fit that ignored it would leave its
 * ring off screen. Structure and hop rings sit beside what the fit already
 * holds. Only the page asks; an export's extent leaves markers out.
 */
export const spotRingCorners = (
  scene: Scene,
  bearers: NoteBearers | null
): readonly ScreenPoint[] =>
  bearers === null || bearers.spots.length === 0
    ? []
    : Arr.flatMap(
        placedMarkers(scene, bearers).spots,
        ({ marker: { sx, sy } }): readonly ScreenPoint[] => [
          { sx: sx - reach, sy: sy - reach },
          { sx: sx + reach, sy: sy + reach },
        ]
      );

/**
 * The spot rings as things drawn, for `fitOf`. A ring belongs to no
 * structure, so it counts whenever the fit is of everything; when the fit is
 * of the chapter's structures, `fitIds` lists them and `fitOf` keeps only
 * what belongs to them, so a ring is tied to the structures in `fitIds`.
 */
export const spotDrawn = (
  scene: Scene,
  bearers: NoteBearers | null,
  fitIds: readonly string[]
): readonly {
  readonly ids: readonly string[];
  readonly points: readonly ScreenPoint[];
}[] => {
  const points = spotRingCorners(scene, bearers);

  return points.length === 0 ? [] : [{ ids: fitIds, points }];
};
