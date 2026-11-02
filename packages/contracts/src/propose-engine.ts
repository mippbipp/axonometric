import { Array as Arr, Option, Result } from "effect";

import type { ChangeId, Proposals } from "./proposals.ts";
import { frozenRefusal, reviewEntries } from "./review.ts";

/**
 * What the one propose engine needs to know about a kind of proposal: where
 * its open list is, what makes two changes the same, and what its map
 * refuses. Structures, hops and flows each give one; the engine does the
 * rest, so the three share their id checks, their handling of a retry, their
 * edits of a proposal that is only an add, and their dropping of a proposal
 * the map already satisfies.
 */
export interface ProposalKind<C> {
  /** The open proposals of the kind. */
  readonly open: (
    proposals: Proposals
  ) => readonly { readonly id: ChangeId; readonly change: C }[];
  /** `proposals` with the kind's open list set, and the file revision up by one. */
  readonly withOpen: (
    proposals: Proposals,
    open: readonly { readonly id: ChangeId; readonly change: C }[]
  ) => Proposals;
  /** What a change acts on: the provisional id for an add. */
  readonly targetOf: (change: C) => string;
  readonly isAdd: (change: C) => boolean;
  readonly sameChange: (a: C, b: C) => boolean;
  /** Whether two changes act on the same thing in the same way. */
  readonly sameSubject: (a: C, b: C) => boolean;
  /** The provisional ids of the adds waiting in a batch with no commit. */
  readonly waitingAdds: (proposals: Proposals) => readonly string[];
  /**
   * The open list once `change`, to a thing that is only proposed, is folded
   * into the add that proposes it, or nothing when the change isn't to one.
   */
  readonly edited: (
    open: readonly { readonly id: ChangeId; readonly change: C }[],
    change: C
  ) => Option.Option<readonly { readonly id: ChangeId; readonly change: C }[]>;
  /** Why the map can't take `change`, or nothing. */
  readonly refusal: (change: C) => Option.Option<string>;
  /** Whether the map already has what a change other than an add proposes. */
  readonly isCurrent: (change: C) => boolean;
  /** What the kind's things are called, for a message. */
  readonly noun: string;
}

/** Why `id` can't be used for `change`: a frozen item has it, or another proposal does. */
export const idRefusal = <C>({
  kind,
  proposals,
  id,
  change,
}: {
  readonly kind: ProposalKind<C>;
  readonly proposals: Proposals;
  readonly id: ChangeId;
  readonly change: C;
}): Option.Option<string> => {
  const taken = `The id "${id}" is already in use.`;

  const own = Arr.findFirst(kind.open(proposals), (held) => held.id === id);

  if (Option.isSome(own)) {
    return kind.sameSubject(own.value.change, change)
      ? Option.none()
      : Option.some(taken);
  }

  return Option.orElse(frozenRefusal(proposals, id), () =>
    Arr.some(reviewEntries(proposals), ({ item }) => item.id === id)
      ? Option.some(taken)
      : Option.none()
  );
};

/** Why `change` can't name the thing it does: it is added twice, or waits in a batch. */
const targetRefusal = <C>({
  kind,
  proposals,
  id,
  change,
}: {
  readonly kind: ProposalKind<C>;
  readonly proposals: Proposals;
  readonly id: ChangeId;
  readonly change: C;
}): Option.Option<string> => {
  const target = kind.targetOf(change);

  const addedTwice =
    kind.isAdd(change) &&
    Arr.some(
      kind.open(proposals),
      (other) =>
        other.id !== id &&
        kind.isAdd(other.change) &&
        kind.targetOf(other.change) === target
    );

  if (addedTwice) {
    return Option.some(
      `Another proposal already adds a ${kind.noun} with the id "${target}".`
    );
  }

  return Arr.some(kind.waitingAdds(proposals), (other) => other === target)
    ? Option.some(
        `"${target}" is a new ${kind.noun} in a batch that is waiting for the agent. Edits go in the next batch, once the agent commits.`
      )
    : Option.none();
};

/**
 * Sets the open proposal `id` of `kind` to `change`.
 *
 * - The same `id` and `change` sent again succeeds and changes nothing, so a
 *   retry never makes a duplicate.
 * - `id` held by an open proposal of the same thing and action replaces its
 *   change. A change to a thing that is only proposed edits that proposal.
 * - A change that leaves what the map has takes the open proposal away.
 * - Fails, and changes nothing, when `id` is in a batch, the thing waits in a
 *   batch, or the map can't take the change.
 */
export const proposeInto = <C>({
  kind,
  proposals,
  id,
  change,
}: {
  readonly kind: ProposalKind<C>;
  readonly proposals: Proposals;
  readonly id: ChangeId;
  readonly change: C;
}): Result.Result<Proposals, string> => {
  const open = kind.open(proposals);

  const refused = Option.orElse(
    idRefusal({ kind, proposals, id, change }),
    () => targetRefusal({ kind, proposals, id, change })
  );

  // A retry of a write that landed: the thing it names is on the map now.
  const sent = Arr.findFirst(open, (held) => held.id === id);

  if (
    Option.exists(sent, (held) => kind.sameChange(held.change, change)) &&
    Option.isNone(frozenRefusal(proposals, id))
  ) {
    return Result.succeed(proposals);
  }

  if (Option.isSome(refused)) {
    return Result.fail(refused.value);
  }

  const folded = kind.isAdd(change) ? Option.none() : kind.edited(open, change);

  if (Option.isSome(folded)) {
    return Result.succeed(kind.withOpen(proposals, folded.value));
  }

  const unfit = kind.refusal(change);

  if (Option.isSome(unfit)) {
    return Result.fail(unfit.value);
  }

  const twin = Arr.findFirst(
    open,
    (held) => !kind.isAdd(held.change) && kind.sameSubject(held.change, change)
  );

  const keptId = Option.match(twin, {
    onNone: () => id,
    onSome: (held) => held.id,
  });

  if (!kind.isAdd(change) && kind.isCurrent(change)) {
    return Result.succeed(
      Option.isNone(twin)
        ? proposals
        : kind.withOpen(
            proposals,
            Arr.filter(open, (held) => held.id !== keptId)
          )
    );
  }

  const existing = Arr.findFirst(open, (held) => held.id === keptId);

  if (Option.exists(existing, (held) => kind.sameChange(held.change, change))) {
    return Result.succeed(proposals);
  }

  return Result.succeed(
    kind.withOpen(
      proposals,
      Option.isSome(existing)
        ? Arr.map(open, (held) =>
            held.id === keptId ? { id: keptId, change } : held
          )
        : [...open, { id: keptId, change }]
    )
  );
};
