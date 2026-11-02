import { Array as Arr, Option, Order } from "effect";
import { dual } from "effect/Function";

import { convexOverlap, distanceToPolyline, rectPolygon } from "./geometry.ts";
import type { ScreenPoint, ScreenRect } from "./iso.ts";
import type { GridPoint } from "./layout.ts";
import type { GroundProjection } from "./plan.ts";
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

/** Whether a ring at `spot` is clear of every solid, line and marker in `taken`. */
const isClear = ({
  spot,
  solids,
  lines,
  taken,
}: {
  readonly spot: NoteMarkerSpot;
  readonly solids: readonly (readonly ScreenPoint[])[];
  readonly lines: readonly (readonly ScreenPoint[])[];
  readonly taken: readonly NoteMarkerSpot[];
}) => {
  const square = rectPolygon(squareAround(spot));

  return (
    !Arr.some(solids, (other) => convexOverlap(square, other)) &&
    !Arr.some(taken, (other) =>
      convexOverlap(square, rectPolygon(squareAround(other)))
    ) &&
    !Arr.some(
      lines,
      (line) =>
        distanceToPolyline(line, spot) < noteMarkerRadius + lineClearance
    )
  );
};

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
  ): ReadonlyMap<string, NoteMarkerSpot> =>
    placeNoteMarkers(scene, { structures: ids, hops: new Set(), spots: [] })
      .structures
);

/** What carries notes: structures and hops by id, and empty spots by position. */
export interface NoteBearers {
  readonly structures: ReadonlySet<string>;
  readonly hops: ReadonlySet<string>;
  readonly spots: readonly GridPoint[];
  /** How the view projects the ground, to place the spots. Left out when there are none. */
  readonly ground?: GroundProjection | undefined;
}

/** The key a spot's marker is stored under: `x,y`. */
export const spotKey = ({ x, y }: GridPoint): string => `${x},${y}`;

/** Where every kind of note puts its marker. A bearer with no free spot is left out. */
export interface PlacedMarkers {
  readonly structures: ReadonlyMap<string, NoteMarkerSpot>;
  readonly hops: ReadonlyMap<string, NoteMarkerSpot>;
  readonly spots: ReadonlyMap<string, NoteMarkerSpot>;
}

/** How far from a hop's line a ring sits: just past the clearance every line needs. */
const besideLine = noteMarkerRadius + lineClearance + 1;

/** The shares along a hop's line a ring is tried at, middle first. */
const alongShares = [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8, 0.1, 0.9];

/**
 * Spots on either side of `line`, `besideLine` from it, at the shares along
 * its length, middle first. The line is a polyline on screen.
 */
const besideCandidates = (
  line: readonly ScreenPoint[]
): readonly NoteMarkerSpot[] => {
  const legs = Arr.zip(line, Arr.drop(line, 1));

  const lengths = Arr.map(legs, ([from, to]) =>
    Math.hypot(to.sx - from.sx, to.sy - from.sy)
  );

  const total = Arr.reduce(lengths, 0, (sum, length) => sum + length);

  if (total === 0) {
    return [];
  }

  return Arr.flatMap(alongShares, (share) => {
    let remaining = share * total;

    for (const [index, [from, to]] of legs.entries()) {
      const length = lengths[index] ?? 0;

      if (remaining <= length || index === legs.length - 1) {
        const t = length === 0 ? 0 : Math.min(remaining / length, 1);
        const dx = (to.sx - from.sx) / (length || 1);
        const dy = (to.sy - from.sy) / (length || 1);

        const at = {
          sx: from.sx + (to.sx - from.sx) * t,
          sy: from.sy + (to.sy - from.sy) * t,
        };

        return [
          { sx: at.sx - dy * besideLine, sy: at.sy + dx * besideLine },
          { sx: at.sx + dy * besideLine, sy: at.sy - dx * besideLine },
        ];
      }

      remaining -= length;
    }

    return [];
  });
};

/** How far apart the rings tried around a busy spot are, in screen units. */
const searchStep = 2 * noteMarkerRadius;

/** How many steps out from its own spot a spot's marker may move. */
const searchSteps = 4;

/**
 * Spots around `at`, nearest first: `at` itself, then rings of eight
 * directions at each step out.
 */
const aroundCandidates = (at: NoteMarkerSpot): readonly NoteMarkerSpot[] => [
  at,
  ...Arr.flatMap(Arr.range(1, searchSteps), (step) =>
    Arr.map(Arr.range(0, 7), (turn) => {
      const angle = (turn * Math.PI) / 4;

      return {
        sx: at.sx + Math.cos(angle) * step * searchStep,
        sy: at.sy + Math.sin(angle) * step * searchStep,
      };
    })
  ),
];

/**
 * Where every note puts its marker, with the same rules for each kind: a
 * ring shares no area with a box, name tag, code chip, zone title or hop
 * label, stays `lineClearance` off every hop's line, and doesn't touch
 * another marker. Structures place first, as `noteMarkerSpots` does, then
 * hops, then spots.
 *
 * - A hop's marker sits beside its own line, in the first free spot from the
 *   middle outward.
 * - A spot's marker sits on the spot when that is free. Otherwise it moves
 *   to the nearest free place within a few steps, so it never covers text or
 *   a line.
 *
 * A bearer with no free place is left out; the panel and the Pending tab
 * still list its notes. `ground` projects spots; it is left out when there
 * are none.
 */
export const placeNoteMarkers: {
  (bearers: NoteBearers): (scene: Scene) => PlacedMarkers;
  (scene: Scene, bearers: NoteBearers): PlacedMarkers;
} = dual(2, (scene: Scene, bearers: NoteBearers): PlacedMarkers => {
  const solids = solidsOf(scene);
  const lines = routesOf(scene);
  const taken: NoteMarkerSpot[] = [];

  const settle = (candidates: readonly NoteMarkerSpot[]) => {
    const free = Arr.findFirst(candidates, (spot) =>
      isClear({ spot, solids, lines, taken })
    );

    if (Option.isSome(free)) {
      taken.push(free.value);
    }

    return free;
  };

  const structures = new Map<string, NoteMarkerSpot>();

  for (const placed of scene.structures) {
    const { id } = placed.structure;

    if (bearers.structures.has(id)) {
      Option.map(settle(candidatesOf(placed)), (spot) =>
        structures.set(id, spot)
      );
    }
  }

  const hops = new Map<string, NoteMarkerSpot>();

  for (const { hop, points } of scene.hops) {
    if (bearers.hops.has(hop.id)) {
      Option.map(settle(besideCandidates(points)), (spot) =>
        hops.set(hop.id, spot)
      );
    }
  }

  const spots = new Map<string, NoteMarkerSpot>();

  for (const bearer of bearers.spots) {
    if (bearers.ground !== undefined) {
      const near = aroundCandidates(bearers.ground.toScreen(bearer));

      Option.map(settle(near), (spot) => spots.set(spotKey(bearer), spot));
    }
  }

  return { structures, hops, spots };
});
