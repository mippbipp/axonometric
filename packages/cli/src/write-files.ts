import {
  Array as Arr,
  Duration,
  Effect,
  FileSystem,
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

/**
 * Writes every output to a temporary file beside it, and only then renames
 * them all into place, so a failed write leaves every old output as it was.
 * On any failure the temporary files are removed.
 */
export const writeAll = Effect.fnUntraced(function* (
  outputs: readonly Output[]
) {
  const fs = yield* FileSystem.FileSystem;

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
      ({ temporary, content }) => fs.writeFileString(temporary, content),
      { discard: true }
    );

    yield* Effect.forEach(
      staged,
      ({ temporary, file }) => renameInto(temporary, file),
      { discard: true }
    );
  }).pipe(Effect.onError(() => removeTemporaries));
});
