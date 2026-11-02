import { Array as Arr, Option, Order, Result } from "effect";

import {
  chapterHolds,
  sameChapterChange,
  subjectOf,
} from "./chapter-change.ts";
import type { ChapterChange } from "./chapter-change.ts";
import type { MapData } from "./map-data.ts";
import type { ChangeId, ChapterProposal, Proposals } from "./proposals.ts";
import { frozenRefusal, reviewEntries } from "./review.ts";

/**
 * What a chapter proposal is checked against: the map as data.mjs has it,
 * with the frozen items applied, so a structure a frozen proposal adds can
 * be revealed.
 */
export interface ChapterWorld {
  readonly data: Pick<MapData, "chapters" | "structures" | "hops">;
  /**
   * The map with every open and frozen item applied. A structure or a group an
   * earlier proposal adds is known here, but a chapter reads `data`.
   */
  readonly proposed: Pick<MapData, "structures" | "hops">;
}

const openOf = (proposals: Proposals): readonly ChapterProposal[] =>
  proposals.chapters ?? [];

const orderLast = Order.mapInput(Order.Number, (found: ChapterProposal) =>
  found.change.action === "order" ? 1 : 0
);

/**
 * `proposals` with `chapters` as the open chapter proposals. An order goes
 * after the plays, so a hop the engineer adds is in the chapter when the order
 * that lists it applies.
 */
const bump = (
  proposals: Proposals,
  chapters: readonly ChapterProposal[]
): Proposals => ({
  ...proposals,
  revision: proposals.revision + 1,
  chapters: Arr.sort(chapters, orderLast),
});

const idInUse = (proposals: Proposals, id: string) =>
  Arr.some(reviewEntries(proposals), ({ item }) => item.id === id);

/**
 * Whether two changes undo each other: a reveal and a hide of the same
 * structure in a chapter, or a play and an unplay of the same hop.
 */
const opposes = (a: ChapterChange, b: ChapterChange): boolean =>
  subjectOf(a) === subjectOf(b) &&
  ((a.action === "reveal" && b.action === "hide") ||
    (a.action === "hide" && b.action === "reveal") ||
    (a.action === "play" && b.action === "unplay") ||
    (a.action === "unplay" && b.action === "play"));

const idRefusal = (
  proposals: Proposals,
  id: ChangeId,
  change: ChapterChange
): Option.Option<string> => {
  const own = Arr.findFirst(openOf(proposals), (found) => found.id === id);
  const taken = `The id "${id}" is already in use.`;

  if (Option.isSome(own)) {
    return subjectOf(own.value.change) === subjectOf(change)
      ? Option.none()
      : Option.some(taken);
  }

  return Option.orElse(frozenRefusal(proposals, id), () =>
    idInUse(proposals, id) ? Option.some(taken) : Option.none()
  );
};

/** Why `change` names something the map lacks, or nothing. */
const worldRefusal = (
  world: ChapterWorld,
  change: ChapterChange
): Option.Option<string> => {
  if (!Arr.some(world.data.chapters, ({ id }) => id === change.chapter)) {
    return Option.some(
      `No chapter in the map has the id "${change.chapter}", so there is nothing to change.`
    );
  }

  if (change.action === "reveal" || change.action === "hide") {
    return Arr.some(
      world.proposed.structures,
      ({ id }) => id === change.structure
    )
      ? Option.none()
      : Option.some(
          `No structure in the map has the id "${change.structure}", so a chapter can't ${change.action} it.`
        );
  }

  const hops = change.action === "order" ? change.plays : [change.hop];

  return Option.map(
    Arr.findFirst(
      hops,
      (hop) => !Arr.some(world.proposed.hops, ({ id }) => id === hop)
    ),
    (hop) =>
      `No hop in the map has the id "${hop}", so a chapter can't play or order it.`
  );
};

/**
 * Sets the open chapter proposal `id` to `change`, which is how the page
 * reveals or hides a structure in one chapter, adds or removes a hop it plays,
 * and reorders its hops.
 *
 * - The same `id` and `change` sent again succeeds and changes nothing.
 * - A second change to the same structure or hop in the same chapter replaces
 *   the first: a hide after a reveal takes the reveal away.
 * - A change that leaves the chapter as data.mjs has it takes the open
 *   proposal for that subject away.
 * - An order replaces any earlier order of the chapter.
 * - Fails, and changes nothing, when `id` is in a batch, or the change names a
 *   chapter, structure or hop the map lacks.
 *
 * Whether the walkthrough would break is `review`'s to say, not this
 * function's, so the engineer can propose a hop and its structures in any
 * order.
 */
export const proposeChapter = ({
  proposals,
  id,
  change,
  world,
}: {
  readonly proposals: Proposals;
  readonly id: ChangeId;
  readonly change: ChapterChange;
  readonly world: ChapterWorld;
}): Result.Result<Proposals, string> => {
  const refusal = Option.orElse(idRefusal(proposals, id, change), () =>
    worldRefusal(world, change)
  );

  if (Option.isSome(refusal)) {
    return Result.fail(refusal.value);
  }

  const open = openOf(proposals);
  const subject = subjectOf(change);

  const twin = Arr.findFirst(
    open,
    (found) => subjectOf(found.change) === subject
  );

  const kept = Option.match(twin, {
    onNone: () => id,
    onSome: (found) => found.id,
  });

  // A change that undoes the open one, or leaves data.mjs as it is, takes the
  // open one away and proposes nothing.
  const undoes = Option.exists(twin, (found) => opposes(found.change, change));

  if (undoes || chapterHolds(world.data.chapters, change)) {
    return Option.isNone(twin) && !undoes
      ? Result.succeed(proposals)
      : Result.succeed(
          bump(
            proposals,
            Arr.filter(open, (found) => found.id !== kept)
          )
        );
  }

  const existing = Arr.findFirst(open, (found) => found.id === kept);

  if (
    Option.isSome(existing) &&
    sameChapterChange(existing.value.change, change)
  ) {
    return Result.succeed(proposals);
  }

  return Result.succeed(
    bump(
      proposals,
      Option.isSome(existing)
        ? Arr.map(open, (found) =>
            found.id === kept ? { id: kept, change } : found
          )
        : [...open, { id: kept, change }]
    )
  );
};
