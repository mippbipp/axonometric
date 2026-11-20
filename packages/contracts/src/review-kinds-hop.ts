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
  adds: ({ change }) =>
    change.action === "add" ? Option.some(change.hop.id) : Option.none(),
  entity: "hop",
  noun: "hop",
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
  describe: ({ change }, called) =>
    Option.some(
      describeHop(change, { hop: called.hop, structure: called.structure })
    ),
  listKey: "hops",
  text: ({ change }) => hopActionOf(change).text(),
  textLimit: maxHopLabelLength,
  textRefusal: ({ change }, text) =>
    Option.isNone(hopActionOf(change).text())
      ? Option.none()
      : refusalOf(HopLabel, text),
  // Whether the hop or the structures it joins exist depends on what other
  // proposals add, so `checkConnectionProposals` words these.
  accepted: (item, verdict) => {
    const base = { change: item.change, id: item.id, kind: "hop" } as const;
    const final = finalIdOf(item, verdict);

    return decorate(
      item.change.action === "add" && final !== item.change.hop.id
        ? { ...base, as: final }
        : base,
      verdict
    );
  },
  add: (proposals, { change, id }) => ({
    ...proposals,
    hops: [...(proposals.hops ?? []), { change, id }],
  }),
  applies: () => [],
  appliesToData: ({ change }, map) => ({
    ...map,
    data: hopChangeToData(map.data, change),
  }),
  breakage: ({ change }, { data, hops, structureIds }) =>
    hopBreakage(change, {
      data,
      hopIds: new Set(Arr.map(hops, ({ id }) => id)),
      structureIds,
    }),
  clear: (proposals) => ({ ...proposals, hops: [] }),
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
  dangling: () => Option.none(),
  discarded: (proposals, { change }) =>
    change.action === "add"
      ? withoutOpenHop(proposals, change.hop.id)
      : proposals,
  facts: ({ change }, _layout, data) => factsOfHop(change, data),
  name: ({ change }) => hopLabel(change),
  notice: hopNotice,
  open: (proposals) =>
    Arr.map(proposals.hops ?? [], (proposal): HopItem => ({
      change: proposal.change,
      id: proposal.id,
      kind: "hop",
    })),
  rejected: (item, reason) => ({
    change: item.change,
    id: item.id,
    kind: "hop",
    reason,
  }),
  renames: provisional.renames,
  reopened: (item, newId, text) => ({
    ...item,
    change:
      text === undefined
        ? item.change
        : hopActionOf(item.change).withText(text),
    id: newId,
  }),
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
  summary: ({ change, id }, called) =>
    summarizeHop(change, id, { hop: called.hop, structure: called.structure }),
  targets: ({ change }): ReadonlyArray<Pointer> =>
    hopActionOf(change).targets(),
  touches: ({ change }) => {
    const { proposed, removed } = hopActionOf(change).marks();

    return {
      hops: [hopOf(change)],
      marks: [
        { ids: removed, name: removedHopMark },
        { ids: proposed, name: proposedHopMark },
      ],
      structures: [],
    };
  },
  verdictRefusal: provisional.verdictRefusal,
};
