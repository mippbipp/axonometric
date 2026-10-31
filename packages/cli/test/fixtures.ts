import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Path } from "effect";

import type { HomeFiles } from "./harness.ts";

const minimalMapFiles = ["pipeline/map/data.mjs", "pipeline/map/layout.json"];

/**
 * The smallest map worth drawing: two structures and one hop, in a home
 * folder at `pipeline/map/`. `data.mjs` uses a shared constant and a template
 * string, which only work because the CLI imports it as a module.
 *
 * The files live in `test/fixtures/` so the binary and Nix package checks can
 * build the same map from disk.
 */
export const minimalMap: Effect.Effect<HomeFiles> = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const folder = path.join(import.meta.dirname, "fixtures");
  const files: Record<string, string> = {};

  for (const name of minimalMapFiles) {
    files[name] = yield* fs.readFileString(path.join(folder, name));
  }

  return files;
}).pipe(Effect.orDie, Effect.provide(NodeServices.layer));
