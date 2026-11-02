import type { Result } from "effect";
import { Array as Arr, Option, Record as Rec, String as Str } from "effect";
import { dual } from "effect/Function";

import { footprintsOverlap } from "./layout-checks.ts";
import type { Layout } from "./layout.ts";
import type { MapData } from "./map-data.ts";
import { mapWarning } from "./problems.ts";
import type { MapProblem } from "./problems.ts";
import { newChangeId } from "./proposals.ts";
import type { ChangeId, Proposals, StructureProposal } from "./proposals.ts";
import { proposeInto } from "./propose-engine.ts";
import type { ProposalKind } from "./propose-engine.ts";
import { actionOf } from "./structure-actions.ts";
import {
  provisionalIdOf,
  sameStructureChange,
  sameSubject,
  structureOf,
} from "./structure-change.ts";
import type { StructureChange } from "./structure-change.ts";
import { describePlacement } from "./structure-effects.ts";
import { addedIds, frozenStructureChanges } from "./structure-held.ts";

/**
 * What a structure proposal is checked against: the map as proposed, so a
 * structure or group an earlier proposal adds is known to later ones.
 */
export interface StructureWorld {
  readonly data: Pick<MapData, "structures" | "groups">;
  /** The layout open changes land on, with proposed structures placed. */
  readonly layout: Layout;
}

const openOf = (proposals: Proposals): readonly StructureProposal[] =>
  proposals.structures ?? [];

const noGroup = (group: string) =>
  `No group in the map has the id "${group}". Pick one of the map's groups.`;

const hasGroup = (world: StructureWorld, group: string) =>
  Arr.some(world.data.groups, ({ id }) => id === group);

/** Why `change` can't be proposed against `world`, or nothing. */
const worldRefusal = (
  world: StructureWorld,
  change: StructureChange
): Option.Option<string> => {
  if (change.action === "group") {
    return hasGroup(world, change.group)
      ? Option.none()
      : Option.some(noGroup(change.group));
  }

  if (change.action !== "add") {
    return Option.none();
  }

  const { structure: made, at } = change;

  if (Arr.some(world.data.structures, ({ id }) => id === made.id)) {
    return Option.some(
      `The map already has a structure with the id "${made.id}".`
    );
  }

  if (!hasGroup(world, made.group)) {
    return Option.some(noGroup(made.group));
  }

  return Option.map(
    Arr.findFirst(
      Rec.toEntries(world.layout.structures),
      ([id, placement]) => id !== made.id && footprintsOverlap(at, placement)
    ),
    ([id, placement]) =>
      `${describePlacement(at)} would overlap "${id}" at ${describePlacement(placement)}. Pick a free spot.`
  );
};

/** Whether the map already has the value `change` proposes. */
const currentValue = (
  world: StructureWorld,
  change: StructureChange
): boolean =>
  Option.match(
    Arr.findFirst(
      world.data.structures,
      ({ id }) => id === structureOf(change)
    ),
    {
      onNone: () => false,
      onSome: (structure) => actionOf(change).isCurrent(structure),
    }
  );

/** An open add changed in the one field `change` names, or taken off with a delete. */
const editedAdd = (
  open: readonly StructureProposal[],
  change: StructureChange
): Option.Option<readonly StructureProposal[]> => {
  const id = structureOf(change);

  const at = Arr.findFirstIndex(
    open,
    ({ change: held }) => held.action === "add" && held.structure.id === id
  );

  const held = Option.flatMap(at, (index) => Option.fromNullishOr(open[index]));

  return Option.flatMap(held, (proposal) => {
    const { change: made } = proposal;

    if (made.action !== "add") {
      return Option.none();
    }

    const next = actionOf(change).onProposed(made.structure);

    return Option.some(
      Option.match(next, {
        onNone: () => Arr.filter(open, (other) => other.id !== proposal.id),
        onSome: (structure) =>
          Arr.map(open, (other) =>
            other.id === proposal.id
              ? { ...other, change: { ...made, structure } }
              : other
          ),
      })
    );
  });
};

/** What the propose engine needs to know about structure proposals on `world`. */
const structureKind = (
  world: StructureWorld
): ProposalKind<StructureChange> => ({
  noun: "structure",
  open: openOf,
  withOpen: (held, structures) => ({
    ...held,
    revision: held.revision + 1,
    structures,
  }),
  targetOf: structureOf,
  isAdd: (change) => change.action === "add",
  sameChange: sameStructureChange,
  sameSubject,
  waitingAdds: (held) => addedIds(frozenStructureChanges(held)),
  edited: editedAdd,
  refusal: (change) => {
    const missing =
      change.action !== "add" &&
      !Arr.some(world.data.structures, ({ id }) => id === structureOf(change));

    return missing
      ? Option.some(
          `No structure in the map has the id "${structureOf(change)}", so there is nothing to ${change.action}.`
        )
      : worldRefusal(world, change);
  },
  isCurrent: (change) => currentValue(world, change),
});

/**
 * Sets the open structure proposal `id` to `change`, which is how the page
 * adds a structure, deletes, renames or reshapes one, and moves or resizes a
 * structure it proposed. The rules are those of `proposeInto`, and a
 * structure change fails, and changes nothing, when it names a group the map
 * lacks, a provisional id the map already has, or a footprint on top of
 * another.
 */
export const proposeStructure = ({
  proposals,
  id,
  change,
  world,
}: {
  readonly proposals: Proposals;
  readonly id: ChangeId;
  readonly change: StructureChange;
  readonly world: StructureWorld;
}): Result.Result<Proposals, string> =>
  proposeInto({ kind: structureKind(world), proposals, id, change });

/** A fresh provisional id for a structure called `name`, such as `build-cache-4f2a`. */
export const newProvisionalId = (name: string): string =>
  provisionalIdOf(name, Str.slice(0, 4)(newChangeId()));

/**
 * Warnings about open structure proposals that no longer fit `data`: an add
 * whose id data.mjs has taken, and a change to a structure data.mjs lost.
 * `data` is data.mjs as the agent left it, not the proposed map.
 */
export const checkStructureProposals: {
  (proposals: Proposals): (data: MapData) => readonly MapProblem[];
  (data: MapData, proposals: Proposals): readonly MapProblem[];
} = dual(2, (data: MapData, proposals: Proposals): readonly MapProblem[] => {
  const mapIds = new Set(Arr.map(data.structures, ({ id }) => id));
  const added = addedIds(frozenStructureChanges(proposals));

  return Arr.flatMap(openOf(proposals), ({ change }, index) => {
    const id = structureOf(change);
    const path = ["structures", index, "change", "structure"];

    if (change.action === "add") {
      return mapIds.has(id)
        ? [
            mapWarning({
              file: "proposals.json",
              path: [...path, "id"],
              message: `data.mjs already has a structure with the id "${id}", which this proposal adds. Discard it from the page's Pending list.`,
            }),
          ]
        : [];
    }

    return mapIds.has(id) || Arr.some(added, (other) => other === id)
      ? []
      : [
          mapWarning({
            file: "proposals.json",
            path,
            message: `no structure in data.mjs has the id "${id}", so this ${change.action} does nothing. Discard it from the page's Pending list.`,
          }),
        ];
  });
});
