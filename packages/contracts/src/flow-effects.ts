import { Array as Arr, Match, Option } from "effect";
import { dual } from "effect/Function";

import type { FlowChange } from "./flow-change.ts";
import type { Flow, MapData } from "./map-data.ts";
import { quoteText } from "./review-quote.ts";
import type { Facts } from "./review-report.ts";

/** The names a flow description uses. */
export interface FlowNames {
  readonly hop: (id: string) => string;
  readonly flow: (id: string) => string;
}

const changeFlow = (
  data: MapData,
  id: string,
  change: (flow: Flow) => Flow
): MapData => ({
  ...data,
  flows: Arr.map(data.flows, (flow) => (flow.id === id ? change(flow) : flow)),
});

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

/**
 * `data` with `change` applied, as the page shows it before the agent has
 * decided. A new flow goes at the end.
 */
export const flowChangeToData: {
  (change: FlowChange): (data: MapData) => MapData;
  (data: MapData, change: FlowChange): MapData;
} = dual(2, (data: MapData, change: FlowChange): MapData =>
  Match.value(change).pipe(
    Match.discriminatorsExhaustive("action")({
      add: ({ flow, hops }): MapData =>
        Arr.some(data.flows, ({ id }) => id === flow.id)
          ? data
          : {
              ...data,
              flows: [...data.flows, { id: flow.id, name: flow.name, hops }],
            },
      rename: ({ flow, name }): MapData =>
        changeFlow(data, flow, (found) => ({ ...found, name })),
      hops: ({ flow, hops }): MapData =>
        changeFlow(data, flow, (found) => ({ ...found, hops })),
      reorder: ({ flows }): MapData => ({
        ...data,
        flows: inFlowOrder(data.flows, flows),
      }),
    })
  )
);

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && Arr.every(a, (id, index) => b[index] === id);

/** Whether the map already has the value `change` proposes. */
export const flowIsCurrent: {
  (change: FlowChange): (data: Pick<MapData, "flows">) => boolean;
  (data: Pick<MapData, "flows">, change: FlowChange): boolean;
} = dual(2, (data: Pick<MapData, "flows">, change: FlowChange): boolean =>
  Match.value(change).pipe(
    Match.discriminatorsExhaustive("action")({
      add: () => false,
      rename: ({ flow, name }) =>
        Arr.some(
          data.flows,
          (found) => found.id === flow && found.name === name
        ),
      hops: ({ flow, hops }) =>
        Arr.some(
          data.flows,
          (found) => found.id === flow && sameList(found.hops, hops)
        ),
      reorder: ({ flows }) =>
        sameList(
          Arr.map(inFlowOrder(data.flows, flows), ({ id }) => id),
          Arr.map(data.flows, ({ id }) => id)
        ),
    })
  )
);

/** A word for the kind of change, as `review` lists it. */
export const flowLabel = (change: FlowChange): string =>
  Match.value(change).pipe(
    Match.discriminatorsExhaustive("action")({
      add: () => "add flow",
      rename: () => "rename flow",
      hops: () => "change flow hops",
      reorder: () => "reorder flows",
    })
  );

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/** What the Pending list says about a flow change, in plain words. */
export const describeFlow: {
  (names: FlowNames): (change: FlowChange) => string;
  (change: FlowChange, names: FlowNames): string;
} = dual(2, (change: FlowChange, names: FlowNames): string => {
  const hopNames = (ids: readonly string[]) =>
    Arr.join(Arr.map(ids, names.hop), ", ");

  return Match.value(change).pipe(
    Match.discriminatorsExhaustive("action")({
      add: ({ flow, hops }) =>
        `Create flow “${flow.name}” with ${count(hops.length, "hop")}`,
      rename: ({ flow, name }) =>
        `Rename flow “${names.flow(flow)}” to “${name}”`,
      hops: ({ flow, hops }) =>
        `Set the hops of flow “${names.flow(flow)}”: ${hopNames(hops)}`,
      reorder: ({ flows }) =>
        `Reorder the flows: ${Arr.join(Arr.map(flows, names.flow), ", ")}`,
    })
  );
});

const listed = (ids: readonly string[]) =>
  `[${Arr.join(Arr.map(ids, quoteText), ", ")}]`;

/** One line for the prompt; everything the engineer typed goes through `quoteText`. */
export const summarizeFlow: {
  (item: string, names: FlowNames): (change: FlowChange) => string;
  (change: FlowChange, item: string, names: FlowNames): string;
} = dual(3, (change: FlowChange, item: string, names: FlowNames): string => {
  const hopNames = (ids: readonly string[]) => listed(Arr.map(ids, names.hop));

  return Match.value(change).pipe(
    Match.discriminatorsExhaustive("action")({
      add: ({ flow, hops }) =>
        `add flow ${item}: ${quoteText(flow.name)}, provisional id ${flow.id}, hops ${hopNames(hops)}`,
      rename: ({ flow, name }) =>
        `rename flow ${item}: ${quoteText(names.flow(flow))} to ${quoteText(name)}`,
      hops: ({ flow, hops }) =>
        `set the hops of flow ${item}: ${quoteText(names.flow(flow))} plays ${hopNames(hops)} in that order`,
      reorder: ({ flows }) =>
        `reorder flows ${item}: ${listed(Arr.map(flows, names.flow))}`,
    })
  );
});

const flowFacts = (
  fields: Readonly<Record<string, string | boolean | readonly string[]>>
): Facts => ({ flow: fields });

/** `review`'s before and after for a flow change, given the map as data.mjs has it. */
export const factsOfFlow: {
  (data: Pick<MapData, "flows"> | undefined): (change: FlowChange) => {
    readonly before: Facts;
    readonly after: Facts;
  };
  (
    change: FlowChange,
    data: Pick<MapData, "flows"> | undefined
  ): { readonly before: Facts; readonly after: Facts };
} = dual(
  2,
  (
    change: FlowChange,
    data: Pick<MapData, "flows"> | undefined
  ): { readonly before: Facts; readonly after: Facts } => {
    const current = (id: string): Option.Option<Flow> =>
      data === undefined
        ? Option.none()
        : Arr.findFirst(data.flows, (flow) => flow.id === id);

    return Match.value(change).pipe(
      Match.discriminatorsExhaustive("action")({
        add: ({ flow, hops }) => ({
          before: null,
          after: flowFacts({ id: flow.id, name: flow.name, hops }),
        }),
        rename: ({ flow, name }) => ({
          before: Option.match(current(flow), {
            onNone: () => null,
            onSome: (found) => flowFacts({ name: found.name }),
          }),
          after: flowFacts({ name }),
        }),
        hops: ({ flow, hops }) => ({
          before: Option.match(current(flow), {
            onNone: () => null,
            onSome: (found) => flowFacts({ hops: found.hops }),
          }),
          after: flowFacts({ hops }),
        }),
        reorder: ({ flows }) => ({
          before:
            data === undefined
              ? null
              : flowFacts({ flows: Arr.map(data.flows, ({ id }) => id) }),
          after: flowFacts({ flows }),
        }),
      })
    );
  }
);

/** What `flowBreakage` needs to know about the map. */
export interface FlowLanding {
  /** The hops the map has: data.mjs's, and at review the proposed ones too. */
  readonly hopIds: ReadonlySet<string>;
  /** The flows data.mjs has, or nothing when the caller has only ids of hops. */
  readonly flowIds: ReadonlySet<string> | undefined;
}

/**
 * Why accepting `change` would break the map, or nothing when it wouldn't.
 * A flow needs hops the map has, and a rename or hops change needs the flow.
 */
export const flowBreakage: {
  (landing: FlowLanding): (change: FlowChange) => Option.Option<string>;
  (change: FlowChange, landing: FlowLanding): Option.Option<string>;
} = dual(
  2,
  (
    change: FlowChange,
    { hopIds, flowIds }: FlowLanding
  ): Option.Option<string> => {
    const missingFlow = (id: string) =>
      flowIds !== undefined && !flowIds.has(id)
        ? Option.some(
            `No flow in data.mjs has the id "${id}", so this ${change.action} has nothing to act on.`
          )
        : Option.none<string>();

    const missingHop = (hops: readonly string[]) =>
      Option.map(
        Arr.findFirst(hops, (id) => !hopIds.has(id)),
        (id) =>
          `No hop in data.mjs has the id "${id}", so the flow can't list it.`
      );

    return Match.value(change).pipe(
      Match.discriminatorsExhaustive("action")({
        add: ({ hops }) => missingHop(hops),
        rename: ({ flow }) => missingFlow(flow),
        hops: ({ flow, hops }) =>
          Option.orElse(missingFlow(flow), () => missingHop(hops)),
        reorder: ({ flows }) =>
          Option.flatMap(
            Arr.findFirst(
              flows,
              (id) => flowIds !== undefined && !flowIds.has(id)
            ),
            missingFlow
          ),
      })
    );
  }
);
