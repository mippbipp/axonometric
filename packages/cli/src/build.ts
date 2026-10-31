import { Effect, FileSystem, Path } from "effect";
import { Argument, Command } from "effect/cli";

import { loadMap } from "./map-files.ts";
import { renderPage } from "./page.ts";
import { renderSystemMd } from "./system-md.ts";

/** Writes `content` beside its final name, then renames it into place. */
const writeAtomic = Effect.fnUntraced(function* (
  file: string,
  content: string
) {
  const fs = yield* FileSystem.FileSystem;
  const temporary = `${file}.${process.pid}.tmp`;

  yield* fs.writeFileString(temporary, content);
  yield* fs.rename(temporary, file);
});

const build = Effect.fnUntraced(function* (home: string) {
  const path = yield* Path.Path;
  const output = path.dirname(home);
  const system = path.basename(output);
  const map = yield* loadMap(home);
  const state = { system, ...map };

  const systemMd = renderSystemMd(state, path.relative(output, home));
  const page = yield* renderPage(state);
  const pageFile = path.join(output, `${system}.html`);

  yield* writeAtomic(path.join(output, "SYSTEM.md"), systemMd);
  yield* writeAtomic(pageFile, page);

  yield* Effect.log(
    `Built ${path.join(output, "SYSTEM.md")} and ${pageFile}: ${map.data.structures.length} structures, ${map.data.hops.length} hops.`
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
