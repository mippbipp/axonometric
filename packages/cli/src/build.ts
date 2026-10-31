import { Array as Arr, Effect, FileSystem, Path } from "effect";
import { Argument, Command } from "effect/cli";

import { loadMap } from "./map-files.ts";
import { renderPage } from "./page.ts";
import { renderSystemMd } from "./system-md.ts";

interface Output {
  readonly file: string;
  readonly content: string;
}

/**
 * Writes every output to a temporary file beside it, and only then renames
 * them all into place, so a failed write leaves every old output as it was.
 * On any failure the temporary files are removed.
 */
const writeAll = Effect.fnUntraced(function* (outputs: readonly Output[]) {
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

const build = Effect.fn("build")(function* (home: string) {
  const path = yield* Path.Path;
  const output = path.dirname(home);
  const system = path.basename(output);
  const map = yield* loadMap(home);
  const state = { system, ...map };

  const systemMdFile = path.join(output, "SYSTEM.md");
  const pageFile = path.join(output, `${system}.html`);
  const page = yield* renderPage(state);

  yield* writeAll([
    {
      file: systemMdFile,
      content: renderSystemMd(state, path.relative(output, home)),
    },
    { file: pageFile, content: page },
  ]);

  yield* Effect.log(
    `Built ${systemMdFile} and ${pageFile}: ${map.data.structures.length} structures, ${map.data.hops.length} hops.`
  );
});

export const buildCommand = Command.make(
  "build",
  {
    home: Argument.Directory("home", { mustExist: true }).pipe(
      Argument.withDescription(
        "The map's home folder, holding data.mjs and layout.json"
      )
    ),
  },
  ({ home }) => build(home)
).pipe(
  Command.withDescription(
    "Validate the map, then write SYSTEM.md and <system>.html to the home folder's parent"
  )
);
