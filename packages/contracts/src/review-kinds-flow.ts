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
  entity: "flow",
  noun: "flow",
  adds: ({ change }) =>
    change.action === "add" ? Option.some(change.flow.id) : Option.none(),
});

const finalIdOf = (item: FlowItem, verdict: Verdict): string =>
  Option.getOrElse(provisional.finalIdOf(item, verdict), () =>
    flowOf(item.change)
  );

export const flowKind: KindSpec<FlowItem> = {
  ...plain<FlowItem>(),
  textLimit: maxFlowNameLength,
  listKey: "flows",
  text: ({ change }) => flowActionOf(change).text(),
  textRefusal: ({ change }, text) =>
    Option.isNone(flowActionOf(change).text())
      ? Option.none()
      : refusalOf(FlowName, text),
  describe: ({ change }, _nameOf, hopLabelOf) =>
    Option.some(describeFlow(change, { hop: hopLabelOf, flow: (id) => id })),
  // Whether a flow or its hops exist depends on what other proposals add, so
  // `checkConnectionProposals` words these.
  dangling: () => Option.none(),
  notice: flowNotice,
  open: (proposals) =>
    Arr.map(proposals.flows ?? [], (proposal): FlowItem => ({
      id: proposal.id,
      kind: "flow",
      change: proposal.change,
    })),
  clear: (proposals) => ({ ...proposals, flows: [] }),
  add: (proposals, { id, change }) => ({
    ...proposals,
    flows: [...(proposals.flows ?? []), { id, change }],
  }),
  name: ({ change }) => flowLabel(change),
  targets: ({ change }): readonly Pointer[] =>
    Arr.map(flowActionOf(change).hops(), (id): Pointer => ({
      kind: "hop",
      id,
    })),
  summary: ({ id, change }, _nameOf, hopLabelOf) =>
    summarizeFlow(change, id, { hop: hopLabelOf, flow: (flow) => flow }),
  facts: ({ change }, _layout, data) => factsOfFlow(change, data),
  appliesToData: ({ change }, map) => ({
    ...map,
    data: flowChangeToData(map.data, change),
  }),
  touches: ({ change }) => ({
    structures: [],
    hops: [],
    marks: { [changedFlowMark]: flowActionOf(change).flows() },
  }),
  breakage: ({ change }, { hops, data }) =>
    flowBreakage(change, {
      hopIds: new Set(Arr.map(hops, ({ id }) => id)),
      flowIds:
        data === undefined
          ? undefined
          : new Set(Arr.map(data.flows, ({ id }) => id)),
    }),
  verdictRefusal: provisional.verdictRefusal,
  renames: provisional.renames,
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
  applies: () => [],
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
  accepted: (item, verdict) => {
    const base = { kind: "flow", id: item.id, change: item.change } as const;
    const final = finalIdOf(item, verdict);

    return decorate(
      item.change.action === "add" && final !== item.change.flow.id
        ? { ...base, as: final }
        : base,
      verdict
    );
  },
  rejected: (item, reason) => ({
    kind: "flow",
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
        : flowActionOf(item.change).withText(text),
  }),
};
