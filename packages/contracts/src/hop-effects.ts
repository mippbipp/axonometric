import { Array as Arr, Option } from "effect";
import { dual } from "effect/Function";

import { hopActionOf } from "./hop-actions.ts";
import type { HopNames } from "./hop-actions.ts";
import { hopOf } from "./hop-change.ts";
import type { HopChange } from "./hop-change.ts";
import { changedProblems } from "./layout-checks.ts";
import type { Checkable, DraggedProblem } from "./layout-checks.ts";
import type { Hop, MapData } from "./map-data.ts";
import { quoteText } from "./review-quote.ts";
import type { Facts } from "./review-report.ts";

export { flowsOfHop } from "./hop-actions.ts";

export type { HopNames } from "./hop-actions.ts";

/**
 * `data` with `change` applied, as the page shows it before the agent has
 * decided. A deletion leaves the hop in: the page draws it struck. A new hop
 * is added at the end. Chapters are not touched: a proposed hop plays in none.
 */
export const hopChangeToData: {
  (change: HopChange): (data: MapData) => MapData;
  (data: MapData, change: HopChange): MapData;
} = dual(2, (data: MapData, change: HopChange): MapData =>
  hopActionOf(change).toData(data)
);

/** Whether the map already has the value `change` proposes for its hop. */
export const hopIsCurrent: {
  (change: HopChange): (data: Pick<MapData, "hops">) => boolean;
  (data: Pick<MapData, "hops">, change: HopChange): boolean;
} = dual(2, (data: Pick<MapData, "hops">, change: HopChange): boolean =>
  hopActionOf(change).isCurrent(data)
);

/** A word for the kind of change, as `review` lists it. */
export const hopLabel = (change: HopChange): string =>
  hopActionOf(change).label;

/** What the Pending list says about a hop change, in plain words. */
export const describeHop: {
  (names: HopNames): (change: HopChange) => string;
  (change: HopChange, names: HopNames): string;
} = dual(2, (change: HopChange, names: HopNames): string =>
  hopActionOf(change).describe(names)
);

/** One line for the prompt; everything the engineer typed goes through `quoteText`. */
export const summarizeHop: {
  (item: string, names: HopNames): (change: HopChange) => string;
  (change: HopChange, item: string, names: HopNames): string;
} = dual(3, (change: HopChange, item: string, names: HopNames): string =>
  hopActionOf(change).summary(item, names)
);

/** `review`'s before and after for a hop change, given the map as data.mjs has it. */
export const factsOfHop: {
  (data: Pick<MapData, "hops" | "flows"> | undefined): (change: HopChange) => {
    readonly before: Facts;
    readonly after: Facts;
  };
  (
    change: HopChange,
    data: Pick<MapData, "hops" | "flows"> | undefined
  ): { readonly before: Facts; readonly after: Facts };
} = dual(
  2,
  (
    change: HopChange,
    data: Pick<MapData, "hops" | "flows"> | undefined
  ): { readonly before: Facts; readonly after: Facts } => {
    const id = hopOf(change);

    const current: Option.Option<Hop> =
      data === undefined
        ? Option.none()
        : Arr.findFirst(data.hops, (hop) => hop.id === id);

    return hopActionOf(change).facts(current, data);
  }
);

/**
 * Everything that still refers to hop `id`, one phrase each: the flows that
 * list it and the chapters that play it. Names go through `quoteText`, since
 * they are text the agent reads.
 */
export const referencesToHop: {
  (
    id: string
  ): (data: Pick<MapData, "flows" | "chapters">) => readonly string[];
  (data: Pick<MapData, "flows" | "chapters">, id: string): readonly string[];
} = dual(
  2,
  (
    data: Pick<MapData, "flows" | "chapters">,
    id: string
  ): readonly string[] => [
    ...Arr.flatMap(data.flows, (flow) =>
      flow.hops.includes(id)
        ? [`flow ${flow.id} (${quoteText(flow.name)}) lists it`]
        : []
    ),
    ...Arr.flatMap(data.chapters, (chapter) =>
      chapter.plays.includes(id)
        ? [`chapter ${chapter.id} (${quoteText(chapter.title)}) plays it`]
        : []
    ),
  ]
);

/** What `hopBreakage` needs to know about the map. */
export interface HopLanding {
  readonly structureIds: ReadonlySet<string>;
  /** The hops the map has: data.mjs's, and at review the proposed ones too. */
  readonly hopIds: ReadonlySet<string>;
  /** The map's data, which a deletion is checked against. */
  readonly data: Pick<MapData, "flows" | "chapters"> | undefined;
}

/**
 * Why accepting `change` would break the map, or nothing when it wouldn't.
 *
 * - A new hop needs two different structures the map has.
 * - A relabel or deletion needs the hop.
 * - A deletion breaks the map when a chapter still plays the hop or a flow
 *   still lists it; each is named.
 */
export const hopBreakage: {
  (landing: HopLanding): (change: HopChange) => Option.Option<string>;
  (change: HopChange, landing: HopLanding): Option.Option<string>;
} = dual(
  2,
  (
    change: HopChange,
    { structureIds, hopIds, data }: HopLanding
  ): Option.Option<string> => {
    if (change.action === "add") {
      const { hop } = change;

      if (hop.from === hop.to) {
        return Option.some(
          `Hop ${hop.id} starts and ends at "${hop.from}". A hop joins two different structures.`
        );
      }

      return Option.map(
        Arr.findFirst([hop.from, hop.to], (end) => !structureIds.has(end)),
        (end) =>
          `No structure in data.mjs has the id "${end}", so hop ${hop.id} has nothing to join.`
      );
    }

    if (!hopIds.has(change.hop)) {
      return Option.some(
        `No hop in data.mjs has the id "${change.hop}", so this ${change.action} has nothing to act on.`
      );
    }

    if (change.action === "delete" && data !== undefined) {
      const references = referencesToHop(data, change.hop);

      return references.length === 0
        ? Option.none()
        : Option.some(
            `Deleting hop "${change.hop}" would leave ${references.length} ${references.length === 1 ? "reference" : "references"} to a hop that is gone: ${Arr.join(references, "; ")}.`
          );
    }

    return Option.none();
  }
);

/**
 * Everything `check` would report for the map as proposed with the hop
 * change added, each marked `added` when the map as proposed now didn't have
 * it. The page shows it while a hop is being drawn, as it does for a drag.
 */
export const hopCandidateProblems = ({
  before,
  change,
}: {
  /** The map as proposed now. */
  readonly before: Checkable;
  readonly change: HopChange;
}): readonly DraggedProblem[] =>
  changedProblems(
    { data: hopChangeToData(before.data, change), layout: before.layout },
    before
  );
