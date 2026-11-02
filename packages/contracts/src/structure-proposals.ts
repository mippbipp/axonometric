import { Array as Arr, Match, Option, Record as Rec, Result } from "effect";

import { footprintsOverlap } from "./layout-checks.ts";
import type { Layout } from "./layout.ts";
import type { MapData } from "./map-data.ts";
import type { ChangeId, Proposals, StructureProposal } from "./proposals.ts";
import { frozenRefusal } from "./review.ts";
import { sameSubject, structureOf } from "./structure-change.ts";
import type { StructureChange } from "./structure-change.ts";
import { describePlacement } from "./structure-effects.ts";

/** What a structure proposal is checked against. */
export interface StructureWorld {
  readonly data: Pick<MapData, "structures" | "groups">;
  /**
   * The layout open changes land on: the accepted layout with the frozen
   * layout changes and the structures proposed so far placed in it.
   */
  readonly layout: Layout;
}

const openOf = (proposals: Proposals): readonly StructureProposal[] =>
  proposals.structures ?? [];

/** Every structure proposal in a batch no commit has closed. */
const frozenAdds = (proposals: Proposals) =>
  Arr.flatMap(proposals.batches ?? [], (batch) =>
    batch.committed === undefined
      ? Arr.flatMap(batch.items, (item) =>
          item.kind === "structure" && item.change.action === "add"
            ? [item.change.structure.id]
            : []
        )
      : []
  );

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

/** Why `change` can't be proposed against `world`, or nothing. */
const worldRefusal = (
  world: StructureWorld,
  change: StructureChange
): Option.Option<string> => {
  const hasGroup = (group: string) =>
    Arr.some(world.data.groups, ({ id }) => id === group);

  if (change.action === "add") {
    const { structure: made, at } = change;

    if (Arr.some(world.data.structures, ({ id }) => id === made.id)) {
      return Option.some(
        `data.mjs already has a structure with the id "${made.id}".`
      );
    }

    if (!hasGroup(made.group)) {
      return Option.some(noGroup(made.group));
    }

    const others = Rec.toEntries(world.layout.structures);

    return Option.map(
      Arr.findFirst(
        others,
        ([id, placement]) => id !== made.id && footprintsOverlap(at, placement)
      ),
      ([id, placement]) =>
        `${describePlacement(at)} would overlap "${id}" at ${describePlacement(placement)}. Pick a free spot.`
    );
  }

  if (change.action === "group" && !hasGroup(change.group)) {
    return Option.some(noGroup(change.group));
  }

  return Option.none();
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
      onSome: (structure) =>
        Match.value(change).pipe(
          Match.discriminatorsExhaustive("action")({
            add: () => false,
            delete: () => false,
            rename: ({ name }) => structure.name === name,
            shape: ({ shape }) => structure.shape === shape,
            group: ({ group }) => structure.group === group,
            status: ({ status }) => structure.status === status,
          })
        ),
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

  if (Option.isNone(at)) {
    return Option.none();
  }

  const held = open[at.value];

  if (held === undefined || held.change.action !== "add") {
    return Option.none();
  }

  const { structure: made, at: footprint } = held.change;

  const withMade = (fields: Partial<typeof made>): StructureChange => ({
    action: "add",
    structure: { ...made, ...fields },
    at: footprint,
  });

  const next: Option.Option<StructureChange> = Match.value(change).pipe(
    Match.discriminatorsExhaustive("action")({
      add: () => Option.none(),
      delete: () => Option.none(),
      rename: ({ name }) => Option.some(withMade({ name })),
      shape: ({ shape }) => Option.some(withMade({ shape })),
      group: ({ group }) => Option.some(withMade({ group })),
      status: ({ status }) => Option.some(withMade({ status })),
    })
  );

  return Option.some(
    Option.match(next, {
      onNone: () => Arr.filter(open, (_, index) => index !== at.value),
      onSome: (changed) =>
        Arr.map(open, (proposal, index) =>
          index === at.value ? { ...proposal, change: changed } : proposal
        ),
    })
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
 * - A change that leaves a field as data.mjs has it takes the open proposal
 *   for that field away.
 * - Fails, and changes nothing, when `id` is in a batch, the change names a
 *   structure the map lacks or a new structure waiting in a batch, or the
 *   change would not fit: an unknown group, a provisional id data.mjs already
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

  return Arr.some(frozenAdds(proposals), (waiting) => waiting === target)
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
    JSON.stringify(existing.value.change) === JSON.stringify(change)
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
 * Removes open structure proposal `id`. Fails when it is in a batch, which is
 * waiting for the agent, or isn't there.
 */
export const discardStructureProposal = ({
  proposals,
  id,
}: {
  readonly proposals: Proposals;
  readonly id: ChangeId;
}): Result.Result<Proposals, string> => {
  const open = openOf(proposals);

  if (!Arr.some(open, (proposal) => proposal.id === id)) {
    return Result.fail(
      Option.getOrElse(
        frozenRefusal(proposals, id),
        () =>
          `No open structure proposal has the id "${id}". It may have been discarded already.`
      )
    );
  }

  return Result.succeed(
    bump(
      proposals,
      Arr.filter(open, (proposal) => proposal.id !== id)
    )
  );
};
