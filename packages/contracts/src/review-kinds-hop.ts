import { Array as Arr, Match, Option } from "effect";

import { withoutOpenHop } from "./connection-held.ts";
import { hopOf, maxHopLabelLength, hopRenameKey } from "./hop-change.ts";
import {
  hopBreakage,
  factsOfHop,
  hopChangeToData,
  describeHop,
  hopLabel,
  summarizeHop,
} from "./hop-effects.ts";
import type { BatchItem, Verdict } from "./proposals.ts";
import { plain } from "./review-kind-defaults.ts";
import type { KindSpec, Pointer } from "./review-kinds.ts";
import { decorate } from "./review-quote.ts";

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

/**
 * The id a taken hop item ends up with: the provisional id, or the one the
 * agent gave with `--as`.
 */
const finalIdOf = (item: HopItem, verdict: Verdict): string =>
  item.change.action === "add" &&
  verdict.verdict === "changed" &&
  verdict.as !== undefined
    ? verdict.as
    : hopOf(item.change);

export const hopKind: KindSpec<HopItem> = {
  ...plain<HopItem>(),
  textLimit: maxHopLabelLength,
  listKey: "hops",
  text: ({ change }) =>
    Match.value(change).pipe(
      Match.discriminatorsExhaustive("action")({
        add: ({ hop }) => Option.some(hop.label),
        relabel: ({ label }) => Option.some(label),
        delete: () => Option.none(),
      })
    ),
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
  discarded: (proposals, { change }) =>
    change.action === "add"
      ? withoutOpenHop(proposals, change.hop.id)
      : proposals,
  add: (proposals, { id, change }) => ({
    ...proposals,
    hops: [...(proposals.hops ?? []), { id, change }],
  }),
  name: ({ change }) => hopLabel(change),
  targets: ({ change }): readonly Pointer[] =>
    change.action === "add"
      ? [
          { kind: "structure", id: change.hop.from },
          { kind: "structure", id: change.hop.to },
        ]
      : [{ kind: "hop", id: change.hop }],
  summary: ({ id, change }, nameOf, hopLabelOf) =>
    summarizeHop(change, id, { structure: nameOf, hop: hopLabelOf }),
  facts: ({ change }, _layout, data) => factsOfHop(change, data),
  appliesToData: ({ change }, map) => ({
    ...map,
    data: hopChangeToData(map.data, change),
  }),
  touches: ({ change }) => ({
    structures: [],
    hops: [hopOf(change)],
    marks: {
      [removedHopMark]: change.action === "delete" ? [hopOf(change)] : [],
      [proposedHopMark]: change.action === "delete" ? [] : [hopOf(change)],
    },
  }),
  breakage: ({ change }, { structureIds, hops, data }) =>
    hopBreakage(change, {
      structureIds,
      hopIds: new Set(Arr.map(hops, ({ id }) => id)),
      data,
    }),
  verdictRefusal: (item, verdict, { acceptedHops, taken }) => {
    if (verdict.verdict !== "changed" || verdict.as === undefined) {
      return Option.none();
    }

    if (item.change.action !== "add") {
      return Option.some(
        "--as gives a new hop the id you used for it in data.mjs. This item does not add a hop."
      );
    }

    if (acceptedHops.has(verdict.as)) {
      return Option.some(
        `--as ${verdict.as} names a hop the accepted map already has. Pick the id of the new hop you added to data.mjs.`
      );
    }

    return Option.map(
      Arr.findFirst(
        [...taken.entries()],
        ([other, id]) => other !== item.id && id === verdict.as
      ),
      ([other]) =>
        `--as ${verdict.as} is already the final id of item ${other} in this batch. Give each new hop its own id.`
    );
  },
  renames: (item, verdict) => {
    if (verdict.verdict === "rejected" || item.change.action !== "add") {
      return [];
    }

    const to = finalIdOf(item, verdict);

    return to === item.change.hop.id
      ? []
      : [[hopRenameKey(item.change.hop.id), to]];
  },
  retargeted: (item, renames) => {
    const { change } = item;
    const moved = (id: string) => renames.get(id) ?? id;

    if (change.action === "add") {
      const { from, to } = change.hop;

      return moved(from) === from && moved(to) === to
        ? item
        : {
            ...item,
            change: {
              ...change,
              hop: { ...change.hop, from: moved(from), to: moved(to) },
            },
          };
    }

    const hop = moved(hopRenameKey(change.hop));

    return hop === hopRenameKey(change.hop)
      ? item
      : { ...item, change: { ...change, hop } };
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
  reopened: (item, newId, text) => {
    const { change } = item;

    if (text === undefined) {
      return { ...item, id: newId };
    }

    if (change.action === "add") {
      return {
        ...item,
        id: newId,
        change: { ...change, hop: { ...change.hop, label: text } },
      };
    }

    return change.action === "relabel"
      ? { ...item, id: newId, change: { ...change, label: text } }
      : { ...item, id: newId };
  },
};
