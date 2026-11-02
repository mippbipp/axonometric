import { Array as Arr, Option } from "effect";
import { dual } from "effect/Function";

import { convexOverlap, rectPolygon } from "./geometry.ts";
import type { ScreenPoint, ScreenRect } from "./iso.ts";
import type { Scene } from "./scene.ts";

/** The radius of a note marker's ring, in screen units. */
export const noteMarkerRadius = 5;

/** A marker's spot: the centre of its ring. */
export interface NoteMarkerSpot {
  readonly sx: number;
  readonly sy: number;
}

const squareAround = ({ sx, sy }: NoteMarkerSpot): ScreenRect => ({
  left: sx - noteMarkerRadius,
  top: sy - noteMarkerRadius,
  right: sx + noteMarkerRadius,
  bottom: sy + noteMarkerRadius,
});

/** The polygons a marker must stay clear of: boxes, name tags, chips, zone titles and hop labels. */
const solidsOf = (scene: Scene): readonly (readonly ScreenPoint[])[] => [
  ...Arr.map(scene.structures, ({ outline }) => outline),
  ...Arr.map(scene.structures, ({ tag }) => rectPolygon(tag)),
  ...Arr.flatMap(scene.structures, ({ chip }) =>
    chip === undefined ? [] : [rectPolygon(chip)]
  ),
  ...Arr.flatMap(scene.zones, ({ title }) =>
    title === undefined ? [] : [title]
  ),
  ...Arr.flatMap(scene.hops, ({ label }) =>
    label === undefined ? [] : [rectPolygon(label)]
  ),
];

/** Spots around a structure's bounds, nearest the top right corner first. */
const candidatesOf = (bounds: ScreenRect): readonly NoteMarkerSpot[] => {
  const gap = noteMarkerRadius + 2;
  const middle = (bounds.top + bounds.bottom) / 2;

  return [
    { sx: bounds.right + gap, sy: bounds.top },
    { sx: bounds.right + gap, sy: middle },
    { sx: bounds.left - gap, sy: bounds.top },
    { sx: bounds.left - gap, sy: middle },
    { sx: bounds.right + gap, sy: bounds.bottom },
    { sx: bounds.left - gap, sy: bounds.bottom },
  ];
};

/**
 * Where each structure in `ids` puts its note marker: the first spot around
 * its bounds where the marker's square shares no area with a box, name tag,
 * code chip, zone title or hop label of the scene, or with a marker already
 * placed. A structure with no such spot is left out, and the page outlines
 * the structure itself instead, so a marker never covers text.
 */
export const noteMarkerSpots: {
  (
    ids: ReadonlySet<string>
  ): (scene: Scene) => ReadonlyMap<string, NoteMarkerSpot>;
  (scene: Scene, ids: ReadonlySet<string>): ReadonlyMap<string, NoteMarkerSpot>;
} = dual(
  2,
  (
    scene: Scene,
    ids: ReadonlySet<string>
  ): ReadonlyMap<string, NoteMarkerSpot> => {
    const solids = solidsOf(scene);
    const placed = new Map<string, NoteMarkerSpot>();

    for (const { structure, bounds } of scene.structures) {
      if (ids.has(structure.id)) {
        const taken = Arr.map([...placed.values()], (spot) =>
          rectPolygon(squareAround(spot))
        );

        const free = Arr.findFirst(candidatesOf(bounds), (spot) => {
          const square = rectPolygon(squareAround(spot));

          return !Arr.some([...solids, ...taken], (other) =>
            convexOverlap(square, other)
          );
        });

        if (Option.isSome(free)) {
          placed.set(structure.id, free.value);
        }
      }
    }

    return placed;
  }
);
