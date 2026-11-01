import { formatProblem, placeStructures } from "@axonometric/contracts";
import { Array as Arr, Console, Effect, Path, Record as Rec } from "effect";
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

const build = Effect.fn("build")(function* (home: string) {
  const path = yield* Path.Path;
  const output = path.dirname(home);
  const system = path.basename(output);

  yield* withLock(home, "build");

  const { warnings, data, layout, saved } = yield* loadMap({
    home,
    output,
    command: "build",
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

  const prunedRoutes = Arr.filter(
    Rec.keys(saved.routes ?? {}),
    (id) => !Rec.has(layout.routes ?? {}, id)
  );

  const changed =
    placed.length > 0 || pruned.length > 0 || prunedRoutes.length > 0;

  const next = changed ? { ...layout, revision: saved.revision + 1 } : saved;
  const state = { system, data, layout: next };

  yield* Effect.forEach(
    warnings,
    (warning) => Console.error(formatProblem(warning)),
    { discard: true }
  );

  const systemMdFile = path.join(output, "SYSTEM.md");
  const pageFile = path.join(output, `${system}.html`);
  const layoutFile = path.join(home, "layout.json");
  const page = yield* renderPage(state);

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
    `Built ${systemMdFile} and ${pageFile}: ${data.structures.length} structures, ${data.hops.length} hops.`
  );
}, Effect.scoped);

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
