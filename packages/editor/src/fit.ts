import { Array as Arr, Order } from "effect";

import { boundsOf } from "./bounds.ts";
import type { Bounds } from "./bounds.ts";
import type { ScreenPoint } from "./projection.ts";

/** Something drawn, with the structures it belongs to and the points it reaches. */
export interface Drawn {
  /** The structures it belongs to: one for a structure, two for a hop. */
  readonly ids: readonly string[];
  readonly points: readonly ScreenPoint[];
}

/** What the viewport fits, and the key that says when to fit it again. */
export interface Fit {
  readonly bounds: Bounds | undefined;
  readonly key: string;
}

/**
 * The bounds of everything that belongs only to structures in `fitTo`, or of
 * everything when `fitTo` is left out. The key names the set of ids, so it
 * changes when the set does (a new chapter) and not when the geometry does
 * (a moved structure).
 */
export const fitOf = ({
  drawn,
  fitTo,
}: {
  readonly drawn: readonly Drawn[];
  readonly fitTo?: readonly string[] | undefined;
}): Fit => {
  if (fitTo === undefined) {
    return {
      bounds: boundsOf(Arr.flatMap(drawn, ({ points }) => points)),
      key: "*",
    };
  }

  const fitting = new Set(fitTo);

  return {
    bounds: boundsOf(
      Arr.flatMap(drawn, ({ ids, points }) =>
        Arr.every(ids, (id) => fitting.has(id)) ? points : []
      )
    ),
    key: Arr.join(Arr.sort(Arr.dedupe(fitTo), Order.String), "\n"),
  };
};
