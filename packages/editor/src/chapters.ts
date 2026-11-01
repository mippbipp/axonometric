import type { Hop, MapState } from "@axonometric/contracts";
import { Array as Arr } from "effect";

/**
 * One chapter as the walkthrough shows it, with the structures revealed so
 * far worked out.
 */
export interface ChapterStop {
  readonly id: string;
  readonly title: string;
  readonly lede: string;
  readonly story: string;
  /** Every structure revealed by this chapter or an earlier one. */
  readonly revealed: ReadonlySet<string>;
  /** The structures this chapter reveals for the first time, in map order. */
  readonly fresh: readonly string[];
  /** The ids of the hops the chapter plays, in order. */
  readonly plays: readonly string[];
}

/** The id of the one chapter a map with no chapters gets. */
export const wholeMapChapterId = "whole-map";

/**
 * The walkthrough's chapters, with reveals made cumulative. A map with no
 * chapters gets one chapter that shows every structure and plays nothing, so
 * the last-chapter flow picker still offers its flows.
 */
export const chapterStopsOf = (
  state: MapState
): Arr.NonEmptyReadonlyArray<ChapterStop> => {
  const { structures, chapters } = state.data;

  if (!Arr.isReadonlyArrayNonEmpty(chapters)) {
    return [
      {
        id: wholeMapChapterId,
        title: "The whole map",
        lede: "Every structure at once.",
        story: "This map has no chapters yet, so it shows everything.",
        revealed: new Set(Arr.map(structures, ({ id }) => id)),
        fresh: [],
        plays: [],
      },
    ];
  }

  const revealed = new Set<string>();

  return Arr.map(chapters, (chapter) => {
    const before = new Set(revealed);

    for (const id of chapter.reveals) {
      revealed.add(id);
    }

    const fresh = Arr.flatMap(structures, ({ id }) =>
      revealed.has(id) && !before.has(id) ? [id] : []
    );

    return {
      id: chapter.id,
      title: chapter.title,
      lede: chapter.lede,
      story: chapter.story,
      revealed: new Set(revealed),
      fresh,
      plays: chapter.plays,
    };
  });
};

/** What the last chapter's flow picker has chosen to play. */
export type FlowChoice =
  | { readonly kind: "chapter" }
  | { readonly kind: "flow"; readonly id: string }
  | { readonly kind: "all" };

/** A list of hops one packet walks along, on a loop. */
export interface Track {
  /** The chapter's or the flow's id. */
  readonly id: string;
  /** The chapter title or flow name, for the packet panel. */
  readonly name: string;
  readonly hops: readonly Hop[];
}

/** A chapter, and the map it belongs to. */
export interface ChapterOfMap {
  readonly state: MapState;
  readonly stop: ChapterStop;
}

/**
 * What a chapter plays before anyone uses the flow picker: its own hops, or
 * every flow when it's the last chapter and plays none.
 */
export const defaultFlowChoice = ({
  state,
  stop,
  isLast,
}: ChapterOfMap & { readonly isLast: boolean }): FlowChoice =>
  isLast && stop.plays.length === 0 && state.data.flows.length > 0
    ? { kind: "all" }
    : { kind: "chapter" };

/**
 * The tracks a chapter plays for `choice`: one track for the chapter or a
 * flow, one per flow for "all". Hops whose ends aren't revealed or placed are
 * left out, and empty tracks are dropped.
 */
export const tracksOf = ({
  state,
  stop,
  choice,
}: ChapterOfMap & { readonly choice: FlowChoice }): readonly Track[] => {
  const hops = new Map(Arr.map(state.data.hops, (hop) => [hop.id, hop]));

  const shown = (structure: string) =>
    stop.revealed.has(structure) &&
    state.layout.structures[structure] !== undefined;

  const track = (
    id: string,
    name: string,
    hopIds: readonly string[]
  ): readonly Track[] => {
    const playable = Arr.flatMap(hopIds, (hopId) => {
      const hop = hops.get(hopId);

      return hop !== undefined && shown(hop.from) && shown(hop.to) ? [hop] : [];
    });

    return playable.length === 0 ? [] : [{ id, name, hops: playable }];
  };

  if (choice.kind === "chapter") {
    return track(stop.id, stop.title, stop.plays);
  }

  const flows =
    choice.kind === "flow"
      ? Arr.filter(state.data.flows, (flow) => flow.id === choice.id)
      : state.data.flows;

  return Arr.flatMap(flows, (flow) => track(flow.id, flow.name, flow.hops));
};
