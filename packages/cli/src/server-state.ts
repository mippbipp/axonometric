import { ServerState } from "@axonometric/contracts";
import { Effect, FileSystem, Option, Schema } from "effect";

import type { HomePaths } from "./home-paths.ts";
import { processIsAlive, stateFolder } from "./lock.ts";
import { writeAll } from "./write-files.ts";

const StateFile = Schema.fromJsonString(ServerState);

const decodeState = Schema.decodeUnknownOption(StateFile);

const encodeState = Schema.encodeEffect(StateFile);

/** The state file's text, or nothing when there's no file. */
const readText = Effect.fnUntraced(function* (file: string) {
  const fs = yield* FileSystem.FileSystem;

  return yield* fs.readFileString(file).pipe(
    Effect.asSome,
    Effect.catchReason("PlatformError", "NotFound", () =>
      Effect.succeed(Option.none<string>())
    )
  );
});

/**
 * The server running for the map in the home folder, if there is one. A state file
 * that doesn't decode, or whose process has exited, counts as no server.
 */
export const runningServer = Effect.fnUntraced(function* (paths: HomePaths) {
  const text = yield* readText(paths.serverStateFile);

  return Option.filter(Option.flatMap(text, decodeState), (state) =>
    processIsAlive(state.pid)
  );
});

/**
 * Writes `state` to the state file, replacing any file a dead server left,
 * and removes it again when the scope closes, unless another server has
 * replaced it by then.
 */
export const recordServer = Effect.fnUntraced(function* (
  paths: HomePaths,
  state: ServerState
) {
  const fs = yield* FileSystem.FileSystem;
  const file = paths.serverStateFile;

  yield* stateFolder(paths);

  const content = yield* encodeState(state);

  yield* Effect.acquireRelease(writeAll([{ content, file }]), () =>
    readText(file).pipe(
      Effect.flatMap((current) =>
        Option.contains(current, content) ? fs.remove(file) : Effect.void
      ),
      Effect.ignore
    )
  );
});
