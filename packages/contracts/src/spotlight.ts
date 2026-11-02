import { Array as Arr, Option } from "effect";

import type { Hop, MapData } from "./map-data.ts";

/** A hop or a structure that the pointer is on, or that is pinned. */
export type SpotlightTarget =
  | { readonly kind: "hop"; readonly id: string }
  | { readonly kind: "structure"; readonly id: string };

/** What the spotlight is worked out from. */
export interface SpotlightChoice {
  /**
   * The ids of the hops the chapter plays, or the picked flow's. `"all"` is
   * every flow, which fades nothing, as does playing no hops.
   */
  readonly play: readonly string[] | "all";
  /** What the pointer is on, if anything. */
  readonly hovered: SpotlightTarget | null;
  /** The selected packet's hop, or the selected structure. */
  readonly pinned: SpotlightTarget | null;
}

/**
 * The hops, and the structures at their ends, that are drawn at full
 * strength. Every other drawn hop and structure fades.
 */
export interface Spotlight {
  readonly hops: ReadonlySet<string>;
  readonly structures: ReadonlySet<string>;
}

const spotlightOfHops = (
  hops: readonly Hop[],
  alsoStructures: readonly string[] = []
): Spotlight => ({
  hops: new Set(Arr.map(hops, ({ id }) => id)),
  structures: new Set([
    ...alsoStructures,
    ...Arr.flatMap(hops, ({ from, to }) => [from, to]),
  ]),
});

/**
 * What to draw at full strength, or `null` when nothing fades. It comes from
 * the first of these that applies:
 *
 * 1. The hovered hop or structure.
 * 2. The pinned hop or structure.
 * 3. The hops in `play`.
 *
 * A hop's spotlight is the hop and its two structures. A structure's is its
 * hops, in and out, and the structures at their other ends. A play's is its
 * hops and their ends. Only hops between revealed structures count, since
 * only those are drawn, so a hovered or pinned item that isn't drawn, or a
 * play with no drawn hop, gives way to the next.
 */
export const spotlightOf = ({
  data,
  revealed,
  play,
  hovered,
  pinned,
}: SpotlightChoice & {
  readonly data: Pick<MapData, "hops">;
  /** The structures drawn. */
  readonly revealed: ReadonlySet<string>;
}): Spotlight | null => {
  const drawn = Arr.filter(
    data.hops,
    ({ from, to }) => revealed.has(from) && revealed.has(to)
  );

  const ofTarget = (target: SpotlightTarget | null): Spotlight | null => {
    if (target === null) {
      return null;
    }

    if (target.kind === "hop") {
      const found = Arr.findFirst(drawn, ({ id }) => id === target.id);

      return Option.isSome(found) ? spotlightOfHops([found.value]) : null;
    }

    return revealed.has(target.id)
      ? spotlightOfHops(
          Arr.filter(
            drawn,
            ({ from, to }) => from === target.id || to === target.id
          ),
          [target.id]
        )
      : null;
  };

  const ofPlay = (): Spotlight | null => {
    if (play === "all") {
      return null;
    }

    const played = new Set(play);
    const hops = Arr.filter(drawn, ({ id }) => played.has(id));

    return hops.length === 0 ? null : spotlightOfHops(hops);
  };

  return ofTarget(hovered) ?? ofTarget(pinned) ?? ofPlay();
};
