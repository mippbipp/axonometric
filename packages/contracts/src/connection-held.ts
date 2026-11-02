import { Array as Arr } from "effect";
import { dual } from "effect/Function";

import type { FlowChange } from "./flow-change.ts";
import type { HopChange } from "./hop-change.ts";
import type { FlowProposal, Proposals } from "./proposals.ts";

/** What a list of proposals holds, for the helpers below. */
type Held = Pick<Proposals, "hops" | "flows" | "batches">;

/** The changes of the hop items open now, not in a batch yet. */
export const openHopChanges = (proposals: Held): readonly HopChange[] =>
  Arr.map(proposals.hops ?? [], ({ change }) => change);

/** The changes of the hop items in batches that no commit has closed. */
export const frozenHopChanges = (proposals: Held): readonly HopChange[] =>
  Arr.flatMap(proposals.batches ?? [], (batch) =>
    batch.committed === undefined
      ? Arr.flatMap(batch.items, (item) =>
          item.kind === "hop" ? [item.change] : []
        )
      : []
  );

/** The provisional ids of the hops a list of changes adds. */
export const addedHopIds = (changes: readonly HopChange[]): readonly string[] =>
  Arr.flatMap(changes, (change) =>
    change.action === "add" ? [change.hop.id] : []
  );

/** The changes of the flow items open now, not in a batch yet. */
export const openFlowChanges = (proposals: Held): readonly FlowChange[] =>
  Arr.map(proposals.flows ?? [], ({ change }) => change);

/** The changes of the flow items in batches that no commit has closed. */
export const frozenFlowChanges = (proposals: Held): readonly FlowChange[] =>
  Arr.flatMap(proposals.batches ?? [], (batch) =>
    batch.committed === undefined
      ? Arr.flatMap(batch.items, (item) =>
          item.kind === "flow" ? [item.change] : []
        )
      : []
  );

/** The provisional ids of the flows a list of changes adds. */
export const addedFlowIds = (
  changes: readonly FlowChange[]
): readonly string[] =>
  Arr.flatMap(changes, (change) =>
    change.action === "add" ? [change.flow.id] : []
  );

/**
 * `proposals` without hop `hop` in the open flow proposals: a flow that
 * listed it loses it, and a flow left with no hop loses its proposal.
 */
export const withoutOpenHop: {
  (hop: string): (proposals: Proposals) => Proposals;
  (proposals: Proposals, hop: string): Proposals;
} = dual(2, (proposals: Proposals, hop: string): Proposals => {
  const open = proposals.flows ?? [];

  if (
    !Arr.some(open, ({ change }) =>
      change.action === "add" || change.action === "hops"
        ? change.hops.includes(hop)
        : false
    )
  ) {
    return proposals;
  }

  const kept = Arr.flatMap(open, (proposal): readonly FlowProposal[] => {
    const { change } = proposal;

    if (change.action !== "add" && change.action !== "hops") {
      return [proposal];
    }

    const hops = Arr.filter(change.hops, (other) => other !== hop);

    return Arr.isReadonlyArrayNonEmpty(hops)
      ? [{ ...proposal, change: { ...change, hops } }]
      : [];
  });

  return { ...proposals, revision: proposals.revision + 1, flows: kept };
});
