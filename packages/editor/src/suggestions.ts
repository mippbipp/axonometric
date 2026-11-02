// oxlint-disable effecttsgo/missing-pipeable-signature -- these are called with their arguments in hand from components, never piped.

import type { ItemStatus, TextField } from "@axonometric/contracts";
import { Array as Arr, Option } from "effect";

import { entriesOfKind, useReview } from "./review-context.ts";
import type { KindEntry } from "./review-context.ts";

export type Entry = KindEntry<"suggestion">;

/** Whether the agent took the suggestion, so data.mjs says it now. */
export const wasTaken = (status: ItemStatus) =>
  status.state === "reviewed" && status.verdict.verdict !== "rejected";

/**
 * The suggestion for `field` of `structure` that the page shows: the one
 * waiting on the agent if there is one, else the latest reviewed.
 */
export const useSuggestionFor = (
  structure: string,
  field: TextField
): Option.Option<Entry> => {
  const entries = useReview()?.entries ?? [];

  const mine = Arr.filter(
    entriesOfKind(entries, "suggestion"),
    ({ item }) => item.target.id === structure && item.field === field
  );

  return Option.orElse(
    Arr.findFirst(mine, ({ status }) => status.state !== "reviewed"),
    () => Arr.last(mine)
  );
};

/** The suggestion, when the engineer can still change it: it is open, not in a batch. */
export const openOf = (found: Entry | undefined): Entry | undefined =>
  found?.status.state === "open" ? found : undefined;

/**
 * Whether the engineer can start or change a suggestion for the field: not
 * while one waits in a batch, which belongs to the agent until the commit.
 */
export const canSuggest = (found: Entry | undefined): boolean =>
  found?.status.state !== "frozen";
