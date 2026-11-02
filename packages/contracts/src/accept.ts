import { Array as Arr, Match, Option, Result, String as Str } from "effect";
import { dual } from "effect/Function";

import type { HopEnds } from "./layout-checks.ts";
import type { Layout } from "./layout.ts";
import {
  applyLayoutChanges,
  hopsOf,
  layoutRefusal,
  structuresOf,
} from "./proposals.ts";
import type { LayoutChange } from "./proposals.ts";

/** What accepting some pending layout changes makes. */
export interface Acceptance {
  /** The changes taken, in the order they were pending. */
  readonly accepted: readonly LayoutChange[];
  /**
   * The changes still pending, in order. An earlier change that the accepted
   * ones override is left out, or has the overridden structures left out of
   * it, and is listed in `dropped`.
   */
  readonly remaining: readonly LayoutChange[];
  /** What was taken out of earlier pending changes because accepting overrides it. */
  readonly dropped: readonly DroppedChange[];
  /** The accepted layout with `accepted` applied, one file revision on. */
  readonly layout: Layout;
}

/**
 * An earlier pending change that an accepted change overrides: `structures`
 * and `hops` are the ones taken out of it. When they were all of what it
 * acts on, the change is gone from the pending list.
 */
export interface DroppedChange {
  readonly id: string;
  readonly kind: LayoutChange["kind"];
  readonly structures: readonly string[];
  readonly hops: readonly string[];
}

/**
 * What a change sets on a structure or hop, for telling which changes
 * collide: a move sets a position, a resize a size and a reroute a route.
 */
const settingOf = (kind: LayoutChange["kind"], id: string) =>
  Match.value(kind).pipe(
    Match.when("move", () => `position of ${id}`),
    Match.when("resize", () => `size of ${id}`),
    Match.when("reroute", () => `route of hop ${id}`),
    Match.exhaustive
  );

const settings = (change: LayoutChange) =>
  Arr.map([...structuresOf(change), ...hopsOf(change)], (id) =>
    settingOf(change.kind, id)
  );

/** What is left of a pending change, and what was taken out of it. */
interface Overridden {
  readonly left: Option.Option<LayoutChange>;
  readonly structures: readonly string[];
  readonly hops: readonly string[];
}

/**
 * Takes `change` out of the structures and hops whose setting is in
 * `overridden`: nothing for a resize or a reroute, which set one thing each,
 * and the moves of those structures for a move. Returns what is left of it,
 * if anything, and what was taken out.
 */
const withoutOverridden = (
  change: LayoutChange,
  overridden: ReadonlySet<string>
): Overridden => {
  const structures = Arr.filter(structuresOf(change), (id) =>
    overridden.has(settingOf(change.kind, id))
  );

  const hops = Arr.filter(hopsOf(change), (id) =>
    overridden.has(settingOf(change.kind, id))
  );

  if (structures.length === 0 && hops.length === 0) {
    return { left: Option.some(change), structures, hops };
  }

  if (change.kind !== "move") {
    return { left: Option.none(), structures, hops };
  }

  const kept = Arr.filter(
    change.moves,
    ({ target }) => !structures.includes(target.id)
  );

  return {
    left: Arr.match(kept, {
      onEmpty: () => Option.none(),
      onNonEmpty: (moves) => Option.some({ ...change, moves }),
    }),
    structures,
    hops,
  };
};

/**
 * Takes the pending changes named in `ids` (or all of them) into `layout`.
 * Fails with why it can't, and changes nothing, when nothing is pending, an
 * id names no pending change, or a change acts on a structure the layout
 * doesn't place or a hop the map lacks, leaves a footprint on top of another,
 * or leaves a route override off its footprints, as `layoutRefusal` says.
 *
 * The page applies changes in list order, so a pending change that comes
 * before an accepted one and sets the same position or size would be
 * overridden by it. Accepting takes that setting out of the earlier change,
 * and `dropped` says what.
 */
export const acceptLayoutChanges = ({
  layout,
  pending,
  ids,
  hops,
}: {
  readonly layout: Layout;
  readonly pending: readonly LayoutChange[];
  readonly ids: "all" | readonly string[];
  /** The map's hops, which say where a reroute's ends belong. */
  readonly hops: readonly HopEnds[];
}): Result.Result<Acceptance, string> => {
  if (pending.length === 0) {
    return Result.fail(
      "Nothing is pending. Move, resize or reroute something first."
    );
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

  const refusal = layoutRefusal({
    accepted: layout,
    before: [],
    after: accepted,
    hops,
  });

  if (Option.isSome(refusal)) {
    return Result.fail(refusal.value);
  }

  const outcomes = Arr.flatMap(pending, (change, index) => {
    if (wanted.has(change.id)) {
      return [];
    }

    const overridden = new Set(
      Arr.flatMap(
        Arr.filter(
          pending,
          (taken, takenIndex) => wanted.has(taken.id) && takenIndex > index
        ),
        settings
      )
    );

    return [{ change, ...withoutOverridden(change, overridden) }];
  });

  return Result.succeed({
    accepted,
    remaining: Arr.flatMap(outcomes, ({ left }) => Option.toArray(left)),
    dropped: Arr.flatMap(outcomes, ({ change, structures, hops: lost }) =>
      structures.length === 0 && lost.length === 0
        ? []
        : [
            {
              id: change.id,
              kind: change.kind,
              structures,
              hops: lost,
            },
          ]
    ),
    layout: {
      ...applyLayoutChanges(layout, accepted),
      revision: layout.revision + 1,
    },
  });
};

/** What a message calls a change, by kind. A reset reroute has its own. */
const verbOf = (change: LayoutChange) =>
  change.kind === "move"
    ? "Move"
    : change.kind === "resize"
      ? "Resize"
      : change.points === null
        ? "Reset the route of"
        : "Reroute";

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

/** What `acceptanceMessage` can also say. */
export interface MessageOptions {
  /** Earlier pending changes that the accepted ones replace. */
  readonly dropped?: readonly DroppedChange[];
  /** Turns a hop id into the name to use for it. The id itself by default. */
  readonly hopNameOf?: (id: string) => string;
}

/**
 * The message for accepting `changes` when the engineer gave none, such as
 * "Move Save server; resize Map page; reroute Save note". A verb comes in the
 * order it first appears, and names each structure or hop once, however many
 * changes touch it. `nameOf` turns a structure id into the name the page
 * shows.
 */
export const acceptanceMessage: {
  (
    nameOf: (id: string) => string,
    options?: MessageOptions
  ): (changes: readonly LayoutChange[]) => string;
  (
    changes: readonly LayoutChange[],
    nameOf: (id: string) => string,
    options?: MessageOptions
  ): string;
} = dual(
  (args) => Arr.isArray(args[0]),
  (
    changes: readonly LayoutChange[],
    nameOf: (id: string) => string,
    { dropped = [], hopNameOf = (id) => id }: MessageOptions = {}
  ): string => {
    const verbs = Arr.dedupe(Arr.map(changes, verbOf));

    const parts = Arr.map(verbs, (verb) => {
      const same = Arr.filter(changes, (change) => verbOf(change) === verb);

      const names = Arr.dedupe([
        ...Arr.map(Arr.flatMap(same, structuresOf), nameOf),
        ...Arr.map(Arr.flatMap(same, hopsOf), hopNameOf),
      ]);

      return `${verb} ${namesOf(names)}`;
    });

    const replaced = Arr.dedupe([
      ...Arr.map(
        Arr.flatMap(dropped, ({ structures }) => structures),
        nameOf
      ),
      ...Arr.map(
        Arr.flatMap(dropped, ({ hops }) => hops),
        hopNameOf
      ),
    ]);

    const replaces =
      replaced.length === 0
        ? []
        : [`replaces earlier pending changes to ${namesOf(replaced)}`];

    return Arr.join(
      Arr.map([...parts, ...replaces], (part, index) =>
        index === 0 ? part : lowerFirst(part)
      ),
      "; "
    );
  }
);
