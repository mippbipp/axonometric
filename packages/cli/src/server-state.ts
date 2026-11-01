import { ServerState } from "@axonometric/contracts";
import { Effect, FileSystem, Option, Path, Schema } from "effect";

import { processIsAlive, stateFolder, stateFolderPath } from "./lock.ts";
import { writeAll } from "./write-files.ts";

const StateFile = Schema.fromJsonString(ServerState);

const decodeState = Schema.decodeUnknownOption(StateFile);

const encodeState = Schema.encodeEffect(StateFile);

/** Where `serve` records itself for the map in `home`. */
export const serverStateFile = Effect.fnUntraced(function* (home: string) {
  const path = yield* Path.Path;

  return path.join(yield* stateFolderPath(home), "server.json");
});

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
 * The server running for the map in `home`, if there is one. A state file
 * that doesn't decode, or whose process has exited, counts as no server.
 */
export const runningServer = Effect.fnUntraced(function* (home: string) {
  const text = yield* readText(yield* serverStateFile(home));

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
  home: string,
  state: ServerState
) {
  const fs = yield* FileSystem.FileSystem;

  yield* stateFolder(home);

  const file = yield* serverStateFile(home);
  const content = yield* encodeState(state);

  yield* Effect.acquireRelease(writeAll([{ file, content }]), () =>
    readText(file).pipe(
      Effect.flatMap((current) =>
        Option.contains(current, content) ? fs.remove(file) : Effect.void
      ),
      Effect.ignore
    )
  );
});
