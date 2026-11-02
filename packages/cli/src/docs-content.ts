import {
  Effect,
  FileSystem,
  Path,
  Record as Rec,
  Schema,
  String as Str,
  Array as Arr,
} from "effect";
import { CliError } from "effect/cli";

/** The docs folder is missing or unreadable, so there's nothing to print. */
export class DocsNotFound extends Schema.TaggedError<
  DocsNotFound,
  { readonly brand: unique symbol }
>()("DocsNotFound", { folder: Schema.String }) {
  public override get [CliError.userMessage]() {
    return `The docs aren't there: ${this.folder} can't be read.`;
  }
}

/**
 * The text of each Markdown file in the package's `docs` folder, keyed by
 * its name without `.md`. Running from source reads the folder. The bundle
 * replaces this module with one that holds the text as strings (see
 * `tsdown.config.ts`), so `docs` works offline from every install.
 */
export const docsContent: Effect.Effect<
  Readonly<Record<string, string>>,
  DocsNotFound,
  FileSystem.FileSystem | Path.Path
> = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const folder = path.join(import.meta.dirname, "..", "docs");

  const names = yield* fs
    .readDirectory(folder)
    .pipe(Effect.mapError(() => DocsNotFound.make({ folder })));

  const files = Arr.filter(names, Str.endsWith(".md"));

  const texts = yield* Effect.forEach(files, (file) =>
    fs.readFileString(path.join(folder, file)).pipe(
      Effect.mapBoth({
        onSuccess: (text) => [Str.slice(0, -3)(file), text] as const,
        onFailure: () => DocsNotFound.make({ folder }),
      })
    )
  );

  return Rec.fromEntries(texts);
});
