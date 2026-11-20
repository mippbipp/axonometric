import { formatProblem, placeStructures } from "@axonometric/contracts";
import type { MapProblem, MapState } from "@axonometric/contracts";
import { Array as Arr, Console, Effect, Option, Record as Rec } from "effect";
import { Argument, Command } from "effect/cli";

import { homePaths } from "./home-paths.ts";
import type { HomePaths } from "./home-paths.ts";
import { withLock } from "./lock.ts";
import { encodeLayout, loadMap } from "./map-files.ts";
import { renderPage } from "./page.ts";
import { renderSystemMd } from "./system-md.ts";
import { writeAll } from "./write-files.ts";
import type { Output } from "./write-files.ts";

const quoted = (ids: ReadonlyArray<string>) =>
  Arr.join(
    Arr.map(ids, (id) => `"${id}"`),
    ", "
  );

/**
 * Prints a rebuild's warnings, and the line saying why source links were
 * skipped, if they were.
 */
export const printNotes = Effect.fnUntraced(function* ({
  sourcesSkipped,
  warnings,
}: {
  readonly sourcesSkipped: Option.Option<string>;
  readonly warnings: ReadonlyArray<MapProblem>;
}) {
  yield* Effect.forEach(
    warnings,
    (warning) => Console.error(formatProblem(warning)),
    { concurrency: 1, discard: true }
  );

  yield* Option.match(sourcesSkipped, {
    onNone: () => Effect.void,
    onSome: (line) => Console.error(line),
  });
});

/**
 * The two files `build` writes from an accepted `state`: SYSTEM.md and the
 * read-only page, both in the home folder's parent. Pending changes never
 * reach them.
 */
export const siteOutputs = Effect.fnUntraced(function* (
  state: MapState,
  paths: HomePaths
) {
  const outputs: ReadonlyArray<Output> = [
    {
      content: renderSystemMd(state, paths.homeFromOutput),
      file: paths.systemMdFile,
    },
    { content: yield* renderPage(state), file: paths.pageFile },
  ];

  return outputs;
});

/**
 * Does what `build` does, without printing: validates the map in `home`,
 * places structures that have no position and saves them, then writes
 * SYSTEM.md and the read-only page. Fails with `MapInvalid` and writes
 * nothing when the map has an error. `command` is named in the lock and in
 * the error.
 */
export const rebuild = Effect.fnUntraced(function* (
  paths: HomePaths,
  command: string
) {
  yield* withLock(paths, command);

  const {
    data,
    layout,
    proposals,
    saved,
    sourceLinks,
    sourcesSkipped,
    warnings,
  } = yield* loadMap({
    arrange: (mapData, savedLayout) =>
      placeStructures(mapData, savedLayout).layout,
    command,
    paths,
  });

  const placed = Arr.filter(
    Rec.keys(layout.structures),
    (id) => !Rec.has(saved.structures, id)
  );

  const pruned = Arr.filter(
    Rec.keys(saved.structures),
    (id) => !Rec.has(layout.structures, id)
  );

  const prunedRoutes = Arr.filter(
    Rec.keys(saved.routes ?? {}),
    (id) => !Rec.has(layout.routes ?? {}, id)
  );

  const changed =
    placed.length > 0 || pruned.length > 0 || prunedRoutes.length > 0;

  const next = changed ? { ...layout, revision: saved.revision + 1 } : saved;
  const state: MapState = {
    data,
    layout: next,
    sourceLinks,
    system: paths.system,
  };

  // The state holds the accepted layout only. Pending changes reach served
  // pages through serve, never SYSTEM.md or the read-only page.
  const outputs = yield* siteOutputs(state, paths);

  // layout.json is only written when placing added or pruned structures or
  // pruned route overrides.
  // Under serve the write is one more watch event, and that rebuild finds
  // every structure placed, so it writes no layout and the loop ends.
  const layoutOutput: ReadonlyArray<Output> = changed
    ? [{ content: yield* encodeLayout(next), file: paths.layoutFile }]
    : [];

  yield* writeAll([...layoutOutput, ...outputs]);

  return {
    placed,
    proposals,
    pruned,
    prunedRoutes,
    sourcesSkipped,
    state,
    warnings,
  };
}, Effect.scoped);

const build = Effect.fn("build")(function* (home: string) {
  const paths = yield* homePaths(home);
  const { layoutFile, pageFile, systemMdFile } = paths;

  const { placed, pruned, prunedRoutes, sourcesSkipped, state, warnings } =
    yield* rebuild(paths, "build");

  yield* printNotes({ sourcesSkipped, warnings });

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

  if (prunedRoutes.length > 0) {
    yield* Effect.log(
      `Removed the route override${prunedRoutes.length === 1 ? "" : "s"} for ${quoted(prunedRoutes)} from ${layoutFile}: no hop in data.mjs has ${prunedRoutes.length === 1 ? "that id" : "those ids"}.`
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
