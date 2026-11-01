import { Array as Arr, Option, Result, String as Str } from "effect";
import { dual } from "effect/Function";

import type { Layout } from "./layout.ts";
import {
  applyLayoutChanges,
  layoutRefusal,
  structuresOf,
} from "./proposals.ts";
import type { LayoutChange } from "./proposals.ts";

/** What accepting some pending layout changes makes. */
export interface Acceptance {
  /** The changes taken, in the order they were pending. */
  readonly accepted: readonly LayoutChange[];
  /** The changes still pending, in order. */
  readonly remaining: readonly LayoutChange[];
  /** The accepted layout with `accepted` applied, one file revision on. */
  readonly layout: Layout;
}

/** What a change sets on a structure, for telling which changes collide. */
const settings = (change: LayoutChange) =>
  Arr.map(structuresOf(change), (id) =>
    change.kind === "move" ? `position of ${id}` : `size of ${id}`
  );

/**
 * Takes the pending changes named in `ids` (or all of them) into `layout`.
 * Fails with why it can't, and changes nothing, when:
 *
 * - nothing is pending, or an id names no pending change;
 * - a change acts on a structure the layout doesn't place, or leaves a
 *   footprint on top of another, as `layoutRefusal` says;
 * - a change is taken while an earlier one that sets the same position or
 *   size stays pending. The page applies changes in list order, so the
 *   earlier one would then win over the one just accepted, and what the page
 *   shows would change under the engineer.
 */
export const acceptLayoutChanges = ({
  layout,
  pending,
  ids,
}: {
  readonly layout: Layout;
  readonly pending: readonly LayoutChange[];
  readonly ids: "all" | readonly string[];
}): Result.Result<Acceptance, string> => {
  if (pending.length === 0) {
    return Result.fail("Nothing is pending. Move or resize a structure first.");
  }

  const wanted =
    ids === "all" ? new Set(Arr.map(pending, ({ id }) => id)) : new Set(ids);

  const known = new Set(Arr.map(pending, ({ id }) => id));
  const unknown = Arr.findFirst([...wanted], (id) => !known.has(id));

  if (Option.isSome(unknown)) {
    return Result.fail(
      `No pending layout change has the id "${unknown.value}". It may have been accepted or discarded already.`
    );
  }

  const accepted = Arr.filter(pending, ({ id }) => wanted.has(id));
  const remaining = Arr.filter(pending, ({ id }) => !wanted.has(id));

  const clash = Arr.findFirst(accepted, (taken) => {
    const index = pending.indexOf(taken);
    const mine = new Set(settings(taken));

    return Arr.findFirst(
      Arr.filter(remaining, (kept) => pending.indexOf(kept) < index),
      (earlier) => Arr.some(settings(earlier), (setting) => mine.has(setting))
    ).pipe(Option.map((earlier) => ({ taken, earlier })));
  });

  const refusal = Option.match(clash, {
    onNone: () =>
      layoutRefusal({ accepted: layout, before: [], after: accepted }),
    onSome: ({ taken, earlier }) =>
      Option.some(
        `Change ${taken.id} can't be accepted before change ${earlier.id}, which comes first and sets the same thing. Accept ${earlier.id} too, or accept all.`
      ),
  });

  if (Option.isSome(refusal)) {
    return Result.fail(refusal.value);
  }

  return Result.succeed({
    accepted,
    remaining,
    layout: {
      ...applyLayoutChanges(layout, accepted),
      revision: layout.revision + 1,
    },
  });
};

const verbs = { move: "Move", resize: "Resize" } as const;

/** Past this many structures, a kind of change names three and counts the rest. */
const namedInFull = 4;

/** Joins names as prose: "A", "A and B", or "A, B and C". */
const listNames = (names: readonly string[]) => {
  const last = names.at(-1);

  return last === undefined || names.length === 1
    ? Arr.join(names, "")
    : `${Arr.join(names.slice(0, -1), ", ")} and ${last}`;
};

const namesOf = (names: readonly string[]) =>
  names.length <= namedInFull
    ? listNames(names)
    : `${Arr.join(names.slice(0, 3), ", ")} and ${names.length - 3} more`;

const lowerFirst = (text: string) =>
  `${Str.toLowerCase(Str.slice(0, 1)(text))}${Str.slice(1)(text)}`;

/**
 * The message for accepting `changes` when the engineer gave none, such as
 * "Move Save server; resize Map page". A kind of change comes in the order it
 * first appears, and names each structure once, however many changes touch
 * it. `nameOf` turns a structure id into the name the page shows.
 */
export const acceptanceMessage: {
  (
    nameOf: (id: string) => string
  ): (changes: readonly LayoutChange[]) => string;
  (changes: readonly LayoutChange[], nameOf: (id: string) => string): string;
} = dual(
  2,
  (
    changes: readonly LayoutChange[],
    nameOf: (id: string) => string
  ): string => {
    const kinds = Arr.dedupe(Arr.map(changes, ({ kind }) => kind));

    const parts = Arr.map(kinds, (kind) => {
      const ids = Arr.dedupe(
        Arr.flatMap(
          Arr.filter(changes, (change) => change.kind === kind),
          structuresOf
        )
      );

      return `${verbs[kind]} ${namesOf(Arr.map(ids, nameOf))}`;
    });

    return Arr.join(
      Arr.map(parts, (part, index) => (index === 0 ? part : lowerFirst(part))),
      "; "
    );
  }
);
