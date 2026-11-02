import { Array as Arr, Option, Record as Rec, Result } from "effect";

import { footprintsOverlap } from "./layout-checks.ts";
import type { Layout } from "./layout.ts";
import type { MapData } from "./map-data.ts";
import type { ChangeId, Proposals, StructureProposal } from "./proposals.ts";
import { frozenRefusal } from "./review.ts";
import { describePlacement } from "./structure-effects.ts";
import { sameSubject, structureOf } from "./structure-change.ts";
import type { StructureChange } from "./structure-change.ts";

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

/** The structure the data has now, for comparing a proposed value with it. */
const currentValue = (
  world: StructureWorld,
  change: StructureChange
): boolean => {
  const found = Arr.findFirst(
    world.data.structures,
    ({ id }) => id === structureOf(change)
  );

  if (Option.isNone(found)) {
    return false;
  }

  const structure = found.value;

  switch (change.action) {
    case "rename": {
      return structure.name === change.name;
    }

    case "shape": {
      return structure.shape === change.shape;
    }

    case "group": {
      return structure.group === change.group;
    }

    case "status": {
      return structure.status === change.status;
    }

    default: {
      return false;
    }
  }
};

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

  const { structure: made } = held.change;

  const next: StructureChange | undefined = (() => {
    switch (change.action) {
      case "rename": {
        return { ...held.change, structure: { ...made, name: change.name } };
      }

      case "shape": {
        return { ...held.change, structure: { ...made, shape: change.shape } };
      }

      case "group": {
        return { ...held.change, structure: { ...made, group: change.group } };
      }

      case "status": {
        return {
          ...held.change,
          structure: { ...made, status: change.status },
        };
      }

      default: {
        return;
      }
    }
  })();

  return Option.some(
    next === undefined
      ? Arr.filter(open, (_, index) => index !== at.value)
      : Arr.map(open, (proposal, index) =>
          index === at.value ? { ...proposal, change: next } : proposal
        )
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
  const own = Arr.findFirst(open, (proposal) => proposal.id === id);

  if (Option.isNone(own)) {
    const waiting = Option.getOrUndefined(frozenRefusal(proposals, id));

    if (waiting !== undefined) {
      return Result.fail(waiting);
    }

    if (idTaken(proposals, id)) {
      return Result.fail(`The id "${id}" is already in use.`);
    }
  } else if (!sameSubject(own.value.change, change)) {
    return Result.fail(`The id "${id}" is already in use.`);
  }

  const target = structureOf(change);

  if (Arr.some(frozenAdds(proposals), (waiting) => waiting === target)) {
    return Result.fail(
      `"${target}" is a new structure in a batch that is waiting for the agent. Edits go in the next batch, once the agent commits.`
    );
  }

  if (
    Option.isSome(own) &&
    own.value.change.action === "add" &&
    change.action === "add"
  ) {
    // Moving or resizing a structure that is still only a proposal.
  } else if (change.action !== "add") {
    const proposed = editedAdd(open, change);

    if (Option.isSome(proposed)) {
      return Result.succeed(bump(proposals, proposed.value));
    }

    if (!Arr.some(world.data.structures, (s) => s.id === target)) {
      return Result.fail(
        `No structure in the map has the id "${target}", so there is nothing to ${change.action}.`
      );
    }
  }

  const refusal = worldRefusal(world, change);

  if (Option.isSome(refusal)) {
    return Result.fail(refusal.value);
  }

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
    return Result.succeed(
      Option.isNone(twin)
        ? proposals
        : bump(
            proposals,
            Arr.filter(open, (proposal) => proposal.id !== keptId)
          )
    );
  }

  const next: StructureProposal = { id: keptId, change };

  const existing = Arr.findFirst(open, (proposal) => proposal.id === keptId);

  if (
    Option.isSome(existing) &&
    JSON.stringify(existing.value.change) === JSON.stringify(change)
  ) {
    return Result.succeed(proposals);
  }

  return Result.succeed(
    bump(
      proposals,
      Option.isSome(existing)
        ? Arr.map(open, (proposal) =>
            proposal.id === keptId ? next : proposal
          )
        : [...open, next]
    )
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
