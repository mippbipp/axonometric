import type { ScreenPoint, ScreenRect } from "@axonometric/contracts";
import { Array as Arr, Option } from "effect";

/**
 * How far a strike reaches from its centre, in drawing units: the full size
 * first, then smaller ones for a short route whose label leaves no room.
 */
const reaches: readonly number[] = [7, 5, 3.5];

/** The air kept between a strike and text, in drawing units. */
const air = 2;

/** Where along the route a strike tries to sit, as a share of its length. */
const shares: readonly number[] = Arr.flatMap(Arr.range(0, 9), (step) => [
  0.5 + step * 0.05,
  0.5 - (step + 1) * 0.05,
]);

/** A point on a route, and the direction the route runs there. */
interface Along {
  readonly at: ScreenPoint;
  readonly dx: number;
  readonly dy: number;
}

/** The point at `share` of the way along `route`, and the direction there. */
const alongRoute = (route: readonly ScreenPoint[], share: number): Along => {
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
export interface Strike {
  readonly at: ScreenPoint;
  readonly lines: readonly (readonly [ScreenPoint, ScreenPoint])[];
}

const clear = ({
  at,
  reach,
  texts,
}: {
  readonly at: ScreenPoint;
  readonly reach: number;
  readonly texts: readonly ScreenRect[];
}) =>
  !Arr.some(
    texts,
    (rect) =>
      at.sx + reach + air > rect.left &&
      at.sx - reach - air < rect.right &&
      at.sy + reach + air > rect.top &&
      at.sy - reach - air < rect.bottom
  );

/**
 * The cross that strikes a hop proposed for deletion: two short lines across
 * its route, at the first spot along it that keeps clear of every box of text
 * in `texts`. Nothing when no spot is clear, since a strike never runs over
 * text. The hop is also drawn dashed, so it reads as deleted either way.
 */
export const strikeOnRoute = ({
  route,
  texts,
}: {
  readonly route: readonly ScreenPoint[];
  readonly texts: readonly ScreenRect[];
}): Option.Option<Strike> =>
  Option.map(
    Arr.findFirst(
      Arr.flatMap(reaches, (reach) =>
        Arr.map(shares, (share) => ({ ...alongRoute(route, share), reach }))
      ),
      ({ at, reach }) => clear({ at, reach, texts })
    ),
    ({ at, dx, dy, reach: strikeReach }) => {
      // The diagonals are the route's direction turned a quarter either way
      // from the cross-wise line, so the cross sits square on the route.
      const px = -dy;
      const py = dx;
      const r = strikeReach * Math.SQRT1_2;
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
