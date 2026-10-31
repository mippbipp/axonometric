import { Effect, FileSystem, Path, Schema } from "effect";
import { CliError } from "effect/cli";

/** The editor's built page is missing, so there's nothing to embed. */
export class EditorNotBuilt extends Schema.TaggedError<
  EditorNotBuilt,
  { readonly brand: unique symbol }
>()("EditorNotBuilt", { file: Schema.String }) {
  public override get [CliError.userMessage]() {
    return `The editor page isn't built: ${this.file} is missing. Run pnpm build first.`;
  }
}

/**
 * The editor app, built into one HTML file. Running from source reads it from
 * the editor package's `dist`. The bundle replaces this module with one that
 * holds the HTML as a string (see `tsdown.config.ts`), so the bundle needs no
 * other files.
 */
export const editorPage = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const file = path.join(
    import.meta.dirname,
    "..",
    "..",
    "editor",
    "dist",
    "index.html"
  );

  return yield* fs
    .readFileString(file)
    .pipe(Effect.mapError(() => EditorNotBuilt.make({ file })));
});
