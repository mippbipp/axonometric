import { Array as Arr, Option, Schema, String as Str } from "effect";
import { dual } from "effect/Function";

import type { MapData, Source } from "./map-data.ts";
import { mapError, mapWarning } from "./problems.ts";
import type { MapProblem } from "./problems.ts";

/**
 * What git knows about one source. `checkMap` reads these and never runs
 * git itself, so the CLI gathers them first. "A file" means a blob that git
 * tracks: a folder or an untracked file doesn't count.
 */
export const SourceFact = Schema.TaggedUnion({
  /** The source has no commit, so only `HEAD` matters. */
  Unpinned: {
    /** Whether the path is a file at `HEAD`. */
    atHead: Schema.Boolean,
  },
  /** The source's commit isn't in the local history. */
  UnknownCommit: { commit: Schema.String },
  Pinned: {
    commit: Schema.String,
    /** Whether the path is a file at the pinned commit. */
    atCommit: Schema.Boolean,
    /** Whether the path is a file at `HEAD`. */
    atHead: Schema.Boolean,
    /** Whether the file differs between the pinned commit and `HEAD`. */
    changed: Schema.Boolean,
  },
});

export type SourceFact = typeof SourceFact.Type;

/** Looks up the git facts for one source. */
export type SourceFacts = (source: Source) => SourceFact;

/**
 * A source path's segments with `.` and `..` resolved, or None when the path
 * climbs out of the folder it starts in.
 */
export const sourceSegments = (
  path: string
): Option.Option<readonly string[]> => {
  const segments: string[] = [];

  for (const segment of Str.split(path, "/")) {
    if (segment === "..") {
      if (segments.pop() === undefined) {
        return Option.none();
      }
    } else if (segment !== "." && segment !== "") {
      segments.push(segment);
    }
  }

  return Option.some(segments);
};

/** A source path with `.` and `..` resolved, such as `src/a.ts`. */
export const normalSourcePath = (path: string) =>
  Option.match(sourceSegments(path), {
    onNone: () => path,
    onSome: (segments) => Arr.join(segments, "/"),
  });

const at = (structure: number, source: number, field: keyof Source) => [
  "structures",
  structure,
  "sources",
  source,
  field,
];

const problemsOf = (
  { id, source }: { readonly id: string; readonly source: Source },
  fact: SourceFact,
  where: { readonly structure: number; readonly source: number }
): readonly MapProblem[] => {
  const path = at(where.structure, where.source, "path");
  const named = `"${source.path}"`;

  return SourceFact.match(fact, {
    Unpinned: ({ atHead }) =>
      atHead
        ? []
        : [
            mapError({
              file: "data.mjs",
              path,
              message: `${named} isn't a file git tracks at HEAD. Source paths are from the root of the repo that holds the home folder. Fix the path in structure "${id}", or remove the source.`,
            }),
          ],
    UnknownCommit: ({ commit }) => [
      mapError({
        file: "data.mjs",
        path: at(where.structure, where.source, "commit"),
        message: `commit ${commit} isn't in the local git history. Run git fetch if it's on a branch you don't have, or fix the hash in structure "${id}".`,
      }),
    ],
    Pinned: ({ commit, atCommit, atHead, changed }) => {
      if (!atCommit) {
        return [
          mapError({
            file: "data.mjs",
            path,
            message: `${named} doesn't exist at commit ${commit}. Source paths are from the root of the repo that holds the home folder. Fix the path in structure "${id}", or pin the commit its text describes.`,
          }),
        ];
      }

      if (!atHead) {
        return [
          mapWarning({
            file: "data.mjs",
            path,
            message: `${named} exists at commit ${commit} but not at HEAD, so it was renamed or deleted. Reread structure "${id}", point the source at the file's new path or remove it, and pin it to HEAD.`,
          }),
        ];
      }

      return changed
        ? [
            mapWarning({
              file: "data.mjs",
              path,
              message: `${named} changed between commit ${commit} and HEAD. Reread structure "${id}" against the file, update its text, then pin the source to HEAD.`,
            }),
          ]
        : [];
    },
  });
};

/**
 * A structure's sources with repeats dropped. Two sources repeat when their
 * paths name the same file, whatever their commits. The page and SYSTEM.md
 * show these, and `check` warns about the rest.
 */
export const uniqueSources = (sources: readonly Source[]): readonly Source[] =>
  Arr.dedupeWith(
    sources,
    (a, b) => normalSourcePath(a.path) === normalSourcePath(b.path)
  );

/** A warning for every source that repeats an earlier one in its structure. */
export const repeatedSources = (data: MapData): readonly MapProblem[] =>
  Arr.flatMap(data.structures, (structure, index) => {
    const seen = new Set<string>();

    return Arr.flatMap(structure.sources ?? [], (source, sourceIndex) => {
      const file = normalSourcePath(source.path);
      const repeated = seen.has(file);

      seen.add(file);

      return repeated
        ? [
            mapWarning({
              file: "data.mjs",
              path: at(index, sourceIndex, "path"),
              message: `structure "${structure.id}" already lists "${file}", so the page and SYSTEM.md show it once. Remove this source, or merge the two into one with the commit the text describes.`,
            }),
          ]
        : [];
    });
  });

/** Errors and warnings for every structure's sources, from git's facts. */
export const checkSources: {
  (facts: SourceFacts): (data: MapData) => readonly MapProblem[];
  (data: MapData, facts: SourceFacts): readonly MapProblem[];
} = dual(2, (data: MapData, facts: SourceFacts): readonly MapProblem[] =>
  Arr.flatMap(data.structures, (structure, index) =>
    Arr.flatMap(structure.sources ?? [], (source, sourceIndex) =>
      problemsOf({ id: structure.id, source }, facts(source), {
        structure: index,
        source: sourceIndex,
      })
    )
  )
);

/**
 * Identifies a source by its commit and normalised path, so two structures
 * that list the same file at the same commit share one key.
 */
export const sourceKey = (source: Source) =>
  `${source.commit ?? ""}:${normalSourcePath(source.path)}`;
