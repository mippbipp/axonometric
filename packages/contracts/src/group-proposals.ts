import { Array as Arr, Option, Result, String as Str } from "effect";

import {
  groupOf,
  sameGroupSubject,
  titleOf,
  provisionalGroupIdOf,
} from "./group-change.ts";
import type { GroupChange } from "./group-change.ts";
import type { MapData } from "./map-data.ts";
import { newChangeId } from "./proposals.ts";
import type { ChangeId, GroupProposal, Proposals } from "./proposals.ts";
import { frozenRefusal, reviewEntries } from "./review.ts";
import { proposeStructure } from "./structure-proposals.ts";
import type { StructureWorld } from "./structure-proposals.ts";

/** What a group proposal is checked against. */
export interface GroupWorld {
  /**
   * The map as proposed, open and frozen items applied, so a group an
   * earlier proposal adds is known to later ones.
   */
  readonly data: Pick<MapData, "groups">;
  /** The map with only the frozen items applied: what an open item lands on. */
  readonly base: Pick<MapData, "groups">;
}

const openOf = (proposals: Proposals): readonly GroupProposal[] =>
  proposals.groups ?? [];

const bump = (
  proposals: Proposals,
  groups: readonly GroupProposal[]
): Proposals => ({
  ...proposals,
  revision: proposals.revision + 1,
  groups,
});

const idInUse = (proposals: Proposals, id: string) =>
  Arr.some(reviewEntries(proposals), ({ item }) => item.id === id);

/** The provisional ids of the groups that batches waiting for the agent add. */
const waitingAdds = (proposals: Proposals): readonly string[] =>
  Arr.flatMap(proposals.batches ?? [], (batch) =>
    batch.committed === undefined
      ? Arr.flatMap(batch.items, (item) =>
          item.kind === "group" && item.change.action === "add"
            ? [item.change.group.id]
            : []
        )
      : []
  );

const idRefusal = (
  proposals: Proposals,
  id: ChangeId,
  change: GroupChange
): Option.Option<string> => {
  const own = Arr.findFirst(openOf(proposals), (found) => found.id === id);
  const taken = `The id "${id}" is already in use.`;

  if (Option.isSome(own)) {
    return sameGroupSubject(own.value.change, change)
      ? Option.none()
      : Option.some(taken);
  }

  return Option.orElse(frozenRefusal(proposals, id), () =>
    idInUse(proposals, id) ? Option.some(taken) : Option.none()
  );
};

const sameTitle = (a: string, b: string) =>
  Str.toLowerCase(Str.trim(a)) === Str.toLowerCase(Str.trim(b));

/** Why no other group may be called `title`, or nothing. */
const titleRefusal = (
  world: GroupWorld,
  group: string,
  title: string
): Option.Option<string> =>
  Option.map(
    Arr.findFirst(
      world.data.groups,
      (other) => other.id !== group && sameTitle(other.title, title)
    ),
    () =>
      `The map already has a group called "${title}". Pick another title, so the zones stay tellable apart.`
  );

/**
 * `proposals` with `change` set as an open group proposal. A rename of a group
 * that is only proposed edits the proposal that adds it. A rename that leaves
 * the title as the map has it takes the open rename away.
 */
const setProposal = ({
  proposals,
  id,
  change,
  world,
}: {
  readonly proposals: Proposals;
  readonly id: ChangeId;
  readonly change: GroupChange;
  readonly world: GroupWorld;
}): Proposals => {
  const open = openOf(proposals);

  const twin = Arr.findFirst(open, (found) =>
    sameGroupSubject(found.change, change)
  );

  const keptId = Option.match(twin, {
    onNone: () => id,
    onSome: (found) => found.id,
  });

  if (change.action === "rename") {
    const was = Arr.findFirst(
      world.base.groups,
      (group) => group.id === change.group
    );

    if (Option.exists(was, (group) => group.title === change.title)) {
      return Option.isNone(twin)
        ? proposals
        : bump(
            proposals,
            Arr.filter(open, (found) => found.id !== keptId)
          );
    }
  }

  const existing = Arr.findFirst(open, (found) => found.id === keptId);

  return bump(
    proposals,
    Option.isSome(existing)
      ? Arr.map(open, (found) =>
          found.id === keptId ? { id: keptId, change } : found
        )
      : [...open, { id: keptId, change }]
  );
};

/**
 * Sets the open group proposal `id` to `change`, which is how the page creates
 * and renames a group.
 *
 * - The same `id` and `change` sent again succeeds and changes nothing.
 * - A rename of a group that is only proposed edits the add, so renaming
 *   it leaves no second proposal behind.
 * - A rename to the title the map has takes the open rename away.
 * - Fails, and changes nothing, when `id` is in a batch, the group the change
 *   names isn't there, a new group's id is already a group's, a new group is
 *   waiting in a batch, or another group has the title.
 */
export const proposeGroup = ({
  proposals,
  id,
  change,
  world,
}: {
  readonly proposals: Proposals;
  readonly id: ChangeId;
  readonly change: GroupChange;
  readonly world: GroupWorld;
}): Result.Result<Proposals, string> => {
  const open = openOf(proposals);
  const refusal = idRefusal(proposals, id, change);

  if (Option.isSome(refusal)) {
    return Result.fail(refusal.value);
  }

  const target = groupOf(change);

  const inBatch = Arr.some(waitingAdds(proposals), (other) => other === target);

  if (inBatch) {
    return Result.fail(
      change.action === "add"
        ? `Another proposal already adds a group with the id "${target}".`
        : `"${target}" is a new group in a batch that is waiting for the agent. Edits go in the next batch, once the agent commits.`
    );
  }

  const added = Arr.findFirst(
    open,
    (found) => found.change.action === "add" && found.change.group.id === target
  );

  if (change.action === "rename" && Option.isSome(added)) {
    const { change: made } = added.value;

    if (made.action !== "add") {
      return Result.succeed(proposals);
    }

    const renamed = titleRefusal(world, target, change.title);

    return Option.isSome(renamed)
      ? Result.fail(renamed.value)
      : Result.succeed(
          bump(
            proposals,
            Arr.map(open, (found) =>
              found.id === added.value.id
                ? {
                    ...found,
                    change: {
                      action: "add" as const,
                      group: { ...made.group, title: change.title },
                    },
                  }
                : found
            )
          )
        );
  }

  if (change.action === "add") {
    const own = Arr.some(open, (found) => found.id === id);

    if (
      Option.isSome(added) &&
      added.value.id !== id &&
      added.value.change.action === "add"
    ) {
      return Result.fail(
        `Another proposal already adds a group with the id "${target}".`
      );
    }

    if (!own && Arr.some(world.data.groups, (group) => group.id === target)) {
      return Result.fail(
        `The map already has a group with the id "${target}".`
      );
    }
  } else if (!Arr.some(world.data.groups, (group) => group.id === target)) {
    return Result.fail(
      `No group in the map has the id "${target}", so there is nothing to rename.`
    );
  }

  const duplicated = titleRefusal(world, target, titleOf(change));

  if (Option.isSome(duplicated)) {
    return Result.fail(duplicated.value);
  }

  const existing = Arr.findFirst(open, (found) => found.id === id);

  if (
    Option.isSome(existing) &&
    sameGroupSubject(existing.value.change, change) &&
    JSON.stringify(existing.value.change) === JSON.stringify(change)
  ) {
    return Result.succeed(proposals);
  }

  return Result.succeed(setProposal({ proposals, id, change, world }));
};

/** One structure that moves into a new group, with the id of its proposal. */
export interface Member {
  readonly id: ChangeId;
  readonly structure: string;
}

/**
 * Proposes a new group and moves `members` into it, all or nothing: the add
 * and one group change per member go in together, or the first refusal comes
 * back and nothing changes. `structures` is the world a member's group change
 * is checked against, without the new group, which this adds.
 */
export const proposeGroupWithMembers = ({
  proposals,
  id,
  change,
  members,
  world,
  structures,
}: {
  readonly proposals: Proposals;
  readonly id: ChangeId;
  readonly change: GroupChange;
  readonly members: readonly Member[];
  readonly world: GroupWorld;
  readonly structures: StructureWorld;
}): Result.Result<Proposals, string> => {
  if (change.action !== "add" && members.length > 0) {
    return Result.fail("Only a new group takes members.");
  }

  const added = proposeGroup({ proposals, id, change, world });

  if (Result.isFailure(added) || change.action !== "add") {
    return added;
  }

  const grown: StructureWorld = {
    ...structures,
    data: {
      ...structures.data,
      groups: Arr.some(
        structures.data.groups,
        (group) => group.id === change.group.id
      )
        ? structures.data.groups
        : [
            ...structures.data.groups,
            { id: change.group.id, title: change.group.title },
          ],
    },
  };

  return Arr.reduce(
    members,
    added,
    (so, member): Result.Result<Proposals, string> =>
      Result.flatMap(so, (held) =>
        proposeStructure({
          proposals: held,
          id: member.id,
          change: {
            action: "group",
            structure: member.structure,
            group: change.group.id,
          },
          world: grown,
        })
      )
  );
};

/** A fresh provisional id for a group called `title`, such as `data-layer-4f2a`. */
export const newProvisionalGroupId = (title: string): string =>
  provisionalGroupIdOf(title, Str.slice(0, 4)(newChangeId()));
