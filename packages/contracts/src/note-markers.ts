import { Array as Arr, Option, Order } from "effect";
import { dual } from "effect/Function";

import { convexOverlap, distanceToPolyline, rectPolygon } from "./geometry.ts";
import type { ScreenPoint, ScreenRect } from "./iso.ts";
import type { GridPoint } from "./layout.ts";
import type { GroundProjection } from "./plan.ts";
import type { Scene } from "./scene.ts";

/** The radius of a note marker's ring, in screen units. */
export const noteMarkerRadius = 5;

/** The width of a ring's stroke, as the page draws it. */
export const noteMarkerStroke = 2;

/** The width of a hop's line, as the drawing strokes it. */
export const hopStroke = 1.4;

/** The width of a box's outline, as the drawing strokes it. */
export const boxStroke = 1.2;

/** The width of the thin edges of name tags, chips, labels and zone titles. */
export const edgeStroke = 1;

/**
 * The gap a ring keeps from everything it must clear, measured between the
 * edges of the strokes: its own and the line's or box's. Every kind of
 * thing gets the same one, so a ring sits as far from a hop's line as from
 * a box.
 */
export const visibleGap = 1.5;

/**
 * How far a ring's centre must be from the middle of a stroke `stroke` wide
 * so that the visible gap between the two strokes is `visibleGap`.
 */
export const centreClearance = (stroke: number): number =>
  noteMarkerRadius + noteMarkerStroke / 2 + stroke / 2 + visibleGap;

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

/** Something a ring must stay clear of: a polygon and how wide its edge is drawn. */
interface Solid {
  readonly polygon: readonly ScreenPoint[];
  readonly stroke: number;
}

/** The polygons a marker must stay clear of: boxes, name tags, chips, zone titles and hop labels. */
const solidsOf = (scene: Scene): readonly Solid[] => [
  ...Arr.map(scene.structures, ({ outline }) => ({
    polygon: outline,
    stroke: boxStroke,
  })),
  ...Arr.map(scene.structures, ({ tag }) => ({
    polygon: rectPolygon(tag),
    stroke: edgeStroke,
  })),
  ...Arr.flatMap(scene.structures, ({ chip }) =>
    chip === undefined
      ? []
      : [{ polygon: rectPolygon(chip), stroke: edgeStroke }]
  ),
  ...Arr.flatMap(scene.zones, ({ title }) =>
    title === undefined ? [] : [{ polygon: title, stroke: edgeStroke }]
  ),
  ...Arr.flatMap(scene.hops, ({ label }) =>
    label === undefined
      ? []
      : [{ polygon: rectPolygon(label), stroke: edgeStroke }]
  ),
];

/**
 * Spots a ring can rest at against `outline` (the structure's own outline) or
 * its name tag, ordered nearest the top right corner first. Along each edge
 * a ring sits the box's clearance out on the edge's own normal, so the
 * visible gap is the same on every edge; at the corners it sits that far out
 * from the centre. Beside the tag it sits the tag's clearance out.
 */
const candidatesOf = ({
  outline,
  tag,
}: {
  readonly outline: readonly ScreenPoint[];
  readonly tag: ScreenRect;
}): readonly NoteMarkerSpot[] => {
  const reach = centreClearance(boxStroke);

  const ring = [...outline, ...Arr.take(outline, 1)];

  const centre = {
    sx: Arr.reduce(outline, 0, (sum, { sx }) => sum + sx) / outline.length,
    sy: Arr.reduce(outline, 0, (sum, { sy }) => sum + sy) / outline.length,
  };

  const edges: readonly (readonly [ScreenPoint, ScreenPoint])[] = Arr.zip(
    ring,
    Arr.drop(ring, 1)
  );

  // Points along each edge, pushed out along the edge's normal, on the side
  // away from the centre.
  const alongEdges = Arr.flatMap(edges, ([from, to]) => {
    const dx = to.sx - from.sx;
    const dy = to.sy - from.sy;
    const length = Math.hypot(dx, dy) || 1;
    const normal = { sx: dy / length, sy: -dx / length };
    const middle = { sx: (from.sx + to.sx) / 2, sy: (from.sy + to.sy) / 2 };

    const outward =
      (middle.sx - centre.sx) * normal.sx +
        (middle.sy - centre.sy) * normal.sy >=
      0
        ? 1
        : -1;

    return Arr.map([0.25, 0.5, 0.75], (share) => ({
      sx: from.sx + dx * share + normal.sx * outward * reach,
      sy: from.sy + dy * share + normal.sy * outward * reach,
    }));
  });

  // At the corners, straight out from the centre.
  const atCorners = Arr.map(outline, (corner) => {
    const dx = corner.sx - centre.sx;
    const dy = corner.sy - centre.sy;
    const length = Math.hypot(dx, dy) || 1;

    return {
      sx: corner.sx + (dx / length) * reach,
      sy: corner.sy + (dy / length) * reach,
    };
  });

  // Beside the name tag, left and right of it.
  const middle = (tag.top + tag.bottom) / 2;
  const byTag = centreClearance(edgeStroke);

  const beside = [
    { sx: tag.right + byTag, sy: middle },
    { sx: tag.left - byTag, sy: middle },
  ];

  // Nearest the top right of the outline first.
  const top = Math.min(...Arr.map(outline, ({ sy }) => sy));
  const right = Math.max(...Arr.map(outline, ({ sx }) => sx));

  return Arr.sort(
    [...alongEdges, ...atCorners, ...beside],
    Order.mapInput(Order.Number, ({ sx, sy }: NoteMarkerSpot) =>
      Math.hypot(sx - right, sy - top)
    )
  );
};

/** The segments of every hop's route, for keeping rings off the lines. */
const routesOf = (scene: Scene): readonly (readonly ScreenPoint[])[] =>
  Arr.map(scene.hops, ({ points }) => points);

/** How far `spot` is from the edge of `polygon`, whichever side it is on. */
const distanceToEdge = (
  polygon: readonly ScreenPoint[],
  spot: NoteMarkerSpot
) => distanceToPolyline([...polygon, ...Arr.take(polygon, 1)], spot);

/**
 * Whether a ring at `spot` is clear: it shares no area with a solid, keeps
 * the visible gap from the edge of each solid and each hop's line, counting
 * both strokes, and doesn't touch a marker in `taken`.
 */
const isClear = ({
  spot,
  solids,
  lines,
  taken,
}: {
  readonly spot: NoteMarkerSpot;
  readonly solids: readonly Solid[];
  readonly lines: readonly (readonly ScreenPoint[])[];
  readonly taken: readonly NoteMarkerSpot[];
}) => {
  const square = rectPolygon(squareAround(spot));

  return (
    !Arr.some(solids, ({ polygon }) => convexOverlap(square, polygon)) &&
    !Arr.some(
      solids,
      ({ polygon, stroke }) =>
        distanceToEdge(polygon, spot) < centreClearance(stroke)
    ) &&
    !Arr.some(taken, (other) =>
      convexOverlap(square, rectPolygon(squareAround(other)))
    ) &&
    !Arr.some(
      lines,
      (line) => distanceToPolyline(line, spot) < centreClearance(hopStroke)
    )
  );
};

/** What carries notes: structures and hops by id, and empty spots by position. */
export interface NoteBearers {
  readonly structures: ReadonlySet<string>;
  readonly hops: ReadonlySet<string>;
  readonly spots: readonly GridPoint[];
  /** How the view projects the ground, to place the spots. Left out when there are none. */
  readonly ground?: GroundProjection | undefined;
}

/** The marker of one empty spot, and the spot it is for. */
export interface PlacedSpot {
  readonly spot: GridPoint;
  readonly marker: NoteMarkerSpot;
}

/** Where every kind of note puts its marker. A bearer with no free spot is left out. */
export interface PlacedMarkers {
  readonly structures: ReadonlyMap<string, NoteMarkerSpot>;
  readonly hops: ReadonlyMap<string, NoteMarkerSpot>;
  readonly spots: readonly PlacedSpot[];
}

/** How far from a hop's line a ring sits: just past the clearance every line needs. */
const besideLine = centreClearance(hopStroke) + 0.01;

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
const searchSteps = 10;

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
 * label, keeps the visible gap off each of them and every hop's line, counting
 * both strokes, and doesn't touch another marker. Structures place first,
 * then hops, then spots.
 *
 * - A hop's marker sits beside its own line, in the first free spot from the
 *   middle outward.
 * - A spot's marker sits on the spot when that is free. Otherwise it moves
 *   to the nearest free place within ten steps, so it never covers text or
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
      const found = settle(candidatesOf(placed));

      if (Option.isSome(found)) {
        structures.set(id, found.value);
      }
    }
  }

  const hops = new Map<string, NoteMarkerSpot>();

  for (const { hop, points } of scene.hops) {
    if (bearers.hops.has(hop.id)) {
      const found = settle(besideCandidates(points));

      if (Option.isSome(found)) {
        hops.set(hop.id, found.value);
      }
    }
  }

  const spots: PlacedSpot[] = [];

  for (const bearer of bearers.spots) {
    if (bearers.ground !== undefined) {
      const found = settle(aroundCandidates(bearers.ground.toScreen(bearer)));

      if (Option.isSome(found)) {
        spots.push({ spot: bearer, marker: found.value });
      }
    }
  }

  return { structures, hops, spots };
});
