import { Array as Arr, Option } from "effect";
import { dual } from "effect/Function";

import type { BatchItem, Verdict } from "./proposals.ts";

/** The things the engineer can propose under a provisional id. */
export type Entity = "structure" | "hop" | "flow" | "group";

/** Every entity, in the order the messages list them. */
export const entities: readonly Entity[] = [
  "structure",
  "hop",
  "flow",
  "group",
];

/** One provisional id the agent gave a final id. */
export interface Rename {
  readonly entity: Entity;
  readonly from: string;
  readonly to: string;
}

/** The final ids of committed provisional ones, told apart by entity. */
export type Renames = Readonly<Record<Entity, ReadonlyMap<string, string>>>;

/** Renames of nothing. */
export const noRenames: Renames = {
  structure: new Map(),
  hop: new Map(),
  flow: new Map(),
  group: new Map(),
};

/** `list` as `Renames`. Ids the agent kept as they were are not renames. */
export const renamesOf = (list: readonly Rename[]): Renames => {
  const mapOf = (entity: Entity): ReadonlyMap<string, string> =>
    new Map(
      Arr.flatMap(list, (rename) =>
        rename.entity === entity && rename.from !== rename.to
          ? [[rename.from, rename.to] as const]
          : []
      )
    );

  return {
    structure: mapOf("structure"),
    hop: mapOf("hop"),
    flow: mapOf("flow"),
    group: mapOf("group"),
  };
};

/** Whether `renames` holds any rename at all. */
export const hasRenames = (renames: Renames): boolean =>
  Arr.some(entities, (entity) => renames[entity].size > 0);

/** `id` as it is now: its final id when the agent renamed it, else itself. */
export const followed: {
  (entity: Entity, id: string): (renames: Renames) => string;
  (renames: Renames, entity: Entity, id: string): string;
} = dual(
  3,
  (renames: Renames, entity: Entity, id: string): string =>
    renames[entity].get(id) ?? id
);

/** The ids of each entity the accepted map had, for `--as` to avoid. */
export type KnownIds = Readonly<Record<Entity, ReadonlySet<string>>>;

/** Known ids of nothing. */
export const noKnownIds: KnownIds = {
  structure: new Set(),
  hop: new Set(),
  flow: new Set(),
  group: new Set(),
};

/** The key of a `Batch` list of the ids an entity had when the batch was frozen. */
export const batchKeyOf = {
  structure: "structures",
  hop: "hops",
  flow: "flows",
  group: "groups",
} as const satisfies Record<Entity, string>;

/** The ids frozen into a batch, by entity. */
export type FrozenIds = Partial<
  Record<(typeof batchKeyOf)[Entity], readonly string[]>
>;

/** What `verdict` knows when it checks a verdict. */
export interface VerdictContext {
  /**
   * The ids of each entity the accepted map had before the agent edited
   * data.mjs. `--as` may not name one of them.
   */
  readonly accepted: KnownIds;
  /** The `--as` rename the batch's other items already have, by item id. */
  readonly taken: ReadonlyMap<string, Rename>;
}

/** What a kind of item adds under a provisional id, and how it says so. */
export interface Provisional<I extends BatchItem> {
  readonly entity: Entity;
  /** What the entity is called in a message, such as "hop". */
  readonly noun: string;
  /** The provisional id the item adds, or nothing when it adds none. */
  readonly adds: (item: I) => Option.Option<string>;
}

/** The final id a verdict gives a provisional id: `--as`, else the id itself. */
const finalOf = (provisional: string, verdict: Verdict): string =>
  verdict.verdict === "changed" && verdict.as !== undefined
    ? verdict.as
    : provisional;

/**
 * What every kind that adds something under a provisional id does with a
 * verdict: refuse a bad `--as`, say what was renamed, and name the final id.
 * A kind gives its entity and how to read its provisional id, and spreads
 * `provisionalOf(...)` into its table entry.
 */
export const provisionalOf = <I extends BatchItem>(spec: Provisional<I>) => ({
  /** The id the item ends up with once taken, or nothing if it adds none. */
  finalIdOf: (item: I, verdict: Verdict): Option.Option<string> =>
    Option.map(spec.adds(item), (provisional) => finalOf(provisional, verdict)),

  verdictRefusal: (
    item: I,
    verdict: Verdict,
    { accepted, taken }: VerdictContext
  ): Option.Option<string> => {
    if (verdict.verdict !== "changed" || verdict.as === undefined) {
      return Option.none();
    }

    const { as } = verdict;

    if (Option.isNone(spec.adds(item))) {
      return Option.some(
        `--as gives a new ${spec.noun} the id you used for it in data.mjs. This item does not add a ${spec.noun}.`
      );
    }

    if (accepted[spec.entity].has(as)) {
      return Option.some(
        `--as ${as} names a ${spec.noun} the accepted map already has. Pick the id of the new ${spec.noun} you added to data.mjs.`
      );
    }

    const same = Arr.findFirst(
      [...taken],
      ([other, rename]) =>
        other !== item.id && rename.entity === spec.entity && rename.to === as
    );

    return Option.map(
      same,
      ([other]) =>
        `--as ${as} is already the final id of item ${other} in this batch. Give each new ${spec.noun} its own id.`
    );
  },

  renames: (item: I, verdict: Verdict): readonly Rename[] =>
    verdict.verdict === "rejected"
      ? []
      : Option.match(spec.adds(item), {
          onNone: () => [],
          onSome: (from) => [
            { entity: spec.entity, from, to: finalOf(from, verdict) },
          ],
        }),
});
