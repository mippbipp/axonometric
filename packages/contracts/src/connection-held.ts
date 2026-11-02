import { Array as Arr } from "effect";

import type { FlowChange } from "./flow-change.ts";
import type { HopChange } from "./hop-change.ts";
import type { Proposals } from "./proposals.ts";

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
