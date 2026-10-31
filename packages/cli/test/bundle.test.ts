import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Path, Stream, String as Str } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { minimalMap } from "./fixtures.ts";
import { makeHome } from "./harness.ts";

// Copies the built bundle into the temporary home folder and runs the copy
// there. The home folder sits outside the repo, so no node_modules is in
// reach and the run fails unless the bundle is self-contained. `pnpm test`
// builds the bundle first.
const runBundle = Effect.fnUntraced(function* (
  home: string,
  args: readonly string[]
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const built = path.join(import.meta.dirname, "..", "dist", "bin.mjs");
  const bundle = path.join(home, "bin.mjs");

  yield* fs.copyFile(built, bundle);

  const command = ChildProcess.make(process.execPath, [bundle, ...args], {
    cwd: home,
  });

  const handle = yield* spawner.spawn(command);

  const [stdout, stderr, exitCode] = yield* Effect.all(
    [
      Stream.mkString(Stream.decodeText(handle.stdout)),
      Stream.mkString(Stream.decodeText(handle.stderr)),
      handle.exitCode,
    ],
    { concurrency: "unbounded" }
  );

  return { exitCode: Number(exitCode), stdout, stderr };
}, Effect.provide(NodeServices.layer));

describe("the built bundle", () => {
  it.effect("--version prints the package version", () =>
    Effect.gen(function* () {
      const home = yield* makeHome({});

      const result = yield* runBundle(home, ["--version"]);

      assert.strictEqual(result.exitCode, 0);
      assert.strictEqual(Str.trim(result.stdout), "axonometric v0.0.0");
    })
  );

  it.effect("--help prints usage", () =>
    Effect.gen(function* () {
      const home = yield* makeHome({});

      const result = yield* runBundle(home, ["--help"]);

      assert.strictEqual(result.exitCode, 0);
      assert.include(result.stdout, "axonometric");
      assert.include(result.stdout, "--version");
    })
  );

  it.effect(
    "build writes SYSTEM.md and the page with the editor embedded",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const home = yield* makeHome(yield* minimalMap);

        const result = yield* runBundle(home, ["build", "pipeline/map"]);

        const page = yield* fs.readFileString(
          path.join(home, "pipeline", "pipeline.html")
        );

        const systemMd = yield* fs.readFileString(
          path.join(home, "pipeline", "SYSTEM.md")
        );

        assert.strictEqual(result.exitCode, 0, result.stderr);
        assert.include(systemMd, "| `gate` | Build gate |");
        assert.include(page, 'id="axonometric-map-state"');
        assert.include(page, '<div id="root"></div>');
      }).pipe(Effect.provide(NodeServices.layer))
  );
});
