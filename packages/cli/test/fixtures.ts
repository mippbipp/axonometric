import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Path } from "effect";

import type { HomeFiles } from "./harness.ts";

/** Reads fixture files from `test/fixtures/`, keyed by their path there. */
const readFixtures = (names: readonly string[]): Effect.Effect<HomeFiles> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const folder = path.join(import.meta.dirname, "fixtures");
    const files: Record<string, string> = {};

    for (const name of names) {
      files[name] = yield* fs.readFileString(path.join(folder, name));
    }

    return files;
  }).pipe(Effect.orDie, Effect.provide(NodeServices.layer));

/**
 * The smallest map worth drawing: two structures and one hop, in a home
 * folder at `pipeline/map/`. `data.mjs` uses a shared constant and a template
 * string, which only work because the CLI imports it as a module.
 *
 * The files live in `test/fixtures/` so the binary and Nix package checks can
 * build the same map from disk.
 */
export const minimalMap: Effect.Effect<HomeFiles> = readFixtures([
  "pipeline/map/data.mjs",
  "pipeline/map/layout.json",
]);

/**
 * A map at `shapes/map/` with one structure of each shape, covering every
 * status, for checking how structures are drawn.
 */
export const shapesMap: Effect.Effect<HomeFiles> = readFixtures([
  "shapes/map/data.mjs",
  "shapes/map/layout.json",
]);

/**
 * A map at `review/map/` that uses every status, every optional field and
 * every kind of link: an ADR and a deep dive next to SYSTEM.md, and a URL.
 */
export const fullMap: Effect.Effect<HomeFiles> = readFixtures([
  "review/map/data.mjs",
  "review/map/layout.json",
  "review/adr/0001-local-server.md",
  "review/research/clipboard.md",
]);

/**
 * A map at `crowded/map/` that forces routing around boxes: a hop with a
 * structure in its way, a request and its reply between the same pair, and
 * a hop into a walled-in vault that can't avoid a box.
 */
export const crowdedMap: Effect.Effect<HomeFiles> = readFixtures([
  "crowded/map/data.mjs",
  "crowded/map/layout.json",
]);
