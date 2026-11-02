import { Array as Arr, Option } from "effect";

import { withoutOpenHop } from "./connection-held.ts";
import { hopActionOf } from "./hop-actions.ts";
import { HopLabel, maxHopLabelLength, hopOf } from "./hop-change.ts";
import {
  describeHop,
  factsOfHop,
  hopBreakage,
  hopChangeToData,
  hopLabel,
  summarizeHop,
} from "./hop-effects.ts";
import type { BatchItem, Verdict } from "./proposals.ts";
import { followed, provisionalOf } from "./provisional-ids.ts";
import { plain } from "./review-kind-defaults.ts";
import type { KindSpec, Pointer } from "./review-kinds.ts";
import { decorate } from "./review-quote.ts";
import { refusalOf } from "./text-schemas.ts";

// The kind for a proposed change to the hops: draw one, delete one, relabel
// one. It is one entry of the kind table; `review-kinds.ts` lists it. Which
// flows a hop is in belongs to the flow items.

type HopItem = Extract<BatchItem, { kind: "hop" }>;

/** The name of the mark for hops proposed for deletion, in `Touches.marks`. */
export const removedHopMark = "removed-hop";

/**
 * The name of the mark for hops a proposal draws or relabels, in
 * `Touches.marks`. A hop a reroute touches is not marked: it keeps the look
 * of a rerouted hop.
 */
export const proposedHopMark = "proposed-hop";

/** Said once, in the prompt and in `review`, when a batch holds a hop item. */
const hopNotice =
  "A hop item changes data.mjs, which only you edit. A new hop comes with a provisional id: add it to data.mjs under that id, or under another and give the verdict changed with --as <id>. Add it to the plays of the chapter that should show it, and to the flows the engineer put it in (see the flow items), or the page shows it in none. Deleting a hop also means taking it out of every flow and chapter that lists it; review names them.";

/** What the hop kind adds under a provisional id, and how it says so. */
const provisional = provisionalOf<HopItem>({
  entity: "hop",
  noun: "hop",
  adds: ({ change }) =>
    change.action === "add" ? Option.some(change.hop.id) : Option.none(),
});

/**
 * The id a taken hop item ends up with: the provisional id, or the one the
 * agent gave with `--as`.
 */
const finalIdOf = (item: HopItem, verdict: Verdict): string =>
  Option.getOrElse(provisional.finalIdOf(item, verdict), () =>
    hopOf(item.change)
  );

export const hopKind: KindSpec<HopItem> = {
  ...plain<HopItem>(),
  textLimit: maxHopLabelLength,
  listKey: "hops",
  text: ({ change }) => hopActionOf(change).text(),
  textRefusal: ({ change }, text) =>
    Option.isNone(hopActionOf(change).text())
      ? Option.none()
      : refusalOf(HopLabel, text),
  describe: ({ change }, nameOf, hopLabelOf) =>
    Option.some(describeHop(change, { structure: nameOf, hop: hopLabelOf })),
  // Whether the hop or the structures it joins exist depends on what other
  // proposals add, so `checkConnectionProposals` words these.
  dangling: () => Option.none(),
  notice: hopNotice,
  open: (proposals) =>
    Arr.map(proposals.hops ?? [], (proposal): HopItem => ({
      id: proposal.id,
      kind: "hop",
      change: proposal.change,
    })),
  clear: (proposals) => ({ ...proposals, hops: [] }),
  add: (proposals, { id, change }) => ({
    ...proposals,
    hops: [...(proposals.hops ?? []), { id, change }],
  }),
  discarded: (proposals, { change }) =>
    change.action === "add"
      ? withoutOpenHop(proposals, change.hop.id)
      : proposals,
  name: ({ change }) => hopLabel(change),
  targets: ({ change }): readonly Pointer[] => hopActionOf(change).targets(),
  summary: ({ id, change }, nameOf, hopLabelOf) =>
    summarizeHop(change, id, { structure: nameOf, hop: hopLabelOf }),
  facts: ({ change }, _layout, data) => factsOfHop(change, data),
  appliesToData: ({ change }, map) => ({
    ...map,
    data: hopChangeToData(map.data, change),
  }),
  touches: ({ change }) => {
    const { proposed, removed } = hopActionOf(change).marks();

    return {
      structures: [],
      hops: [hopOf(change)],
      marks: { [removedHopMark]: removed, [proposedHopMark]: proposed },
    };
  },
  breakage: ({ change }, { structureIds, hops, data }) =>
    hopBreakage(change, {
      structureIds,
      hopIds: new Set(Arr.map(hops, ({ id }) => id)),
      data,
    }),
  verdictRefusal: provisional.verdictRefusal,
  renames: provisional.renames,
  retargeted: (item, renames) => {
    const { change } = item;

    if (change.action === "add") {
      const { from, to } = change.hop;

      const next = {
        from: followed(renames, "structure", from),
        to: followed(renames, "structure", to),
      };

      return next.from === from && next.to === to
        ? item
        : { ...item, change: { ...change, hop: { ...change.hop, ...next } } };
    }

    const hop = followed(renames, "hop", change.hop);

    return hop === change.hop ? item : { ...item, change: { ...change, hop } };
  },
  applies: () => [],
  commitRefusal: (item, verdict, { data }) => {
    const { change } = item;

    if (verdict.verdict === "rejected") {
      return Option.none();
    }

    if (change.action === "add") {
      const id = finalIdOf(item, verdict);

      return Arr.some(data.hops, (hop) => hop.id === id)
        ? Option.none()
        : Option.some(
            `data.mjs has no hop with the id "${id}", so item ${item.id} can't be taken. Add the hop to data.mjs${id === change.hop.id ? `, or give the id you used with: verdict ... changed --as <id>` : ""}. Or reject the item.`
          );
    }

    return change.action === "delete" &&
      verdict.verdict === "accepted" &&
      Arr.some(data.hops, ({ id }) => id === change.hop)
      ? Option.some(
          `data.mjs still has the hop "${change.hop}", so item ${item.id} can't be taken as accepted. Remove it from data.mjs, with the flows and chapters that list it, or reject the item.`
        )
      : Option.none();
  },
  accepted: (item, verdict) => {
    const base = { kind: "hop", id: item.id, change: item.change } as const;
    const final = finalIdOf(item, verdict);

    return decorate(
      item.change.action === "add" && final !== item.change.hop.id
        ? { ...base, as: final }
        : base,
      verdict
    );
  },
  rejected: (item, reason) => ({
    kind: "hop",
    id: item.id,
    change: item.change,
    reason,
  }),
  reopened: (item, newId, text) => ({
    ...item,
    id: newId,
    change:
      text === undefined
        ? item.change
        : hopActionOf(item.change).withText(text),
  }),
};
