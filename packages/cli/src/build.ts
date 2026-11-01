import { formatProblem, placeStructures } from "@axonometric/contracts";
import type { MapProblem, MapState } from "@axonometric/contracts";
import {
  Array as Arr,
  Console,
  Effect,
  Option,
  Path,
  Record as Rec,
} from "effect";
import { Argument, Command } from "effect/cli";

import { withLock } from "./lock.ts";
import { encodeLayout, loadMap } from "./map-files.ts";
import { renderPage } from "./page.ts";
import { renderSystemMd } from "./system-md.ts";
import { writeAll } from "./write-files.ts";
import type { Output } from "./write-files.ts";

const quoted = (ids: readonly string[]) =>
  Arr.join(
    Arr.map(ids, (id) => `"${id}"`),
    ", "
  );

/**
 * Prints a rebuild's warnings, and the line saying why source links were
 * skipped, if they were.
 */
export const printNotes = Effect.fnUntraced(function* ({
  warnings,
  sourcesSkipped,
}: {
  readonly warnings: readonly MapProblem[];
  readonly sourcesSkipped: Option.Option<string>;
}) {
  yield* Effect.forEach(
    warnings,
    (warning) => Console.error(formatProblem(warning)),
    { discard: true }
  );

  yield* Option.match(sourcesSkipped, {
    onNone: () => Effect.void,
    onSome: (line) => Console.error(line),
  });
});

/**
 * Does what `build` does, without printing: validates the map in `home`,
 * places structures that have no position and saves them, then writes
 * SYSTEM.md and the read-only page. Fails with `MapInvalid` and writes
 * nothing when the map has an error. `command` is named in the lock and in
 * the error.
 */
export const rebuild = Effect.fnUntraced(function* (
  home: string,
  command: string
) {
  const path = yield* Path.Path;
  const output = path.dirname(home);
  const system = path.basename(output);

  yield* withLock(home, command);

  const { warnings, data, layout, saved, sourceLinks, sourcesSkipped } =
    yield* loadMap({
      home,
      output,
      command,
      arrange: (mapData, savedLayout) =>
        placeStructures(mapData, savedLayout).layout,
    });

  const placed = Arr.filter(
    Rec.keys(layout.structures),
    (id) => !Rec.has(saved.structures, id)
  );

  const pruned = Arr.filter(
    Rec.keys(saved.structures),
    (id) => !Rec.has(layout.structures, id)
  );

  const changed = placed.length > 0 || pruned.length > 0;
  const next = changed ? { ...layout, revision: saved.revision + 1 } : saved;
  const state: MapState = { system, data, layout: next, sourceLinks };

  const systemMdFile = path.join(output, "SYSTEM.md");
  const pageFile = path.join(output, `${system}.html`);
  const layoutFile = path.join(home, "layout.json");
  const page = yield* renderPage(state);

  // layout.json is only written when placing added or pruned structures.
  // Under serve the write is one more watch event, and that rebuild finds
  // every structure placed, so it writes no layout and the loop ends.
  const layoutOutput: readonly Output[] = changed
    ? [{ file: layoutFile, content: yield* encodeLayout(next) }]
    : [];

  yield* writeAll([
    ...layoutOutput,
    {
      file: systemMdFile,
      content: renderSystemMd(state, path.relative(output, home)),
    },
    { file: pageFile, content: page },
  ]);

  return {
    state,
    warnings,
    sourcesSkipped,
    placed,
    pruned,
    systemMdFile,
    pageFile,
    layoutFile,
  };
}, Effect.scoped);

const build = Effect.fn("build")(function* (home: string) {
  const {
    state,
    warnings,
    sourcesSkipped,
    placed,
    pruned,
    systemMdFile,
    pageFile,
    layoutFile,
  } = yield* rebuild(home, "build");

  yield* printNotes({ warnings, sourcesSkipped });

  if (placed.length > 0) {
    yield* Effect.log(
      `Placed ${quoted(placed)} in ${layoutFile}. Move any of them with axonometric layout.`
    );
  }

  if (pruned.length > 0) {
    yield* Effect.log(
      `Removed ${quoted(pruned)} from ${layoutFile}: no structure in data.mjs has ${pruned.length === 1 ? "that id" : "those ids"}.`
    );
  }

  yield* Effect.log(
    `Built ${systemMdFile} and ${pageFile}: ${state.data.structures.length} structures, ${state.data.hops.length} hops.`
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
    "Validate the map, place structures that have no position yet and save them to layout.json, then write SYSTEM.md and <system>.html to the home folder's parent"
  )
);
