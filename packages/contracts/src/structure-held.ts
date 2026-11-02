import { Array as Arr } from "effect";

import type { Proposals } from "./proposals.ts";
import type { StructureChange } from "./structure-change.ts";

/** What a list of proposals holds, for the helpers below. */
type Held = Pick<Proposals, "structures" | "batches">;

/** The changes of the structure items open now, not in a batch yet. */
export const openStructureChanges = (
  proposals: Held
): readonly StructureChange[] =>
  Arr.map(proposals.structures ?? [], ({ change }) => change);

/** The changes of the structure items in batches that no commit has closed. */
export const frozenStructureChanges = (
  proposals: Held
): readonly StructureChange[] =>
  Arr.flatMap(proposals.batches ?? [], (batch) =>
    batch.committed === undefined
      ? Arr.flatMap(batch.items, (item) =>
          item.kind === "structure" ? [item.change] : []
        )
      : []
  );

/** The provisional ids of the structures a list of changes adds. */
export const addedIds = (
  changes: readonly StructureChange[]
): readonly string[] =>
  Arr.flatMap(changes, (change) =>
    change.action === "add" ? [change.structure.id] : []
  );

