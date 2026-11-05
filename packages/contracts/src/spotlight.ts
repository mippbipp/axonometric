import { Array as Arr, Option } from "effect";

import type { ChapterStop } from "./chapters.ts";
import type { Hop, MapData } from "./map-data.ts";

/** A hop or a structure that the pointer is on, or that is pinned. */
export type SpotlightTarget =
  | { readonly kind: "hop"; readonly id: string }
  | { readonly kind: "structure"; readonly id: string };

/** What the spotlight is worked out from. */
interface SpotlightChoice {
  /**
   * The ids of the hops the chapter plays, or the picked flow's. `"all"` is
   * every flow, which fades nothing, as does playing no hops.
   */
  readonly play: readonly string[] | "all";
  /** What the pointer is on, if anything. */
  readonly hovered: SpotlightTarget | null;
  /** The selected packet's hop, or the selected structure. */
  readonly pinned: SpotlightTarget | null;
  /**
   * The ends of a hop being drawn: the structure it starts at and, once the
   * pointer is on one, the structure it would end at. Left out when no hop is
   * being drawn.
   */
  readonly drawing?: DrawingHop | null | undefined;
}

/** The ends of a hop being drawn on the page. */
export interface DrawingHop {
  readonly from: string;
  readonly over: string | null;
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
 * 1. The ends of a hop being drawn.
 * 2. The hovered hop or structure.
 * 3. The pinned hop or structure.
 * 4. The hops in `play`.
 *
 * A hop's spotlight is the hop and its two structures. A structure's is its
 * hops, in and out, and the structures at their other ends. A play's is its
 * hops and their ends. Only hops between revealed structures count, since
 * only those are drawn, so a hovered or pinned item that isn't drawn, or a
 * play with no drawn hop, gives way to the next.
 */
const spotlightOf = ({
  data,
  revealed,
  play,
  hovered,
  pinned,
  drawing = null,
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

  // A hop being drawn has no line yet, so only its two ends are lit. The
  // pointer is captured by the drag, so hover can't say which one it is over.
  const ofDrawing = (): Spotlight | null =>
    drawing === null
      ? null
      : {
          hops: new Set(),
          structures: new Set(
            Arr.filter(
              [drawing.from, drawing.over ?? ""],
              (id) => id !== "" && revealed.has(id)
            )
          ),
        };

  return ofDrawing() ?? ofTarget(hovered) ?? ofTarget(pinned) ?? ofPlay();
};

/** What the last chapter's flow picker has chosen to play. */
export type FlowChoice =
  | { readonly kind: "chapter" }
  | { readonly kind: "flow"; readonly id: string }
  | { readonly kind: "all" };

/**
 * What a chapter plays before anyone uses the flow picker: its own hops, or
 * every flow when it's the last chapter and plays none.
 */
export const defaultFlowChoice = ({
  data,
  stop,
  isLast,
}: {
  readonly data: Pick<MapData, "flows">;
  readonly stop: Pick<ChapterStop, "plays">;
  readonly isLast: boolean;
}): FlowChoice =>
  isLast && stop.plays.length === 0 && data.flows.length > 0
    ? { kind: "all" }
    : { kind: "chapter" };

/**
 * The hops a flow choice plays, for the spotlight: the chapter's hops, one
 * flow's, or `"all"` for every flow, which fades nothing.
 */
export const playedHopsOf = ({
  data,
  stop,
  choice,
}: {
  readonly data: Pick<MapData, "flows">;
  readonly stop: Pick<ChapterStop, "plays">;
  readonly choice: FlowChoice;
}): readonly string[] | "all" => {
  if (choice.kind === "all") {
    return "all";
  }

  if (choice.kind === "chapter") {
    return stop.plays;
  }

  return Arr.findFirst(data.flows, (flow) => flow.id === choice.id).pipe(
    Option.map((flow) => flow.hops),
    Option.getOrElse((): readonly string[] => [])
  );
};

/**
 * The spotlight of a chapter and flow choice, with what is hovered and
 * pinned. The page calls it with what the pointer is on and what is pinned;
 * a file, which has neither, passes `null` for both. Every spotlight, on the
 * page or in a file, comes from this one call.
 */
export const chapterSpotlightOf = ({
  data,
  stop,
  choice,
  hovered,
  pinned,
  drawing = null,
}: {
  readonly data: Pick<MapData, "hops" | "flows">;
  readonly stop: Pick<ChapterStop, "revealed" | "plays">;
  readonly choice: FlowChoice;
  readonly hovered: SpotlightTarget | null;
  readonly pinned: SpotlightTarget | null;
  readonly drawing?: DrawingHop | null | undefined;
}): Spotlight | null =>
  spotlightOf({
    data,
    revealed: stop.revealed,
    play: playedHopsOf({ data, stop, choice }),
    hovered,
    pinned,
    drawing,
  });
