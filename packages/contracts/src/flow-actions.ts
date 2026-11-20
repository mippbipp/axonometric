import { Array as Arr, Option } from "effect";
import { dual } from "effect/Function";

import type { FlowChange } from "./flow-change.ts";
import type { Flow, MapData } from "./map-data.ts";
import { quoteText } from "./review-quote.ts";
import type { Facts } from "./review-report.ts";

type Action = FlowChange["action"];

/** The change for one action. */
type Of<A extends Action> = Extract<FlowChange, { action: A }>;

/** The names a flow description uses. */
export interface FlowNames {
  readonly flow: (id: string) => string;
  readonly hop: (id: string) => string;
}

/**
 * `flows` with the ones in `order` first, in that order, then the rest in the
 * order they had. An id in `order` that no flow has is skipped.
 */
export const inFlowOrder: {
  (
    order: ReadonlyArray<string>
  ): (flows: ReadonlyArray<Flow>) => ReadonlyArray<Flow>;
  (
    flows: ReadonlyArray<Flow>,
    order: ReadonlyArray<string>
  ): ReadonlyArray<Flow>;
} = dual(
  2,
  (
    flows: ReadonlyArray<Flow>,
    order: ReadonlyArray<string>
  ): ReadonlyArray<Flow> => {
    const listed = Arr.flatMap(order, (id) =>
      Option.toArray(Arr.findFirst(flows, (flow) => flow.id === id))
    );

    return [...listed, ...Arr.filter(flows, ({ id }) => !order.includes(id))];
  }
);

const changeFlow = (
  data: MapData,
  id: string,
  change: (flow: Flow) => Flow
): MapData => ({
  ...data,
  flows: Arr.map(data.flows, (flow) => (flow.id === id ? change(flow) : flow)),
});

const sameList = (a: ReadonlyArray<string>, b: ReadonlyArray<string>) =>
  a.length === b.length && Arr.every(a, (id, index) => b[index] === id);

const listed = (ids: ReadonlyArray<string>) =>
  `[${Arr.join(Arr.map(ids, quoteText), ", ")}]`;

const flowFacts = (
  fields: Readonly<Record<string, string | boolean | ReadonlyArray<string>>>
): Facts => ({ flow: fields });

const named = (flow: string, data: Pick<MapData, "flows"> | undefined) =>
  data === undefined
    ? Option.none<Flow>()
    : Arr.findFirst(data.flows, ({ id }) => id === flow);

/**
 * Everything the map does with one action of a flow change. A new action adds
 * one entry here, and `FlowChange` a member, so none of the code that handles
 * an action by name has to change.
 */
export interface FlowAction<A extends Action> {
  readonly describe: (change: Of<A>, names: FlowNames) => string;
  readonly facts: (
    change: Of<A>,
    data: Pick<MapData, "flows"> | undefined
  ) => { readonly after: Facts; readonly before: Facts };
  /** The flows the change names. */
  readonly flows: (change: Of<A>) => ReadonlyArray<string>;
  /** The hops the change lists, in order. */
  readonly hops: (change: Of<A>) => ReadonlyArray<string>;
  /** Whether the map already has the value the change proposes. */
  readonly isCurrent: (change: Of<A>, data: Pick<MapData, "flows">) => boolean;
  readonly label: string;
  readonly summary: (change: Of<A>, item: string, names: FlowNames) => string;
  readonly text: (change: Of<A>) => Option.Option<string>;
  /** `data` once the change is applied. */
  readonly toData: (change: Of<A>, data: MapData) => MapData;
  readonly withText: (change: Of<A>, text: string) => FlowChange;
}

/** The table: one entry for every action of a flow change. */
const flowActions = {
  add: {
    describe: ({ flow, hops }) =>
      `Create flow “${flow.name}” with ${hops.length} ${hops.length === 1 ? "hop" : "hops"}`,
    facts: ({ flow, hops }) => ({
      after: flowFacts({ hops, id: flow.id, name: flow.name }),
      before: null,
    }),
    flows: ({ flow }) => [flow.id],
    hops: ({ hops }) => hops,
    isCurrent: () => false,
    label: "add flow",
    summary: ({ flow, hops }, item, names) =>
      `add flow ${item}: ${quoteText(flow.name)}, provisional id ${flow.id}, hops ${listed(Arr.map(hops, names.hop))}`,
    text: ({ flow }) => Option.some(flow.name),
    toData: ({ flow, hops }, data) =>
      Arr.some(data.flows, ({ id }) => id === flow.id)
        ? data
        : {
            ...data,
            flows: [...data.flows, { hops, id: flow.id, name: flow.name }],
          },
    withText: (change, name) => ({
      ...change,
      flow: { ...change.flow, name },
    }),
  },
  hops: {
    describe: ({ flow, hops }, names) =>
      `Set the hops of flow “${names.flow(flow)}”: ${Arr.join(Arr.map(hops, names.hop), ", ")}`,
    facts: ({ flow, hops }, data) => ({
      after: flowFacts({ hops }),
      before: Option.match(named(flow, data), {
        onNone: () => null,
        onSome: (found) => flowFacts({ hops: found.hops }),
      }),
    }),
    flows: ({ flow }) => [flow],
    hops: ({ hops }) => hops,
    isCurrent: ({ flow, hops }, data) =>
      Arr.some(
        data.flows,
        (found) => found.id === flow && sameList(found.hops, hops)
      ),
    label: "change flow hops",
    summary: ({ flow, hops }, item, names) =>
      `set the hops of flow ${item}: ${quoteText(names.flow(flow))} plays ${listed(Arr.map(hops, names.hop))} in that order`,
    text: () => Option.none(),
    toData: ({ flow, hops }, data) =>
      changeFlow(data, flow, (found) => ({ ...found, hops })),
    withText: (change) => change,
  },
  rename: {
    describe: ({ flow, name }, names) =>
      `Rename flow “${names.flow(flow)}” to “${name}”`,
    facts: ({ flow, name }, data) => ({
      after: flowFacts({ name }),
      before: Option.match(named(flow, data), {
        onNone: () => null,
        onSome: (found) => flowFacts({ name: found.name }),
      }),
    }),
    flows: ({ flow }) => [flow],
    hops: () => [],
    isCurrent: ({ flow, name }, data) =>
      Arr.some(data.flows, (found) => found.id === flow && found.name === name),
    label: "rename flow",
    summary: ({ flow, name }, item, names) =>
      `rename flow ${item}: ${quoteText(names.flow(flow))} to ${quoteText(name)}`,
    text: ({ name }) => Option.some(name),
    toData: ({ flow, name }, data) =>
      changeFlow(data, flow, (found) => ({ ...found, name })),
    withText: (change, name) => ({ ...change, name }),
  },
  reorder: {
    describe: ({ flows }, names) =>
      `Reorder the flows: ${Arr.join(Arr.map(flows, names.flow), ", ")}`,
    facts: ({ flows }, data) => ({
      after: flowFacts({ flows }),
      before:
        data === undefined
          ? null
          : flowFacts({ flows: Arr.map(data.flows, ({ id }) => id) }),
    }),
    flows: ({ flows }) => flows,
    hops: () => [],
    isCurrent: ({ flows }, data) =>
      sameList(
        Arr.map(inFlowOrder(data.flows, flows), ({ id }) => id),
        Arr.map(data.flows, ({ id }) => id)
      ),
    label: "reorder flows",
    summary: ({ flows }, item, names) =>
      `reorder flows ${item}: ${listed(Arr.map(flows, names.flow))}`,
    text: () => Option.none(),
    toData: ({ flows }, data) => ({
      ...data,
      flows: inFlowOrder(data.flows, flows),
    }),
    withText: (change) => change,
  },
} satisfies { readonly [A in Action]: FlowAction<A> };

/**
 * The entry for `change`'s action, bound to `change`: the one place that
 * matches a change to its entry, so no other code names an action.
 */
export const flowActionOf = (change: FlowChange) => {
  // SAFETY: the table is indexed by `change.action`, so the entry only ever
  // reads the member of the union its key names.
  const entry = flowActions[change.action] as FlowAction<Action>;
  // SAFETY: as above, `change` is the member that `entry` takes.
  const given = change as Of<Action>;

  return {
    describe: (names: FlowNames) => entry.describe(given, names),
    facts: (data: Pick<MapData, "flows"> | undefined) =>
      entry.facts(given, data),
    flows: () => entry.flows(given),
    hops: () => entry.hops(given),
    isCurrent: (data: Pick<MapData, "flows">) => entry.isCurrent(given, data),
    label: entry.label,
    summary: (item: string, names: FlowNames) =>
      entry.summary(given, item, names),
    text: () => entry.text(given),
    toData: (data: MapData) => entry.toData(given, data),
    withText: (text: string) => entry.withText(given, text),
  };
};

/**
 * Hop `hop` in the flow `flow`'s list once it joins or leaves: added at the
 * end where it is missing and wanted, taken out where it is there and not.
 * Nothing when the flow would be left with no hop, since a flow lists at
 * least one.
 */
export const hopsWith = ({
  flow,
  hop,
  wanted,
}: {
  readonly flow: Flow;
  readonly hop: string;
  readonly wanted: boolean;
}): Option.Option<readonly [string, ...Array<string>]> => {
  const without = Arr.filter(flow.hops, (other) => other !== hop);
  const next = wanted ? [...without, hop] : without;

  return Arr.isReadonlyArrayNonEmpty(next) ? Option.some(next) : Option.none();
};
