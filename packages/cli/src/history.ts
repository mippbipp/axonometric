import {
  describeCause,
  historyEntryOf,
  historyFolder,
  mapError,
  mapWarning,
  parseRevisionFileName,
  problemsFromIssue,
  RevisionFile,
  revisionFileName,
} from "@axonometric/contracts";
import type {
  HistoryEntry,
  Layout,
  MapFile,
  MapProblem,
  Revision,
} from "@axonometric/contracts";
import {
  Array as Arr,
  Effect,
  FileSystem,
  Option,
  Order,
  Path,
  Record as Rec,
  Result,
  Schema,
} from "effect";

const encodeRevisionFile = Schema.encodeEffect(RevisionFile);

const decodeRevisionFile = Schema.decodeUnknownResult(RevisionFile, {
  errors: "all",
  onExcessProperty: "error",
});

/** The text of a revision file for `revision`. */
export const encodeRevision = (revision: Revision) =>
  encodeRevisionFile(revision).pipe(Effect.orDie);

/** The name a revision's file goes by in problems, such as `history/0003.json`. */
export const revisionFileOf = (n: number): MapFile =>
  `${historyFolder}/${revisionFileName(n)}`;

/**
 * The revision numbers of the files in `history/`, from their names alone,
 * so a file that doesn't decode still holds its number. A missing folder
 * holds none. Anything in the folder that isn't named like a revision file,
 * such as a temporary file, is left out.
 */
export const revisionsIn = Effect.fnUntraced(function* (home: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const names = yield* fs
    .readDirectory(path.join(home, historyFolder))
    .pipe(
      Effect.catchReason("PlatformError", "NotFound", () =>
        Effect.succeed<readonly string[]>([])
      )
    );

  return Arr.sort(
    Arr.flatMap(names, (name) => Option.toArray(parseRevisionFileName(name))),
    Order.Number
  );
});

/** The number the next revision takes: one more than the highest saved. */
export const nextRevision = (home: string) =>
  revisionsIn(home).pipe(Effect.map((saved) => (saved.at(-1) ?? 0) + 1));

/**
 * Reads every file in `history/` and reports each one that isn't a valid
 * revision file, naming the file. A file whose `revision` isn't the number in
 * its name is a problem too. With `strict` they are errors, as `check` reports
 * them; otherwise warnings, so a damaged old revision doesn't stop `build` or
 * `serve`.
 */
export const checkHistory = Effect.fnUntraced(function* (
  home: string,
  strict: boolean
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const make = strict ? mapError : mapWarning;
  const suffix = strict ? "" : " This revision is ignored until it is fixed.";

  const check = Effect.fnUntraced(function* (n: number) {
    const file = revisionFileOf(n);

    const text = yield* fs
      .readFileString(path.join(home, historyFolder, revisionFileName(n)))
      .pipe(Effect.result);

    if (Result.isFailure(text)) {
      return [
        make({
          file,
          path: [],
          message: `could not be read: ${describeCause(text.failure)}.${suffix}`,
        }),
      ];
    }

    const decoded = decodeRevisionFile(text.success);

    if (Result.isFailure(decoded)) {
      return Arr.map(
        problemsFromIssue(file, decoded.failure.issue),
        (problem): MapProblem => ({
          ...problem,
          severity: strict ? "error" : "warning",
          message: `${problem.message}${suffix}`,
        })
      );
    }

    return decoded.success.revision === n
      ? []
      : [
          make({
            file,
            path: ["revision"],
            message: `is ${decoded.success.revision}, but the file is named for revision ${n}. A revision file's number is the number in its name.${suffix}`,
          }),
        ];
  });

  const found = yield* Effect.forEach(yield* revisionsIn(home), check);

  return Arr.flatten(found);
});

/**
 * Reads revision `n`, or nothing when its file is missing, doesn't decode or
 * holds another revision's number. The path is built from the number with
 * `revisionFileName` alone, so no text from a request reaches the file system.
 */
export const readRevision = Effect.fnUntraced(function* (
  home: string,
  n: number
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const text = yield* fs
    .readFileString(path.join(home, historyFolder, revisionFileName(n)))
    .pipe(Effect.result);

  if (Result.isFailure(text)) {
    return Option.none<Revision>();
  }

  const decoded = decodeRevisionFile(text.success);

  if (Result.isSuccess(decoded) && decoded.success.revision === n) {
    return Option.some(decoded.success);
  }

  return Option.none<Revision>();
});

/**
 * The History panel's lines, newest first: one for each revision file that
 * reads. A revision file is never rewritten, so a line in `known` is kept as
 * it is and its file isn't read again. A file that doesn't read is left out
 * until it does; `serve` and `check` report it.
 */
export const loadHistory = Effect.fnUntraced(function* (
  home: string,
  known: readonly HistoryEntry[]
) {
  const saved = yield* revisionsIn(home);
  const kept = new Map(Arr.map(known, (entry) => [entry.revision, entry]));

  const entries = yield* Effect.forEach(saved, (n) => {
    const entry = kept.get(n);

    return entry === undefined
      ? Effect.map(readRevision(home, n), Option.map(historyEntryOf))
      : Effect.succeedSome(entry);
  });

  return Arr.reverse(Arr.flatMap(entries, Option.toArray));
});

/**
 * The ids of the structures the accepted map had before the agent last edited
 * data.mjs: those in the newest revision that reads, else the ones
 * `layout.json` places. `verdict --as` may not name one of these, since it
 * gives a new structure an id of its own.
 */
export const acceptedStructureIds = Effect.fnUntraced(function* (
  home: string,
  layout: Layout
) {
  const newest = (yield* revisionsIn(home)).at(-1);
  const found =
    newest === undefined ? undefined : yield* readRevision(home, newest);

  return new Set(
    found === undefined || Option.isNone(found)
      ? Rec.keys(layout.structures)
      : Arr.map(found.value.data.structures, ({ id }) => id)
  );
});
