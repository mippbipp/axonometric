import {
  Array as Arr,
  Duration,
  Effect,
  FileSystem,
  Option,
  Path,
  Predicate,
  Schedule,
} from "effect";

export interface Output {
  readonly file: string;
  readonly content: string;
}

/**
 * How long a rename keeps retrying on Windows: a delay from 10 ms doubling
 * to 100 ms, for about 2 s in all. Elsewhere the first failure stands.
 */
const renameRetries = Schedule.exponential(Duration.millis(10)).pipe(
  Schedule.modifyDelay(({ duration }) =>
    Effect.succeed(Duration.min(duration, Duration.millis(100)))
  ),
  Schedule.upTo({ duration: Duration.seconds(2) })
);

/**
 * The error codes of a rename that failed because another process holds the
 * target open. Windows refuses to replace a file that is open elsewhere, with `EPERM`,
 * `EACCES` or `EBUSY`, and an editor, a page, a virus scanner or another
 * `axonometric` command can hold any output open for a moment.
 */
const heldOpenCodes = new Set(["EPERM", "EACCES", "EBUSY"]);

/** Renames `temporary` over `file`, retrying on Windows while it's held open. */
const renameInto = (temporary: string, file: string) =>
  FileSystem.FileSystem.use((fs) => fs.rename(temporary, file)).pipe(
    process.platform === "win32"
      ? Effect.retry({
          schedule: renameRetries,
          while: ({ reason }) =>
            Predicate.hasProperty(reason.cause, "code") &&
            heldOpenCodes.has(String(reason.cause.code)),
        })
      : (effect) => effect
  );

/** The text of `file` now, or nothing when it doesn't exist. */
const currentContent = (file: string) =>
  FileSystem.FileSystem.use((fs) => fs.readFileString(file)).pipe(
    Effect.asSome,
    Effect.catchReason("PlatformError", "NotFound", () => Effect.succeedNone)
  );

/**
 * Writes every output to a temporary file beside it, and only then renames
 * them all into place in the order given, so a failed write leaves every old
 * output as it was. The folder of an output is created if it's missing, which
 * is the one thing that outlasts a failure.
 *
 * Renames can't be done together, so when one fails, the ones before it are
 * put back: a file that existed gets its old text again, and a file that
 * didn't is removed. Putting back is a best effort, since the disk that just
 * refused one rename may refuse another. Temporary files are always removed.
 */
export const writeAll = Effect.fnUntraced(function* (
  outputs: readonly Output[]
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const staged = Arr.map(outputs, ({ file, content }) => ({
    file,
    content,
    temporary: `${file}.${process.pid}.tmp`,
  }));

  const removeTemporaries = Effect.forEach(
    staged,
    ({ temporary }) => fs.remove(temporary).pipe(Effect.ignore),
    { discard: true }
  );

  yield* Effect.gen(function* () {
    yield* Effect.forEach(
      staged,
      ({ file, temporary, content }) =>
        fs
          .makeDirectory(path.dirname(file), { recursive: true })
          .pipe(Effect.andThen(fs.writeFileString(temporary, content))),
      { discard: true }
    );

    const before = yield* Effect.forEach(staged, ({ file }) =>
      currentContent(file)
    );

    const renamed: number[] = [];

    const putBack = Effect.forEach(
      Arr.reverse(renamed),
      (index) => {
        const target = staged[index];
        const old = before[index];

        return target === undefined || old === undefined
          ? Effect.void
          : Option.match(old, {
              onNone: () => fs.remove(target.file),
              onSome: (text) =>
                fs
                  .writeFileString(target.temporary, text)
                  .pipe(
                    Effect.andThen(renameInto(target.temporary, target.file))
                  ),
            }).pipe(Effect.ignore);
      },
      { discard: true }
    );

    yield* Effect.forEach(
      staged,
      ({ temporary, file }, index) =>
        renameInto(temporary, file).pipe(
          Effect.tap(() => Effect.sync(() => renamed.push(index)))
        ),
      { discard: true }
    ).pipe(Effect.onError(() => putBack));
  }).pipe(Effect.onError(() => removeTemporaries));
});
