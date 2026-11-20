import type {
  ChapterStop,
  FlowChoice,
  Hop,
  MapState,
} from "@axonometric/contracts";
import { Array as Arr } from "effect";

/**
 * The hops one packet carries, in order, on a loop. A chapter's own hops make
 * one run; a flow choice makes one run per flow it plays.
 */
export interface PacketRun {
  readonly hops: ReadonlyArray<Hop>;
  /** The chapter's or the flow's id. */
  readonly id: string;
  /** The chapter title or flow name, for the packet panel. */
  readonly name: string;
}

/** A chapter, and the map it belongs to. */
export interface ChapterOfMap {
  readonly state: MapState;
  readonly stop: ChapterStop;
}

/**
 * A string that names a flow choice, equal for equal choices. Playback
 * restarts when it changes, and the flow picker uses it to mark its choice.
 */
export const flowChoiceKey = (choice: FlowChoice) =>
  choice.kind === "flow" ? `flow:${choice.id}` : choice.kind;

/** What a chapter plays for one flow choice. */
export interface ChapterPlay {
  /** Names the chapter and the choice together; see `flowChoiceKey`. */
  readonly key: string;
  readonly runs: ReadonlyArray<PacketRun>;
}

/**
 * What a chapter plays for `choice`: one run for the chapter's hops or for
 * one flow, or one run per flow for "all". Hops whose ends aren't revealed
 * or placed are left out, and empty runs are dropped.
 */
export const chapterPlayOf = ({
  choice,
  state,
  stop,
}: ChapterOfMap & { readonly choice: FlowChoice }): ChapterPlay => {
  const hops = new Map(Arr.map(state.data.hops, (hop) => [hop.id, hop]));

  const shown = (structure: string) =>
    stop.revealed.has(structure) &&
    state.layout.structures[structure] !== undefined;

  const run = (
    id: string,
    name: string,
    hopIds: ReadonlyArray<string>
  ): ReadonlyArray<PacketRun> => {
    const playable = Arr.flatMap(hopIds, (hopId) => {
      const hop = hops.get(hopId);

      return hop !== undefined && shown(hop.from) && shown(hop.to) ? [hop] : [];
    });

    return playable.length === 0 ? [] : [{ hops: playable, id, name }];
  };

  const lists =
    choice.kind === "chapter"
      ? [{ hops: stop.plays, id: stop.id, name: stop.title }]
      : Arr.filter(
          state.data.flows,
          (flow) => choice.kind === "all" || flow.id === choice.id
        );

  return {
    key: `${stop.id}|${flowChoiceKey(choice)}`,
    runs: Arr.flatMap(lists, (list) => run(list.id, list.name, list.hops)),
  };
};
