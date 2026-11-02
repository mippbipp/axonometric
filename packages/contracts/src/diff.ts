import { Array as Arr, Equal, Option, Record as Rec } from "effect";

import type { Layout, Placement } from "./layout.ts";
import type { MapData } from "./map-data.ts";
import { applyLayoutChanges, placeStructure } from "./proposals.ts";
import type { ChangeId, LayoutChange } from "./proposals.ts";

/** A map as a revision or the page holds it: its meaning and its layout. */
export interface MapSnapshot {
  readonly data: MapData;
  readonly layout: Layout;
}

/** A structure that sits somewhere else, or is another size, in the second map. */
export interface Repositioned {
  readonly id: string;
  readonly from: Placement;
  readonly to: Placement;
}

/** The fields of a structure or hop whose values differ. */
export interface FieldChange {
  readonly id: string;
  readonly fields: readonly string[];
}

/** The parts of the map's data, besides structures and hops, that can differ. */
export type DataSection = "overview" | "groups" | "flows" | "chapters";

const dataSections: readonly DataSection[] = [
  "overview",
  "groups",
  "flows",
  "chapters",
];

/**
 * What it takes to go from one map to another. Ids are in the order of the
 * map they come from: `added` and the `moved` and `changed` entries follow
 * the second map, `removed` follows the first.
 */
export interface MapDiff {
  readonly structures: {
    /** In both maps, at another x or y in the second. */
    readonly moved: readonly Repositioned[];
    /** In both maps, another width or depth in the second. */
    readonly resized: readonly Repositioned[];
    /** Only in the second map. */
    readonly added: readonly string[];
    /** Only in the first map. */
    readonly removed: readonly string[];
    /** In both maps, with other values in some field other than the id. */
    readonly changed: readonly FieldChange[];
  };
  readonly hops: {
    readonly added: readonly string[];
    readonly removed: readonly string[];
    readonly changed: readonly FieldChange[];
  };
  /** The other parts of the data that differ. */
  readonly sections: readonly DataSection[];
  /** Hops in both maps whose route override differs, or exists in only one. */
  readonly rerouted: readonly string[];
}

const fieldsDiffering = (
  before: Readonly<Record<string, unknown>>,
  after: Readonly<Record<string, unknown>>
): readonly string[] =>
  Arr.filter(
    Arr.dedupe([...Rec.keys(before), ...Rec.keys(after)]),
    (key) =>
      key !== "id" && !Equal.equals(before[key], after[key])
  );

const byId = <A extends { readonly id: string }>(items: readonly A[]) =>
  new Map(Arr.map(items, (item) => [item.id, item] as const));

/** Compares two lists of items with ids. */
const diffById = <A extends { readonly id: string }>(
  before: readonly A[],
  after: readonly A[]
) => {
  const earlier = byId(before);
  const later = byId(after);

  return {
    added: Arr.flatMap(after, ({ id }) => (earlier.has(id) ? [] : [id])),
    removed: Arr.flatMap(before, ({ id }) => (later.has(id) ? [] : [id])),
    changed: Arr.flatMap(after, (item): readonly FieldChange[] => {
      const was = earlier.get(item.id);
      const fields = was === undefined ? [] : fieldsDiffering(was, item);

      return fields.length === 0 ? [] : [{ id: item.id, fields }];
    }),
  };
};

/**
 * Compares two maps. `diffMaps(before, after)` says what going from `before`
 * to `after` changes: what moved or resized, what only `after` has (`added`),
 * what only `before` has (`removed`), and what has other text.
 *
 * The History panel compares the page's current map as `before` with an
 * opened revision as `after`: a restore moves structures to where `after`
 * has them, and a structure that is `removed` is in the current map but not
 * in the revision.
 */
export const diffMaps = (before: MapSnapshot, after: MapSnapshot): MapDiff => {
  const structures = diffById(before.data.structures, after.data.structures);
  const hops = diffById(before.data.hops, after.data.hops);
  const earlier = byId(before.data.structures);

  const repositioned = Arr.flatMap(
    after.data.structures,
    ({ id }): readonly Repositioned[] => {
      if (!earlier.has(id)) {
        return [];
      }

      const from = Rec.get(before.layout.structures, id);
      const to = Rec.get(after.layout.structures, id);

      return Option.isSome(from) && Option.isSome(to)
        ? [{ id, from: from.value, to: to.value }]
        : [];
    }
  );

  const routesBefore = before.layout.routes ?? {};
  const routesAfter = after.layout.routes ?? {};
  const hopsBefore = byId(before.data.hops);
  const hopsAfter = byId(after.data.hops);

  return {
    structures: {
      moved: Arr.filter(
        repositioned,
        ({ from, to }) => from.x !== to.x || from.y !== to.y
      ),
      resized: Arr.filter(
        repositioned,
        ({ from, to }) => from.w !== to.w || from.d !== to.d
      ),
      added: structures.added,
      removed: structures.removed,
      changed: structures.changed,
    },
    hops,
    sections: Arr.filter(
      dataSections,
      (section) => !Equal.equals(before.data[section], after.data[section])
    ),
    rerouted: Arr.filter(
      Arr.dedupe([...Rec.keys(routesBefore), ...Rec.keys(routesAfter)]),
      (id) =>
        hopsBefore.has(id) &&
        hopsAfter.has(id) &&
        !Equal.equals(Rec.get(routesBefore, id), Rec.get(routesAfter, id))
    ),
  };
};

/**
 * The pending layout changes after a restore: `changes` with every structure
 * that sits somewhere else, or at another size, than `revision` has it put
 * where the revision has it, through `placeStructure`. "Sits" means in the
 * map the page shows: `current` with `accepted` and `changes` applied. A
 * structure that already has a pending move or resize keeps that change's id
 * and takes the revision's value, and one the pending changes already put
 * there gets no change. `newId` makes the ids of the changes that are added.
 *
 * It works from `changes` and `accepted` alone, so it gives the same answer
 * when it runs again on a fresher list.
 *
 * Only layout differences come back. Structures only one map has, text
 * differences and route overrides can't be restored this way, and
 * `describeDifferences` lists them.
 */
export const restoreChanges = ({
  current,
  revision,
  changes,
  accepted,
  newId,
}: {
  readonly current: MapData;
  readonly revision: MapSnapshot;
  readonly changes: readonly LayoutChange[];
  readonly accepted: Layout;
  readonly newId: () => ChangeId;
}): readonly LayoutChange[] => {
  const shown: MapSnapshot = {
    data: current,
    layout: applyLayoutChanges(accepted, changes),
  };

  const { moved, resized } = diffMaps(shown, revision).structures;

  const targets = Arr.dedupeWith(
    [...moved, ...resized],
    (a, b) => a.id === b.id
  );

  return Arr.reduce(targets, changes, (so, { id, to }) =>
    placeStructure({ changes: so, accepted, id, next: to, newId })
  );
};

/** How a compare marks a structure. */
export type StructureMark =
  | "moved"
  | "resized"
  | "added"
  | "removed"
  | "changed";

/** How a compare marks a hop. */
export type HopMark = "added" | "removed" | "changed";

/** What a compare highlights, by id. */
export interface CompareMarks {
  readonly structures: ReadonlyMap<string, readonly StructureMark[]>;
  readonly hops: ReadonlyMap<string, HopMark>;
  /**
   * Where the current map has each moved or resized structure, which the
   * revision's drawing leaves empty.
   */
  readonly origins: ReadonlyMap<string, Placement>;
}

const marksOf = <M extends string>(
  entries: readonly (readonly [M, readonly string[]])[]
) => {
  const marks = new Map<string, M[]>();

  for (const [mark, ids] of entries) {
    for (const id of ids) {
      marks.set(id, [...(marks.get(id) ?? []), mark]);
    }
  }

  return marks;
};

/**
 * The marks a compare draws: each structure with the kinds that apply to it,
 * in the order moved, resized, added, removed, changed, and each hop with the
 * one kind that applies. "Added" is in the revision only and "removed" in the
 * current map only, as `diffMaps(current, revision)` says.
 */
export const compareMarks = (diff: MapDiff): CompareMarks => {
  const { structures, hops } = diff;

  const hopMarks = marksOf<HopMark>([
    ["added", hops.added],
    ["removed", hops.removed],
    ["changed", Arr.map(hops.changed, ({ id }) => id)],
  ]);

  return {
    structures: marksOf<StructureMark>([
      ["moved", Arr.map(structures.moved, ({ id }) => id)],
      ["resized", Arr.map(structures.resized, ({ id }) => id)],
      ["added", structures.added],
      ["removed", structures.removed],
      ["changed", Arr.map(structures.changed, ({ id }) => id)],
    ]),
    hops: new Map(
      Arr.flatMap([...hopMarks], ([id, [mark]]) =>
        mark === undefined ? [] : [[id, mark] as const]
      )
    ),
    origins: new Map(
      Arr.map(
        [...structures.moved, ...structures.resized],
        ({ id, from }) => [id, from] as const
      )
    ),
  };
};

/**
 * A revision drawn with what only the current map has added back, so a
 * compare can show it as a ghost.
 */
export interface GhostedMap extends MapSnapshot {
  /** The structures that only the current map has, which `data` includes. */
  readonly ghostStructures: ReadonlySet<string>;
  /** The hops that only the current map has, which `data` includes. */
  readonly ghostHops: ReadonlySet<string>;
}

/**
 * The revision's map plus the structures that the current map has and the
 * revision doesn't, which `diff` lists as removed. A ghost keeps the place
 * it has in the current layout and shows from the chapter that reveals it in
 * the current map, or the revision's last chapter when the revision has no
 * chapter of that id. The hops the revision lacks are added too. With
 * nothing to add, the revision's own data and layout come back as they are.
 */
export const ghostedMap = ({
  current,
  revision,
  diff,
}: {
  readonly current: MapSnapshot;
  readonly revision: MapSnapshot;
  readonly diff: MapDiff;
}): GhostedMap => {
  const ghostStructures = new Set(diff.structures.removed);
  const ghostHops = new Set(diff.hops.removed);

  if (ghostStructures.size === 0 && ghostHops.size === 0) {
    return { ...revision, ghostStructures, ghostHops };
  }

  const structures = Arr.filter(current.data.structures, ({ id }) =>
    ghostStructures.has(id)
  );

  const groupIds = new Set(Arr.map(revision.data.groups, ({ id }) => id));

  const groups = Arr.filter(
    current.data.groups,
    ({ id }) =>
      !groupIds.has(id) && Arr.some(structures, ({ group }) => group === id)
  );

  const lastChapter = revision.data.chapters.at(-1)?.id;
  const chapterIds = new Set(Arr.map(revision.data.chapters, ({ id }) => id));

  const chapterOf = (structureId: string) => {
    const was = Arr.findFirst(current.data.chapters, ({ reveals }) =>
      reveals.includes(structureId)
    );

    return Option.isSome(was) && chapterIds.has(was.value.id)
      ? was.value.id
      : lastChapter;
  };

  const placements = Arr.flatMap(structures, ({ id }) => {
    const placement = Rec.get(current.layout.structures, id);

    return Option.isSome(placement) ? [[id, placement.value] as const] : [];
  });

  return {
    data: {
      ...revision.data,
      groups: [...revision.data.groups, ...groups],
      structures: [...revision.data.structures, ...structures],
      hops: [
        ...revision.data.hops,
        ...Arr.filter(current.data.hops, ({ id }) => ghostHops.has(id)),
      ],
      chapters: Arr.map(revision.data.chapters, (chapter) => ({
        ...chapter,
        reveals: [
          ...chapter.reveals,
          ...Arr.filter(
            Arr.map(structures, ({ id }) => id),
            (id) => chapterOf(id) === chapter.id
          ),
        ],
      })),
    },
    layout: {
      ...revision.layout,
      structures: {
        ...revision.layout.structures,
        ...Rec.fromEntries(placements),
      },
    },
    ghostStructures,
    ghostHops,
  };
};

const fieldNames: Readonly<Record<string, string>> = {
  oneLiner: "one-liner",
  whatItDoes: "what it does",
  howItsBuilt: "how it's built",
};

const sectionPhrases: Readonly<Record<DataSection, string>> = {
  overview: "The overview differs",
  groups: "The groups differ",
  flows: "The flows differ",
  chapters: "The chapters differ",
};

const joinWords = (words: readonly string[]) => {
  const last = words.at(-1);

  return words.length < 2 || last === undefined
    ? Arr.join(words, "")
    : `${Arr.join(words.slice(0, -1), ", ")} and ${last}`;
};

const spot = ({ x, y }: Placement) => `${x}, ${y}`;

const size = ({ w, d }: Placement) => `${w} × ${d}`;

/** The differences of a compare, as sentences for a restore dialog. */
export interface DifferenceLines {
  /** Layout differences a restore turns into pending changes. */
  readonly layout: readonly string[];
  /** Differences in what the map says, which a restore can't turn into layout changes. */
  readonly meaning: readonly string[];
  /** Route overrides that differ, which a restore can't turn into layout changes yet. */
  readonly routes: readonly string[];
}

/**
 * Words for each difference in `diff`, which `diffMaps` made with the
 * current map as `before` and the revision as `after`. `revisionName` is how
 * the revision is called in the sentences, such as "revision 2".
 */
export const describeDifferences = ({
  diff,
  current,
  revision,
  revisionName,
}: {
  readonly diff: MapDiff;
  readonly current: MapData;
  readonly revision: MapData;
  readonly revisionName: string;
}): DifferenceLines => {
  const nameOfStructure = (id: string) =>
    Arr.findFirst(
      [...current.structures, ...revision.structures],
      (structure) => structure.id === id
    ).pipe(
      Option.map(({ name }) => name),
      Option.getOrElse(() => id)
    );

  const hopLine = (id: string, where: string) =>
    Arr.findFirst(
      [...current.hops, ...revision.hops],
      (hop) => hop.id === id
    ).pipe(
      Option.match({
        onNone: () => `Hop "${id}" ${where}`,
        onSome: (hop) =>
          `Hop "${hop.label}" (${nameOfStructure(hop.from)} → ${nameOfStructure(hop.to)}) ${where}`,
      })
    );

  const differs = (
    subject: string,
    { fields }: FieldChange,
    names: Readonly<Record<string, string>>
  ) => {
    const words = Arr.map(fields, (field) => names[field] ?? field);

    return `${subject}: ${joinWords(words)} ${words.length === 1 ? "differs" : "differ"}`;
  };

  const inRevisionOnly = `is in ${revisionName}, not in the current map`;
  const inCurrentOnly = `is in the current map, not in ${revisionName}`;
  const { structures, hops } = diff;

  return {
    layout: [
      ...Arr.map(
        structures.moved,
        ({ id, from, to }) =>
          `${nameOfStructure(id)} moved from ${spot(from)} to ${spot(to)}`
      ),
      ...Arr.map(
        structures.resized,
        ({ id, from, to }) =>
          `${nameOfStructure(id)} resized from ${size(from)} to ${size(to)}`
      ),
    ],
    meaning: [
      ...Arr.map(
        structures.added,
        (id) => `${nameOfStructure(id)} ${inRevisionOnly}`
      ),
      ...Arr.map(
        structures.removed,
        (id) => `${nameOfStructure(id)} ${inCurrentOnly}`
      ),
      ...Arr.map(structures.changed, (change) =>
        differs(nameOfStructure(change.id), change, fieldNames)
      ),
      ...Arr.map(hops.added, (id) => hopLine(id, inRevisionOnly)),
      ...Arr.map(hops.removed, (id) => hopLine(id, inCurrentOnly)),
      ...Arr.map(hops.changed, (change) =>
        differs(hopLine(change.id, "").trimEnd(), change, {})
      ),
      ...Arr.map(diff.sections, (section) => sectionPhrases[section]),
    ],
    routes: Arr.map(
      diff.rerouted,
      (id) => `${hopLine(id, "").trimEnd()}: route differs`
    ),
  };
};
