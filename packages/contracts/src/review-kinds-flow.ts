import { Array as Arr, Option } from "effect";

import { flowActionOf } from "./flow-actions.ts";
import { FlowName, flowOf, maxFlowNameLength } from "./flow-change.ts";
import {
  describeFlow,
  factsOfFlow,
  flowBreakage,
  flowChangeToData,
  flowLabel,
  summarizeFlow,
} from "./flow-effects.ts";
import type { BatchItem, Verdict } from "./proposals.ts";
import { followed, provisionalOf } from "./provisional-ids.ts";
import { plain } from "./review-kind-defaults.ts";
import type { KindSpec, Pointer } from "./review-kinds.ts";
import { decorate } from "./review-quote.ts";
import { refusalOf } from "./text-schemas.ts";

// The kind for a proposed change to the flows: create one, rename one, set
// the ordered hops of one, and reorder the flows. It is one entry of the
// kind table; `review-kinds.ts` lists it.

type FlowItem = Extract<BatchItem, { kind: "flow" }>;

/** The name of the mark for flows a proposal creates or changes, in `Touches.marks`. */
export const changedFlowMark = "changed-flows";

/** Said once, in the prompt and in `review`, when a batch holds a flow item. */
const flowNotice =
  "A flow item changes data.mjs, which only you edit. A new flow comes with a provisional id: add it to data.mjs under that id, or under another and give the verdict changed with --as <id>. A hops item gives the flow's whole list of hops in order; a reorder item lists the flows in their new order in the flows array. The last chapter's flow picker plays a flow's hops in the order the flow lists them.";

/** What the flow kind adds under a provisional id, and how it says so. */
const provisional = provisionalOf<FlowItem>({
  adds: ({ change }) =>
    change.action === "add" ? Option.some(change.flow.id) : Option.none(),
  entity: "flow",
  noun: "flow",
});

const finalIdOf = (item: FlowItem, verdict: Verdict): string =>
  Option.getOrElse(provisional.finalIdOf(item, verdict), () =>
    flowOf(item.change)
  );

export const flowKind: KindSpec<FlowItem> = {
  ...plain<FlowItem>(),
  describe: ({ change }, called) =>
    Option.some(describeFlow(change, { flow: (id) => id, hop: called.hop })),
  listKey: "flows",
  text: ({ change }) => flowActionOf(change).text(),
  textLimit: maxFlowNameLength,
  textRefusal: ({ change }, text) =>
    Option.isNone(flowActionOf(change).text())
      ? Option.none()
      : refusalOf(FlowName, text),
  // Whether a flow or its hops exist depends on what other proposals add, so
  // `checkConnectionProposals` words these.
  accepted: (item, verdict) => {
    const base = { change: item.change, id: item.id, kind: "flow" } as const;
    const final = finalIdOf(item, verdict);

    return decorate(
      item.change.action === "add" && final !== item.change.flow.id
        ? { ...base, as: final }
        : base,
      verdict
    );
  },
  add: (proposals, { change, id }) => ({
    ...proposals,
    flows: [...(proposals.flows ?? []), { change, id }],
  }),
  applies: () => [],
  appliesToData: ({ change }, map) => ({
    ...map,
    data: flowChangeToData(map.data, change),
  }),
  breakage: ({ change }, { data, hops }) =>
    flowBreakage(change, {
      flowIds:
        data === undefined
          ? undefined
          : new Set(Arr.map(data.flows, ({ id }) => id)),
      hopIds: new Set(Arr.map(hops, ({ id }) => id)),
    }),
  clear: (proposals) => ({ ...proposals, flows: [] }),
  commitRefusal: (item, verdict, { data }) => {
    const { change } = item;

    if (verdict.verdict === "rejected" || change.action !== "add") {
      return Option.none();
    }

    const id = finalIdOf(item, verdict);

    return Arr.some(data.flows, (flow) => flow.id === id)
      ? Option.none()
      : Option.some(
          `data.mjs has no flow with the id "${id}", so item ${item.id} can't be taken. Add the flow to data.mjs${id === change.flow.id ? `, or give the id you used with: verdict ... changed --as <id>` : ""}. Or reject the item.`
        );
  },
  dangling: () => Option.none(),
  facts: ({ change }, _layout, data) => factsOfFlow(change, data),
  name: ({ change }) => flowLabel(change),
  notice: flowNotice,
  open: (proposals) =>
    Arr.map(proposals.flows ?? [], (proposal): FlowItem => ({
      change: proposal.change,
      id: proposal.id,
      kind: "flow",
    })),
  rejected: (item, reason) => ({
    change: item.change,
    id: item.id,
    kind: "flow",
    reason,
  }),
  renames: provisional.renames,
  reopened: (item, newId, text) => ({
    ...item,
    change:
      text === undefined
        ? item.change
        : flowActionOf(item.change).withText(text),
    id: newId,
  }),
  retargeted: (item, renames) => {
    const { change } = item;
    const hop = (id: string) => followed(renames, "hop", id);
    const flow = (id: string) => followed(renames, "flow", id);

    if (change.action === "add") {
      const hops = Arr.map(change.hops, hop);

      return Arr.every(hops, (id, index) => id === change.hops[index])
        ? item
        : { ...item, change: { ...change, hops } };
    }

    if (change.action === "rename") {
      const next = flow(change.flow);

      return next === change.flow
        ? item
        : { ...item, change: { ...change, flow: next } };
    }

    if (change.action === "hops") {
      const hops = Arr.map(change.hops, hop);
      const next = flow(change.flow);

      return next === change.flow &&
        Arr.every(hops, (id, index) => id === change.hops[index])
        ? item
        : { ...item, change: { ...change, flow: next, hops } };
    }

    const flows = Arr.map(change.flows, flow);

    return Arr.every(flows, (id, index) => id === change.flows[index])
      ? item
      : { ...item, change: { ...change, flows } };
  },
  summary: ({ change, id }, called) =>
    summarizeFlow(change, id, { flow: (flow) => flow, hop: called.hop }),
  targets: ({ change }): ReadonlyArray<Pointer> =>
    Arr.map(flowActionOf(change).hops(), (id): Pointer => ({
      id,
      kind: "hop",
    })),
  touches: ({ change }) => ({
    hops: [],
    marks: [{ ids: flowActionOf(change).flows(), name: changedFlowMark }],
    structures: [],
  }),
  verdictRefusal: provisional.verdictRefusal,
};
