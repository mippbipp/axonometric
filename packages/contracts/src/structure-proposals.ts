import {
  Array as Arr,
  Option,
  Record as Rec,
  Result,
  String as Str,
} from "effect";
import { dual } from "effect/Function";

import { footprintsOverlap } from "./layout-checks.ts";
import type { Layout } from "./layout.ts";
import type { MapData } from "./map-data.ts";
import { mapWarning } from "./problems.ts";
import type { MapProblem } from "./problems.ts";
import { newChangeId } from "./proposals.ts";
import type { ChangeId, Proposals, StructureProposal } from "./proposals.ts";
import { frozenRefusal } from "./review.ts";
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

/** Whether `id` is already used by an item of any kind, open or in a batch. */
const idTaken = (proposals: Proposals, id: string) =>
  Arr.some(openItemIds(proposals), (other) => other === id) ||
  Arr.some(proposals.batches ?? [], ({ items }) =>
    Arr.some(items, (item) => item.id === id)
  );

const openItemIds = (proposals: Proposals): readonly string[] => [
  ...Arr.map(proposals.layout, ({ id }) => id),
  ...Arr.map(proposals.notes ?? [], ({ id }) => id),
  ...Arr.map(openOf(proposals), ({ id }) => id),
];

const noGroup = (group: string) =>
  `No group in the map has the id "${group}". Pick one of the map's groups.`;

const bump = (
  proposals: Proposals,
  structures: readonly StructureProposal[]
): Proposals => ({
  ...proposals,
  revision: proposals.revision + 1,
  structures,
});

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

/** Why `id` can't be used for `change`: it is a frozen item, or another proposal's. */
const idRefusal = (
  proposals: Proposals,
  id: ChangeId,
  change: StructureChange
): Option.Option<string> => {
  const own = Arr.findFirst(
    openOf(proposals),
    (proposal) => proposal.id === id
  );

  const taken = `The id "${id}" is already in use.`;

  if (Option.isSome(own)) {
    return sameSubject(own.value.change, change)
      ? Option.none()
      : Option.some(taken);
  }

  return Option.orElse(frozenRefusal(proposals, id), () =>
    idTaken(proposals, id) ? Option.some(taken) : Option.none()
  );
};

/** Why `change` can't name the structure it does: it is added twice, or waits in a batch. */
const targetRefusal = (
  proposals: Proposals,
  id: ChangeId,
  change: StructureChange
): Option.Option<string> => {
  const target = structureOf(change);

  const addedTwice =
    change.action === "add" &&
    Arr.some(
      openOf(proposals),
      (other) =>
        other.id !== id &&
        other.change.action === "add" &&
        other.change.structure.id === target
    );

  if (addedTwice) {
    return Option.some(
      `Another proposal already adds a structure with the id "${target}".`
    );
  }

  const waiting = addedIds(frozenStructureChanges(proposals));

  return Arr.some(waiting, (other) => other === target)
    ? Option.some(
        `"${target}" is a new structure in a batch that is waiting for the agent. Edits go in the next batch, once the agent commits.`
      )
    : Option.none();
};

/**
 * `proposals` with `change` set as the open proposal for its structure and
 * action, under the id that proposal already has if there is one. A change
 * that leaves a field as the map has it takes the proposal away.
 */
const setProposal = ({
  proposals,
  id,
  change,
  world,
}: {
  readonly proposals: Proposals;
  readonly id: ChangeId;
  readonly change: StructureChange;
  readonly world: StructureWorld;
}): Proposals => {
  const open = openOf(proposals);

  const twin = Arr.findFirst(
    open,
    (proposal) =>
      proposal.change.action !== "add" && sameSubject(proposal.change, change)
  );

  const keptId = Option.match(twin, {
    onNone: () => id,
    onSome: (found) => found.id,
  });

  if (change.action !== "add" && currentValue(world, change)) {
    return Option.isNone(twin)
      ? proposals
      : bump(
          proposals,
          Arr.filter(open, (proposal) => proposal.id !== keptId)
        );
  }

  const existing = Arr.findFirst(open, (proposal) => proposal.id === keptId);

  if (
    Option.isSome(existing) &&
    sameStructureChange(existing.value.change, change)
  ) {
    return proposals;
  }

  return bump(
    proposals,
    Option.isSome(existing)
      ? Arr.map(open, (proposal) =>
          proposal.id === keptId ? { id: keptId, change } : proposal
        )
      : [...open, { id: keptId, change }]
  );
};

/**
 * Sets the open structure proposal `id` to `change`, which is how the page
 * adds a structure, deletes, renames or reshapes one, and moves or resizes a
 * structure it proposed.
 *
 * - The same `id` and `change` sent again succeeds and changes nothing, so a
 *   retry never makes a duplicate.
 * - `id` held by an open proposal of the same structure and action replaces
 *   its change. A change to a structure that is already proposed, such as a
 *   rename of a new structure, edits that proposal instead of making another.
 * - A change that leaves a field as the map has it takes the open proposal
 *   for that field away.
 * - Fails, and changes nothing, when `id` is in a batch, the change names a
 *   structure the map lacks or a new structure waiting in a batch, or the
 *   change would not fit: an unknown group, a provisional id the map already
 *   has, or a footprint on top of another.
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
}): Result.Result<Proposals, string> => {
  const open = openOf(proposals);

  const refusal = Option.orElse(idRefusal(proposals, id, change), () =>
    targetRefusal(proposals, id, change)
  );

  if (Option.isSome(refusal)) {
    return Result.fail(refusal.value);
  }

  // A change to a structure that is only proposed edits that proposal.
  const proposed =
    change.action === "add" ? Option.none() : editedAdd(open, change);

  if (Option.isSome(proposed)) {
    return Result.succeed(bump(proposals, proposed.value));
  }

  const missing =
    change.action !== "add" &&
    !Arr.some(
      world.data.structures,
      ({ id: other }) => other === structureOf(change)
    );

  if (missing) {
    return Result.fail(
      `No structure in the map has the id "${structureOf(change)}", so there is nothing to ${change.action}.`
    );
  }

  const unfit = worldRefusal(world, change);

  if (Option.isSome(unfit)) {
    return Result.fail(unfit.value);
  }

  return Result.succeed(setProposal({ proposals, id, change, world }));
};
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
