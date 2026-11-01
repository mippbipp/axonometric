import { Array as Arr } from "effect";
import { dual } from "effect/Function";

import { checkLayout } from "./layout-checks.ts";
import type { Layout } from "./layout.ts";
import type { MapData } from "./map-data.ts";
import { mapError, mapWarning } from "./problems.ts";
import type { MapProblem } from "./problems.ts";

type Path = readonly PropertyKey[];

const error = (path: Path, message: string) =>
  mapError({ file: "data.mjs", path, message });

const warning = (path: Path, message: string) =>
  mapWarning({ file: "data.mjs", path, message });

interface Keyed {
  readonly key: string;
  readonly path: Path;
}

/** An error for every item whose key an earlier item already uses. */
const repeats = (
  items: readonly Keyed[],
  message: (key: string) => string
): readonly MapProblem[] => {
  const seen = new Set<string>();

  return Arr.flatMap(items, ({ key, path }) => {
    const repeated = seen.has(key);

    seen.add(key);

    return repeated ? [error(path, message(key))] : [];
  });
};

const keyedBy = <A>(
  items: readonly A[],
  section: string,
  field: keyof A & string
): readonly Keyed[] =>
  Arr.map(items, (item, index) => ({
    key: String(item[field]),
    path: [section, index, field],
  }));

const uniqueIds = (data: MapData) => [
  ...repeats(
    keyedBy(data.groups, "groups", "id"),
    (id) => `another group already uses "${id}". Give each group its own id.`
  ),
  ...repeats(
    keyedBy(data.structures, "structures", "id"),
    (id) =>
      `another structure already uses "${id}". Give each structure its own id.`
  ),
  ...repeats(
    keyedBy(data.structures, "structures", "code"),
    (code) =>
      `another structure already uses the code "${code}". Give each structure its own code, so question ids stay unambiguous.`
  ),
  ...repeats(
    keyedBy(data.hops, "hops", "id"),
    (id) => `another hop already uses "${id}". Give each hop its own id.`
  ),
  ...repeats(
    keyedBy(data.flows, "flows", "id"),
    (id) => `another flow already uses "${id}". Give each flow its own id.`
  ),
  ...repeats(
    keyedBy(data.chapters, "chapters", "id"),
    (id) =>
      `another chapter already uses "${id}". Give each chapter its own id.`
  ),
  ...repeats(
    Arr.flatMap(data.structures, (structure, index) =>
      Arr.map(structure.questions ?? [], (question, questionIndex) => ({
        key: question.id,
        path: ["structures", index, "questions", questionIndex, "id"],
      }))
    ),
    (id) =>
      `another question already uses "${id}". Question ids are never reused; give this question the next free number.`
  ),
];

/** Errors for every id in `ids` that isn't in `known`. */
const unknownIds = (
  { ids, path }: { readonly ids: readonly string[]; readonly path: Path },
  known: ReadonlySet<string>,
  message: (id: string) => string
) =>
  Arr.flatMap(ids, (id, index) =>
    known.has(id) ? [] : [error([...path, index], message(id))]
  );

const noStructure = (id: string) =>
  `no structure has the id "${id}". Use the id of one of the structures.`;

const noHop = (id: string) =>
  `no hop has the id "${id}". Use the id of one of the hops.`;

const references = (data: MapData) => {
  const groups = new Set(Arr.map(data.groups, (group) => group.id));
  const structures = new Set(Arr.map(data.structures, ({ id }) => id));
  const hops = new Set(Arr.map(data.hops, (hop) => hop.id));

  return [
    ...Arr.flatMap(data.structures, (structure, index) =>
      groups.has(structure.group)
        ? []
        : [
            error(
              ["structures", index, "group"],
              `no group has the id "${structure.group}". Use the id of one of the groups, or add the group.`
            ),
          ]
    ),
    ...Arr.flatMap(data.hops, (hop, index) =>
      Arr.flatMap(["from", "to"] as const, (end) =>
        structures.has(hop[end])
          ? []
          : [error(["hops", index, end], noStructure(hop[end]))]
      )
    ),
    ...Arr.flatMap(data.flows, (flow, index) =>
      unknownIds(
        { ids: flow.hops, path: ["flows", index, "hops"] },
        hops,
        noHop
      )
    ),
    ...Arr.flatMap(data.chapters, (chapter, index) => [
      ...unknownIds(
        { ids: chapter.reveals, path: ["chapters", index, "reveals"] },
        structures,
        noStructure
      ),
      ...unknownIds(
        { ids: chapter.plays, path: ["chapters", index, "plays"] },
        hops,
        noHop
      ),
    ]),
  ];
};

/**
 * Chapters reveal structures cumulatively. A chapter may only play hops
 * between structures revealed by then, and once the last chapter is reached
 * every structure has been revealed.
 */
const walkthrough = (data: MapData): readonly MapProblem[] => {
  if (data.chapters.length === 0) {
    return [];
  }

  const hops = new Map(Arr.map(data.hops, (hop) => [hop.id, hop]));
  const revealed = new Set<string>();

  const unrevealedEnds = Arr.flatMap(data.chapters, (chapter, index) => {
    for (const id of chapter.reveals) {
      revealed.add(id);
    }

    return Arr.flatMap(chapter.plays, (hopId, hopIndex) => {
      const hop = hops.get(hopId);

      if (hop === undefined) {
        return [];
      }

      const hidden = Arr.dedupe(
        Arr.filter([hop.from, hop.to], (end) => !revealed.has(end))
      );

      return hidden.length === 0
        ? []
        : [
            error(
              ["chapters", index, "plays", hopIndex],
              `hop "${hopId}" touches ${Arr.join(
                Arr.map(hidden, (id) => `"${id}"`),
                " and "
              )}, which no chapter has revealed by chapter "${chapter.id}". Reveal ${hidden.length === 1 ? "it" : "them"} in this chapter or an earlier one, or play the hop later.`
            ),
          ];
    });
  });

  const last = data.chapters.length - 1;

  const neverRevealed = Arr.filter(
    data.structures,
    (structure) => !revealed.has(structure.id)
  );

  const lastChapter =
    neverRevealed.length === 0
      ? []
      : [
          error(
            ["chapters", last, "reveals"],
            `the last chapter must leave every structure revealed, but no chapter reveals ${Arr.join(
              Arr.map(neverRevealed, ({ id }) => `"${id}"`),
              ", "
            )}. Add ${neverRevealed.length === 1 ? "it" : "them"} to the reveals of this chapter or an earlier one.`
          ),
        ];

  return [...unrevealedEnds, ...lastChapter];
};

interface LinkField {
  readonly link: string | undefined;
  readonly path: Path;
}

interface RelativeLink {
  readonly link: string;
  readonly path: Path;
}

/**
 * Every link in the overview that names a file rather than a full URL, such
 * as `https://...`.
 */
const relativeLinks = (data: MapData): readonly RelativeLink[] => {
  const fields: readonly LinkField[] = [
    ...Arr.map(data.overview.decisions ?? [], (decision, index) => ({
      link: decision.adr,
      path: ["overview", "decisions", index, "adr"],
    })),
    ...Arr.map(data.overview.deepDives ?? [], (deepDive, index) => ({
      link: deepDive.link,
      path: ["overview", "deepDives", index, "link"],
    })),
  ];

  return Arr.flatMap(fields, ({ link, path }) =>
    link === undefined || URL.canParse(link) ? [] : [{ link, path }]
  );
};

const links = (
  data: MapData,
  linkExists: (link: string) => boolean
): readonly MapProblem[] => {
  const candidates = relativeLinks(data);

  return Arr.flatMap(candidates, ({ link, path }) =>
    linkExists(link)
      ? []
      : [
          error(
            path,
            `"${link}" doesn't resolve to a file. Links are relative to SYSTEM.md, which build writes next to the home folder. Fix the path, or use a full https:// URL.`
          ),
        ]
  );
};

const emptyGroups = (data: MapData) => {
  const used = new Set(
    Arr.map(data.structures, (structure) => structure.group)
  );

  return Arr.flatMap(data.groups, (group, index) =>
    used.has(group.id)
      ? []
      : [
          warning(
            ["groups", index],
            `group "${group.id}" has no structures, so no zone is drawn for it. Put a structure in it, or remove the group.`
          ),
        ]
  );
};

export interface CheckOptions {
  /**
   * Whether a relative link, such as `../adr/0001-runtime.md#context`,
   * resolves to a file. Links are relative to SYSTEM.md, and a fragment
   * names a place in the file.
   */
  readonly linkExists: (link: string) => boolean;
}

/** The two map files, each already decoded by its own schema. */
export interface MapFiles {
  readonly data: MapData;
  readonly layout: Layout;
}

/**
 * Checks what the schemas can't: references between ids, the walkthrough,
 * links, and how the layout reads. Returns errors and warnings together. A
 * structure with no placement is fine, because `build` places it.
 */
export const checkMap: {
  (options: CheckOptions): (files: MapFiles) => readonly MapProblem[];
  (files: MapFiles, options: CheckOptions): readonly MapProblem[];
} = dual(
  2,
  (
    { data, layout }: MapFiles,
    options: CheckOptions
  ): readonly MapProblem[] => [
    ...uniqueIds(data),
    ...references(data),
    ...walkthrough(data),
    ...links(data, options.linkExists),
    ...checkLayout(data, layout),
    ...emptyGroups(data),
  ]
);

/** Every relative link in the map, for resolving before `checkMap`. */
export const linkTargets = (data: MapData): readonly string[] =>
  Arr.map(relativeLinks(data), ({ link }) => link);
