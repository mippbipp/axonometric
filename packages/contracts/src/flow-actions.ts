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
  readonly hop: (id: string) => string;
  readonly flow: (id: string) => string;
}

/**
 * `flows` with the ones in `order` first, in that order, then the rest in the
 * order they had. An id in `order` that no flow has is skipped.
 */
export const inFlowOrder: {
  (order: readonly string[]): (flows: readonly Flow[]) => readonly Flow[];
  (flows: readonly Flow[], order: readonly string[]): readonly Flow[];
} = dual(
  2,
  (flows: readonly Flow[], order: readonly string[]): readonly Flow[] => {
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

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && Arr.every(a, (id, index) => b[index] === id);

const listed = (ids: readonly string[]) =>
  `[${Arr.join(Arr.map(ids, quoteText), ", ")}]`;

const flowFacts = (
  fields: Readonly<Record<string, string | boolean | readonly string[]>>
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
  readonly label: string;
  /** `data` once the change is applied. */
  readonly toData: (change: Of<A>, data: MapData) => MapData;
  /** Whether the map already has the value the change proposes. */
  readonly isCurrent: (change: Of<A>, data: Pick<MapData, "flows">) => boolean;
  readonly describe: (change: Of<A>, names: FlowNames) => string;
  readonly summary: (change: Of<A>, item: string, names: FlowNames) => string;
  readonly facts: (
    change: Of<A>,
    data: Pick<MapData, "flows"> | undefined
  ) => { readonly before: Facts; readonly after: Facts };
  readonly text: (change: Of<A>) => Option.Option<string>;
  readonly withText: (change: Of<A>, text: string) => FlowChange;
  /** The hops the change lists, in order. */
  readonly hops: (change: Of<A>) => readonly string[];
  /** The flows the change names. */
  readonly flows: (change: Of<A>) => readonly string[];
}

/** The table: one entry for every action of a flow change. */
const flowActions = {
  add: {
    label: "add flow",
    toData: ({ flow, hops }, data) =>
      Arr.some(data.flows, ({ id }) => id === flow.id)
        ? data
        : {
            ...data,
            flows: [...data.flows, { id: flow.id, name: flow.name, hops }],
          },
    isCurrent: () => false,
    describe: ({ flow, hops }) =>
      `Create flow “${flow.name}” with ${hops.length} ${hops.length === 1 ? "hop" : "hops"}`,
    summary: ({ flow, hops }, item, names) =>
      `add flow ${item}: ${quoteText(flow.name)}, provisional id ${flow.id}, hops ${listed(Arr.map(hops, names.hop))}`,
    facts: ({ flow, hops }) => ({
      before: null,
      after: flowFacts({ id: flow.id, name: flow.name, hops }),
    }),
    text: ({ flow }) => Option.some(flow.name),
    withText: (change, name) => ({
      ...change,
      flow: { ...change.flow, name },
    }),
    hops: ({ hops }) => hops,
    flows: ({ flow }) => [flow.id],
  },
  rename: {
    label: "rename flow",
    toData: ({ flow, name }, data) =>
      changeFlow(data, flow, (found) => ({ ...found, name })),
    isCurrent: ({ flow, name }, data) =>
      Arr.some(data.flows, (found) => found.id === flow && found.name === name),
    describe: ({ flow, name }, names) =>
      `Rename flow “${names.flow(flow)}” to “${name}”`,
    summary: ({ flow, name }, item, names) =>
      `rename flow ${item}: ${quoteText(names.flow(flow))} to ${quoteText(name)}`,
    facts: ({ flow, name }, data) => ({
      before: Option.match(named(flow, data), {
        onNone: () => null,
        onSome: (found) => flowFacts({ name: found.name }),
      }),
      after: flowFacts({ name }),
    }),
    text: ({ name }) => Option.some(name),
    withText: (change, name) => ({ ...change, name }),
    hops: () => [],
    flows: ({ flow }) => [flow],
  },
  hops: {
    label: "change flow hops",
    toData: ({ flow, hops }, data) =>
      changeFlow(data, flow, (found) => ({ ...found, hops })),
    isCurrent: ({ flow, hops }, data) =>
      Arr.some(
        data.flows,
        (found) => found.id === flow && sameList(found.hops, hops)
      ),
    describe: ({ flow, hops }, names) =>
      `Set the hops of flow “${names.flow(flow)}”: ${Arr.join(Arr.map(hops, names.hop), ", ")}`,
    summary: ({ flow, hops }, item, names) =>
      `set the hops of flow ${item}: ${quoteText(names.flow(flow))} plays ${listed(Arr.map(hops, names.hop))} in that order`,
    facts: ({ flow, hops }, data) => ({
      before: Option.match(named(flow, data), {
        onNone: () => null,
        onSome: (found) => flowFacts({ hops: found.hops }),
      }),
      after: flowFacts({ hops }),
    }),
    text: () => Option.none(),
    withText: (change) => change,
    hops: ({ hops }) => hops,
    flows: ({ flow }) => [flow],
  },
  reorder: {
    label: "reorder flows",
    toData: ({ flows }, data) => ({
      ...data,
      flows: inFlowOrder(data.flows, flows),
    }),
    isCurrent: ({ flows }, data) =>
      sameList(
        Arr.map(inFlowOrder(data.flows, flows), ({ id }) => id),
        Arr.map(data.flows, ({ id }) => id)
      ),
    describe: ({ flows }, names) =>
      `Reorder the flows: ${Arr.join(Arr.map(flows, names.flow), ", ")}`,
    summary: ({ flows }, item, names) =>
      `reorder flows ${item}: ${listed(Arr.map(flows, names.flow))}`,
    facts: ({ flows }, data) => ({
      before:
        data === undefined
          ? null
          : flowFacts({ flows: Arr.map(data.flows, ({ id }) => id) }),
      after: flowFacts({ flows }),
    }),
    text: () => Option.none(),
    withText: (change) => change,
    hops: () => [],
    flows: ({ flows }) => flows,
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
    label: entry.label,
    toData: (data: MapData) => entry.toData(given, data),
    isCurrent: (data: Pick<MapData, "flows">) => entry.isCurrent(given, data),
    describe: (names: FlowNames) => entry.describe(given, names),
    summary: (item: string, names: FlowNames) =>
      entry.summary(given, item, names),
    facts: (data: Pick<MapData, "flows"> | undefined) =>
      entry.facts(given, data),
    text: () => entry.text(given),
    withText: (text: string) => entry.withText(given, text),
    hops: () => entry.hops(given),
    flows: () => entry.flows(given),
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
}): Option.Option<readonly [string, ...string[]]> => {
  const without = Arr.filter(flow.hops, (other) => other !== hop);
  const next = wanted ? [...without, hop] : without;

  return Arr.isReadonlyArrayNonEmpty(next) ? Option.some(next) : Option.none();
};
