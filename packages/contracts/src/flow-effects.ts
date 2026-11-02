import { Array as Arr, Option } from "effect";
import { dual } from "effect/Function";

import { flowActionOf } from "./flow-actions.ts";
import type { FlowNames } from "./flow-actions.ts";
import type { FlowChange } from "./flow-change.ts";
import type { MapData } from "./map-data.ts";
import type { Facts } from "./review-report.ts";

export { hopsWith, inFlowOrder } from "./flow-actions.ts";

export type { FlowNames } from "./flow-actions.ts";

/**
 * `data` with `change` applied, as the page shows it before the agent has
 * decided. A new flow goes at the end.
 */
export const flowChangeToData: {
  (change: FlowChange): (data: MapData) => MapData;
  (data: MapData, change: FlowChange): MapData;
} = dual(2, (data: MapData, change: FlowChange): MapData =>
  flowActionOf(change).toData(data)
);

/** Whether the map already has the value `change` proposes. */
export const flowIsCurrent: {
  (change: FlowChange): (data: Pick<MapData, "flows">) => boolean;
  (data: Pick<MapData, "flows">, change: FlowChange): boolean;
} = dual(2, (data: Pick<MapData, "flows">, change: FlowChange): boolean =>
  flowActionOf(change).isCurrent(data)
);

/** A word for the kind of change, as `review` lists it. */
export const flowLabel = (change: FlowChange): string =>
  flowActionOf(change).label;

/** What the Pending list says about a flow change, in plain words. */
export const describeFlow: {
  (names: FlowNames): (change: FlowChange) => string;
  (change: FlowChange, names: FlowNames): string;
} = dual(2, (change: FlowChange, names: FlowNames): string =>
  flowActionOf(change).describe(names)
);

/** One line for the prompt; everything the engineer typed goes through `quoteText`. */
export const summarizeFlow: {
  (item: string, names: FlowNames): (change: FlowChange) => string;
  (change: FlowChange, item: string, names: FlowNames): string;
} = dual(3, (change: FlowChange, item: string, names: FlowNames): string =>
  flowActionOf(change).summary(item, names)
);

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
  ): { readonly before: Facts; readonly after: Facts } =>
    flowActionOf(change).facts(data)
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
    const action = flowActionOf(change);

    const missingFlow = Option.map(
      Arr.findFirst(
        action.flows(),
        (id) =>
          change.action !== "add" && flowIds !== undefined && !flowIds.has(id)
      ),
      (id) =>
        `No flow in data.mjs has the id "${id}", so this ${change.action} has nothing to act on.`
    );

    const missingHop = Option.map(
      Arr.findFirst(action.hops(), (id) => !hopIds.has(id)),
      (id) =>
        `No hop in data.mjs has the id "${id}", so the flow can't list it.`
    );

    return Option.orElse(missingFlow, () => missingHop);
  }
);
