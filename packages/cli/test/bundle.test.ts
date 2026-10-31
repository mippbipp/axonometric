import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Path, Stream, String as Str } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { makeHome } from "./harness.ts";

// Runs `node dist/bin.mjs` from the home folder, so the bundle can't find
// anything relative to the working directory. `pnpm test` builds the bundle
// first.
const runBundle = Effect.fnUntraced(function* (
  home: string,
  args: readonly string[]
) {
  const path = yield* Path.Path;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const bundle = path.join(import.meta.dirname, "..", "dist", "bin.mjs");

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
});
