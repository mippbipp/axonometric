import { Array as Arr, Option, Order } from "effect";
import { dual } from "effect/Function";

import { clipToConvex, gapBetween, rectPolygon } from "./geometry.ts";
import type { Segment } from "./geometry.ts";
import { groundOutline } from "./ground-outline.ts";
import type { ScreenPoint, ScreenRect } from "./iso.ts";
import type { Placement } from "./layout.ts";
import { groundProjections } from "./plan.ts";
import type { GroundProjection } from "./plan.ts";
import { sceneFactsOf } from "./scene-facts.ts";
import type { Scene } from "./scene.ts";

/** How much room the cross keeps from text, in screen units. */
const clearance = 6;

/** `rect` grown by `by` on every side. */
export const grown: {
  (by: number): (rect: ScreenRect) => ScreenRect;
  (rect: ScreenRect, by: number): ScreenRect;
} = dual(2, (rect: ScreenRect, by: number): ScreenRect => ({
  bottom: rect.bottom + by,
  left: rect.left - by,
  right: rect.right + by,
  top: rect.top - by,
}));

/** The share of the segment between `from` and `to`, 0 at its start and 1 at its end. */
interface Share {
  readonly from: number;
  readonly to: number;
}

const byStart = Order.mapInput(Order.Number, (share: Share) => share.from);

/** The shares from 0 to 1 that `cuts` leave, in order. */
const gapsOutside = (cuts: ReadonlyArray<Share>): ReadonlyArray<Share> => {
  let reach = 0;
  const gaps: Array<Share> = [];

  for (const cut of Arr.sort(cuts, byStart)) {
    if (cut.from > reach) {
      gaps.push({ from: reach, to: cut.from });
    }

    reach = Math.max(reach, cut.to);
  }

  return reach < 1 ? [...gaps, { from: reach, to: 1 }] : gaps;
};

/**
 * The shortest piece of the cross worth drawing, in screen units. A shorter
 * one is a speck left by a text box that nearly reaches a corner. A longer
 * stub stays, so the cross still reaches its corners and the text reads as a
 * gap in the line.
 */
export const minStrikePiece = 5;

/**
 * The parts of `segment` that lie outside the convex `holes`, leaving out
 * pieces shorter than `minPiece` screen units.
 */
export const outsideHoles: {
  (
    holes: ReadonlyArray<ReadonlyArray<ScreenPoint>>,
    minPiece: number
  ): (segment: Segment) => ReadonlyArray<Segment>;
  (
    segment: Segment,
    holes: ReadonlyArray<ReadonlyArray<ScreenPoint>>,
    minPiece: number
  ): ReadonlyArray<Segment>;
} = dual(
  3,
  (
    segment: Segment,
    holes: ReadonlyArray<ReadonlyArray<ScreenPoint>>,
    minPiece: number
  ): ReadonlyArray<Segment> => {
    const cuts = Arr.flatMap(holes, (hole) =>
      Option.toArray(Option.fromNullishOr(clipToConvex(segment, hole)))
    );

    const at = (share: number): ScreenPoint => ({
      sx: segment.start.sx + (segment.end.sx - segment.start.sx) * share,
      sy: segment.start.sy + (segment.end.sy - segment.start.sy) * share,
    });

    const length = Math.hypot(
      segment.end.sx - segment.start.sx,
      segment.end.sy - segment.start.sy
    );

    const long = Arr.filter(
      gapsOutside(cuts),
      ({ from, to }) => (to - from) * length >= minPiece
    );

    return Arr.map(long, ({ from, to }) => ({ end: at(to), start: at(from) }));
  }
);

/**
 * The cross struck through a footprint: its two diagonals on the ground,
 * with every stretch inside a text box cut out. `text` holds the structure's
 * code chip and name tag, and any other text that stands on the box, so the
 * cross never crosses a letter and the text stays readable.
 */
export const strikeSegments = ({
  ground,
  placement,
  text,
}: {
  readonly ground: GroundProjection;
  readonly placement: Placement;
  /** The boxes of the text on the structure; `undefined` ones are left out. */
  readonly text: ReadonlyArray<ScreenRect | undefined>;
}): ReadonlyArray<Segment> => {
  const [a, b, c, d] = groundOutline(placement, ground);

  if (
    a === undefined ||
    b === undefined ||
    c === undefined ||
    d === undefined
  ) {
    return [];
  }

  const holes = Arr.flatMap(text, (rect) =>
    rect === undefined ? [] : [rectPolygon(grown(rect, clearance))]
  );

  return [
    ...outsideHoles({ end: c, start: a }, holes, minStrikePiece),
    ...outsideHoles({ end: d, start: b }, holes, minStrikePiece),
  ];
};

/**
 * The cross struck through structure `structure` in `scene`: its footprint's
 * diagonals, cut where its own name tag and code chip stand. Nothing when
 * the scene doesn't draw it.
 */
export const structureStrikeOf = ({
  scene,
  structure,
}: {
  readonly scene: Scene;
  readonly structure: string;
}): ReadonlyArray<Segment> =>
  Option.match(
    Arr.findFirst(scene.structures, (item) => item.structure.id === structure),
    {
      onNone: () => [],
      onSome: ({ chip, placement, tag }) =>
        strikeSegments({
          ground: groundProjections[scene.view],
          placement,
          text: [chip, tag],
        }),
    }
  );

/**
 * How far a hop's strike reaches from its centre, in drawing units: the full
 * size first, then smaller ones for a short route whose label leaves no room.
 */
const hopReaches: ReadonlyArray<number> = [7, 5, 3.5];

/** The air a hop's strike keeps from text, in drawing units. */
const hopAir = 2;

/** Where along a route a hop's strike tries to sit, as a share of its length. */
const hopShares: ReadonlyArray<number> = Arr.flatMap(
  Arr.range(0, 9),
  (step) => [0.5 + step * 0.05, 0.5 - (step + 1) * 0.05]
);

/** A point on a route, and the direction the route runs there. */
interface Along {
  readonly at: ScreenPoint;
  readonly dx: number;
  readonly dy: number;
}

/** The point at `share` of the way along `route`, and the direction there. */
const alongRoute = (
  route: ReadonlyArray<ScreenPoint>,
  share: number
): Along => {
  const lengths = Arr.map(Arr.zip(route, Arr.drop(route, 1)), ([a, b]) =>
    Math.hypot(b.sx - a.sx, b.sy - a.sy)
  );

  const total = Arr.reduce(lengths, 0, (so, length) => so + length);
  let left = total * share;

  for (const [index, length] of lengths.entries()) {
    const a = route[index];
    const b = route[index + 1];

    if (
      a !== undefined &&
      b !== undefined &&
      (left <= length || index === lengths.length - 1)
    ) {
      const t = length === 0 ? 0 : Math.min(left / length, 1);

      return {
        at: { sx: a.sx + (b.sx - a.sx) * t, sy: a.sy + (b.sy - a.sy) * t },
        dx: length === 0 ? 1 : (b.sx - a.sx) / length,
        dy: length === 0 ? 0 : (b.sy - a.sy) / length,
      };
    }

    left -= length;
  }

  const [first] = route;

  return { at: first ?? { sx: 0, sy: 0 }, dx: 1, dy: 0 };
};

/** The two lines of a strike across a route: a cross, one diagonal each way. */
export interface HopStrike {
  readonly at: ScreenPoint;
  readonly lines: ReadonlyArray<readonly [ScreenPoint, ScreenPoint]>;
}

const hopClear = ({
  at,
  outlines,
  reach,
  texts,
}: {
  readonly at: ScreenPoint;
  readonly outlines: ReadonlyArray<ReadonlyArray<ScreenPoint>>;
  readonly reach: number;
  readonly texts: ReadonlyArray<ScreenRect>;
}) => {
  const box = grown(
    {
      bottom: at.sy + reach,
      left: at.sx - reach,
      right: at.sx + reach,
      top: at.sy - reach,
    },
    hopAir
  );

  return (
    !Arr.some(
      texts,
      (rect) =>
        box.right > rect.left &&
        box.left < rect.right &&
        box.bottom > rect.top &&
        box.top < rect.bottom
    ) &&
    // A route ends on a structure's edge, so the cross must stand off every
    // outline, its own ends' included, or it reads as part of the box.
    !Arr.some(outlines, (outline) => gapBetween(box, outline) === 0)
  );
};

/**
 * The cross that strikes hop `hop` in `scene`, proposed for deletion: two
 * short lines across its route, at the first spot along it that keeps clear
 * of every box of text and every structure's outline. Nothing when no spot
 * is clear, or the scene doesn't draw the hop, since a strike never runs over
 * text. The hop is also drawn dashed, so it reads as deleted either way.
 */
export const hopStrikeOf = ({
  hop,
  scene,
}: {
  readonly hop: string;
  readonly scene: Scene;
}): Option.Option<HopStrike> => {
  const { outlines, texts } = sceneFactsOf(scene);

  const route = Arr.findFirst(scene.hops, (item) => item.hop.id === hop);

  if (Option.isNone(route)) {
    return Option.none();
  }

  return Option.map(
    Arr.findFirst(
      Arr.flatMap(hopReaches, (reach) =>
        Arr.map(hopShares, (share) => ({
          ...alongRoute(route.value.points, share),
          reach,
        }))
      ),
      ({ at, reach }) => hopClear({ at, outlines, reach, texts })
    ),
    ({ at, dx, dy, reach }) => {
      // The diagonals are the route's direction turned a quarter either way
      // from the cross-wise line, so the cross sits square on the route.
      const px = -dy;
      const py = dx;
      const r = reach * Math.SQRT1_2;
      const a = { sx: (dx + px) * r, sy: (dy + py) * r };
      const b = { sx: (dx - px) * r, sy: (dy - py) * r };

      return {
        at,
        lines: [
          [
            { sx: at.sx - a.sx, sy: at.sy - a.sy },
            { sx: at.sx + a.sx, sy: at.sy + a.sy },
          ],
          [
            { sx: at.sx - b.sx, sy: at.sy - b.sy },
            { sx: at.sx + b.sx, sy: at.sy + b.sy },
          ],
        ] as const,
      };
    }
  );
};
