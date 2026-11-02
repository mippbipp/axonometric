import { statusLabels } from "@axonometric/contracts";
import type { StructureChange } from "@axonometric/contracts";
import { Match } from "effect";

/** What a structure proposal says in the Pending list, in a few words. */
export const describeStructureChange = (
  change: StructureChange,
  nameOf: (id: string) => string,
  groupTitleOf: (id: string) => string
): string =>
  Match.value(change).pipe(
    Match.discriminatorsExhaustive("action")({
      add: ({ structure, at }) =>
        `Add ${structure.name} (${structure.shape}, ${statusLabels[structure.status]}) to ${groupTitleOf(structure.group)} at ${at.x}, ${at.y}`,
      delete: ({ structure }) => `Delete ${nameOf(structure)}`,
      rename: ({ structure, name }) => `Rename ${nameOf(structure)} to ${name}`,
      shape: ({ structure, shape }) =>
        `Change the shape of ${nameOf(structure)} to ${shape}`,
      group: ({ structure, group }) =>
        `Move ${nameOf(structure)} to ${groupTitleOf(group)}`,
      status: ({ structure, status }) =>
        `Change the status of ${nameOf(structure)} to ${statusLabels[status]}`,
    })
  );
