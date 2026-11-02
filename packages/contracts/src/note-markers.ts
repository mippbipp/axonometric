import { Array as Arr, Option, Order } from "effect";
import { dual } from "effect/Function";

import { convexOverlap, distanceToPolyline, rectPolygon } from "./geometry.ts";
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

/** How close a ring may come to a hop's line, beside the line's own width. */
const lineClearance = 2;

/** How far a ring's edge sits from the outline or tag it is placed against. */
const touching = 1;

/**
 * Spots whose ring touches `outline` (the structure's own outline) or its
 * name tag, ordered nearest the top right corner first. A ring is centred
 * `radius + touching` from the edge it rests on, along each edge's midpoint
 * and corners, so it sits next to the structure and not floating off it.
 */
const candidatesOf = ({
  outline,
  tag,
}: {
  readonly outline: readonly ScreenPoint[];
  readonly tag: ScreenRect;
}): readonly NoteMarkerSpot[] => {
  const reach = noteMarkerRadius + touching;

  const ring = [...outline, ...Arr.take(outline, 1)];

  // Points along the outline's edges, pushed out from its centre.
  const centre = {
    sx: Arr.reduce(outline, 0, (sum, { sx }) => sum + sx) / outline.length,
    sy: Arr.reduce(outline, 0, (sum, { sy }) => sum + sy) / outline.length,
  };

  const edges: readonly (readonly [ScreenPoint, ScreenPoint])[] = Arr.zip(
    ring,
    Arr.drop(ring, 1)
  );

  const along: readonly ScreenPoint[] = Arr.flatMap(edges, ([from, to]) =>
    Arr.map([0, 0.25, 0.5, 0.75, 1], (share) => ({
      sx: from.sx + (to.sx - from.sx) * share,
      sy: from.sy + (to.sy - from.sy) * share,
    }))
  );

  const pushed = Arr.map(along, (point) => {
    const dx = point.sx - centre.sx;
    const dy = point.sy - centre.sy;
    const length = Math.hypot(dx, dy) || 1;

    return {
      sx: point.sx + (dx / length) * reach,
      sy: point.sy + (dy / length) * reach,
    };
  });

  // Beside the name tag, left and right of it.
  const middle = (tag.top + tag.bottom) / 2;

  const byTag = [
    { sx: tag.right + reach, sy: middle },
    { sx: tag.left - reach, sy: middle },
  ];

  // Nearest the top right of the outline first.
  const top = Math.min(...Arr.map(outline, ({ sy }) => sy));
  const right = Math.max(...Arr.map(outline, ({ sx }) => sx));

  return Arr.sort(
    [...pushed, ...byTag],
    Order.mapInput(Order.Number, ({ sx, sy }: NoteMarkerSpot) =>
      Math.hypot(sx - right, sy - top)
    )
  );
};

/** The segments of every hop's route, for keeping rings off the lines. */
const routesOf = (scene: Scene): readonly (readonly ScreenPoint[])[] =>
  Arr.map(scene.hops, ({ points }) => points);

/**
 * Where each structure in `ids` puts its note marker: the first spot against
 * its outline or name tag where the marker's ring shares no area with a box,
 * name tag, code chip, zone title or hop label of the scene, stays
 * `lineClearance` off every hop's line, and doesn't touch a marker already
 * placed. A structure with no such spot is left out, and the page outlines
 * the structure itself instead, so a marker never covers text or a line.
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
    const lines = routesOf(scene);
    const placed = new Map<string, NoteMarkerSpot>();

    for (const placedStructure of scene.structures) {
      const { structure } = placedStructure;

      if (ids.has(structure.id)) {
        const taken = Arr.map([...placed.values()], (spot) =>
          rectPolygon(squareAround(spot))
        );

        const free = Arr.findFirst(candidatesOf(placedStructure), (spot) => {
          const square = rectPolygon(squareAround(spot));

          return (
            !Arr.some([...solids, ...taken], (other) =>
              convexOverlap(square, other)
            ) &&
            !Arr.some(
              lines,
              (line) =>
                distanceToPolyline(line, spot) <
                noteMarkerRadius + lineClearance
            )
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
