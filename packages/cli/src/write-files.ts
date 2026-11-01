import { Array as Arr, Effect, FileSystem } from "effect";

export interface Output {
  readonly file: string;
  readonly content: string;
}

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
      ({ temporary, file }) => fs.rename(temporary, file),
      { discard: true }
    );
  }).pipe(Effect.onError(() => removeTemporaries));
});
