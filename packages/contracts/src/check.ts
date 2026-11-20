import { Array as Arr, Option, String as Str } from "effect";
import { dual } from "effect/Function";

import { checkLayout } from "./layout-checks.ts";
import type { Layout } from "./layout.ts";
import type { MapData } from "./map-data.ts";
import { mapError, mapWarning } from "./problems.ts";
import type { MapProblem } from "./problems.ts";
import { checkSources, repeatedSources } from "./sources.ts";
import type { SourceFacts } from "./sources.ts";

type Path = ReadonlyArray<PropertyKey>;

const error = (path: Path, message: string) =>
  mapError({ file: "data.mjs", message, path });

const warning = (path: Path, message: string) =>
  mapWarning({ file: "data.mjs", message, path });

interface Keyed {
  readonly key: string;
  readonly path: Path;
}

/** An error for every item whose key an earlier item already uses. */
const repeats = (
  items: ReadonlyArray<Keyed>,
  message: (key: string) => string
): ReadonlyArray<MapProblem> => {
  const seen = new Set<string>();

  return Arr.flatMap(items, ({ key, path }) => {
    const repeated = seen.has(key);

    seen.add(key);

    return repeated ? [error(path, message(key))] : [];
  });
};

const keyedBy = <A>(
  items: ReadonlyArray<A>,
  section: string,
  field: keyof A & string
): ReadonlyArray<Keyed> =>
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
  { ids, path }: { readonly ids: ReadonlyArray<string>; readonly path: Path },
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
const walkthrough = (data: MapData): ReadonlyArray<MapProblem> => {
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
              )}, which no chapter has revealed by chapter "${chapter.id}". Reveal ${hidden.length === 1 ? "it" : "them"} in this chapter or an earlier one, or move the hop to a chapter that reveals ${hidden.length === 1 ? "it" : "them"}.`
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
const relativeLinks = (data: MapData): ReadonlyArray<RelativeLink> => {
  const fields: ReadonlyArray<LinkField> = [
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
): ReadonlyArray<MapProblem> => {
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

/** The most new structures a chapter other than the last reveals. */
const maxReveals = 3;

/** The most hops a chapter other than the last plays. */
const maxPlays = 5;

/**
 * A chapter other than the last is a small stop: a few new structures and a
 * small flow. The last chapter reveals what's left and replays the flows.
 */
const chapterSize = (data: MapData): ReadonlyArray<MapProblem> =>
  Arr.flatMap(data.chapters.slice(0, -1), (chapter, index) => [
    ...(chapter.reveals.length > maxReveals
      ? [
          warning(
            ["chapters", index, "reveals"],
            `chapter "${chapter.id}" reveals ${chapter.reveals.length} structures, and a chapter other than the last should reveal at most ${maxReveals}. Split it into two chapters, each with a small flow.`
          ),
        ]
      : []),
    ...(chapter.plays.length > maxPlays
      ? [
          warning(
            ["chapters", index, "plays"],
            `chapter "${chapter.id}" plays ${chapter.plays.length} hops, and a chapter other than the last should play at most ${maxPlays}. Split it into two chapters, each with a small flow, and leave the full story to a flow in the last chapter.`
          ),
        ]
      : []),
  ]);

/** The letters and digits of `text`, lowercased, with spaces and punctuation gone. */
const lettersOf = (text: string) =>
  Str.replaceAll(/[^\p{L}\p{N}]/gu, "")(Str.toLowerCase(text));

/** Whether the letters of `short` appear in `long` in order, not necessarily next to each other. */
const isSubsequence = (short: string, long: string) =>
  Option.isSome(
    Arr.reduce(Arr.fromIterable(short), Option.some(0), (from, letter) =>
      Option.flatMap(from, (start) =>
        Option.map(
          Str.indexOf(letter)(Str.slice(start)(long)),
          (found) => start + found + 1
        )
      )
    )
  );

/**
 * Whether `tag` could be a shortened `name`: each word of the tag is a
 * prefix, an abbreviation or an initialism of the name, so its letters
 * appear in the name's letters in order. "DB" for "Database" and "PR" for
 * "Pull request" pass, and "flake-updater" for "Updater" does not.
 */
const shortensName = (tag: string, name: string) => {
  const letters = lettersOf(name);

  const words = Arr.filter(
    Arr.map(Str.split(/[^\p{L}\p{N}]+/u)(tag), lettersOf),
    (word) => word !== ""
  );

  return Arr.every(words, (word) => isSubsequence(word, letters));
};

/** A tag only shortens the name, so it is shorter and made from the name. */
const tagShortensName = (data: MapData): ReadonlyArray<MapProblem> =>
  Arr.flatMap(data.structures, (structure, index) => {
    const { name, tag } = structure;

    if (tag === undefined) {
      return [];
    }

    if (tag.length >= name.length) {
      return [
        warning(
          ["structures", index, "tag"],
          `tag "${tag}" is not shorter than the name "${name}". A tag only shortens a long name. Remove it, or shorten the name's own words. A resource's real identifier, such as a unit or file name, goes in howItsBuilt.`
        ),
      ];
    }

    return shortensName(tag, name)
      ? []
      : [
          warning(
            ["structures", index, "tag"],
            `tag "${tag}" doesn't read as a shortened form of the name "${name}". A tag is not a second name. Shorten the name's own words, or remove the tag and put a resource's real identifier, such as a unit or file name, in howItsBuilt.`
          ),
        ];
  });

export interface CheckOptions {
  /**
   * Whether a relative link, such as `../adr/0001-runtime.md#context`,
   * resolves to a file. Links are relative to SYSTEM.md, and a fragment
   * names a place in the file.
   */
  readonly linkExists: (link: string) => boolean;
  /**
   * What git knows about each structure's sources. Leave it out to skip the
   * source checks, such as when the home folder isn't in a git repo.
   */
  readonly sourceFacts?: SourceFacts | undefined;
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
  (options: CheckOptions): (files: MapFiles) => ReadonlyArray<MapProblem>;
  (files: MapFiles, options: CheckOptions): ReadonlyArray<MapProblem>;
} = dual(
  2,
  (
    { data, layout }: MapFiles,
    options: CheckOptions
  ): ReadonlyArray<MapProblem> => [
    ...uniqueIds(data),
    ...references(data),
    ...walkthrough(data),
    ...links(data, options.linkExists),
    ...(options.sourceFacts === undefined
      ? []
      : checkSources(data, options.sourceFacts)),
    ...repeatedSources(data),
    ...checkLayout(data, layout),
    ...emptyGroups(data),
    ...chapterSize(data),
    ...tagShortensName(data),
  ]
);

/** Every relative link in the map, for resolving before `checkMap`. */
export const linkTargets = (data: MapData): ReadonlyArray<string> =>
  Arr.map(relativeLinks(data), ({ link }) => link);
