import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Path } from "effect";

import { subcommandsIn } from "./docs-text.ts";
import { makeHome, runCli } from "./harness.ts";

// `--help` is what an agent reads to learn a command. Its flags and arguments
// come out in the order the command's definition lists them, so reordering a
// definition changes what the agent reads. Each subcommand's help is pinned in
// test/help/<name>.txt. After a deliberate change, regenerate the files with
// `node dist/bin.mjs <name> --help > test/help/<name>.txt` and read the diff.

const subcommands = [
  "init",
  "build",
  "check",
  "layout",
  "export",
  "serve",
  "status",
  "review",
  "verdict",
  "commit",
  "docs",
];

const pinned = (name: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    return yield* fs.readFileString(
      path.join(import.meta.dirname, "help", `${name}.txt`)
    );
  }).pipe(Effect.provide(NodeServices.layer));

describe("--help", () => {
  it.effect("has a pinned text for every subcommand the CLI has", () =>
    Effect.gen(function* () {
      const home = yield* makeHome({});
      const root = yield* runCli(home, ["--help"]);

      assert.deepStrictEqual(subcommandsIn(root.stdout), subcommands);
    })
  );

  for (const name of subcommands) {
    it.effect(`${name} prints its flags in the written order`, () =>
      Effect.gen(function* () {
        const home = yield* makeHome({});
        const result = yield* runCli(home, [name, "--help"]);

        assert.strictEqual(result.exitCode, 0);
        assert.strictEqual(result.stderr, "");
        const expected = yield* pinned(name);

        assert.strictEqual(result.stdout, expected);
      })
    );
  }
});
