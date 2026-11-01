// oxlint-disable-next-line effecttsgo/node-builtin-import -- see noGit
import { spawnSync } from "node:child_process";

import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Path } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { makeHome, runCli } from "./harness.ts";

/** Runs git in `cwd` and returns its exit code. */
const git = Effect.fnUntraced(function* (cwd: string, args: readonly string[]) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  return yield* spawner.exitCode(ChildProcess.make("git", args, { cwd }));
}, Effect.provide(NodeServices.layer));

/**
 * The .scratch tests need a real git repo, so they skip without git. Vitest
 * decides skips before any test runs, so this check is synchronous.
 */
// oxlint-disable-next-line node/no-sync -- see above
const noGit = spawnSync("git", ["--version"]).error !== undefined;

describe("init", () => {
  it.effect(
    "writes a starter map that builds and checks with no problems",
    () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const home = yield* makeHome({});
        const map = path.join(home, "docs", "pipeline", "map");
        const result = yield* runCli(home, ["init", map]);

        assert.strictEqual(result.exitCode, 0, result.stderr);
        assert.isString(result.files["docs/pipeline/map/data.mjs"]);
        assert.isUndefined(result.files["docs/pipeline/map/layout.json"]);
        assert.include(result.stdout, `Wrote ${path.join(map, "data.mjs")}.`);
        assert.include(result.stdout, "axonometric build");

        const checked = yield* runCli(home, ["check", map]);

        assert.strictEqual(checked.exitCode, 0, checked.stdout);
        assert.include(checked.stdout, ": 0 errors, 0 warnings.");

        const built = yield* runCli(home, ["build", map]);

        assert.strictEqual(built.exitCode, 0, built.stderr);
        assert.strictEqual(built.stderr, "");
        assert.isString(built.files["docs/pipeline/SYSTEM.md"]);
        assert.isString(built.files["docs/pipeline/pipeline.html"]);
        assert.isString(built.files["docs/pipeline/map/layout.json"]);

        const rechecked = yield* runCli(home, ["check", map]);

        assert.include(rechecked.stdout, ": 0 errors, 0 warnings.");
      }).pipe(Effect.provide(NodeServices.layer))
  );

  it.effect("keeps .axonometric out of git with its own .gitignore", () =>
    Effect.gen(function* () {
      const home = yield* makeHome({});
      const map = `${home}/pipeline/map`;

      yield* runCli(home, ["init", map]);

      const built = yield* runCli(home, ["build", map]);

      assert.strictEqual(
        built.files["pipeline/map/.axonometric/.gitignore"],
        "*\n"
      );
    })
  );

  it.effect("refuses to overwrite an existing map", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;

      const home = yield* makeHome({
        "pipeline/map/data.mjs": "export default { mine: true };\n",
      });

      const map = path.join(home, "pipeline", "map");
      const result = yield* runCli(home, ["init", map]);

      assert.strictEqual(result.exitCode, 1);
      assert.include(
        result.stderr,
        `${path.join(map, "data.mjs")} already exists. init never overwrites a map; edit it, or pick another home folder.`
      );
      assert.strictEqual(
        result.files["pipeline/map/data.mjs"],
        "export default { mine: true };\n"
      );
    }).pipe(Effect.provide(NodeServices.layer))
  );

  it.effect.skipIf(noGit)(
    "warns when a .scratch home isn't ignored by git",
    () =>
      Effect.gen(function* () {
        const home = yield* makeHome({});

        yield* git(home, ["init", "--quiet"]);

        const path = yield* Path.Path;
        const map = path.join(home, ".scratch", "pipeline", "map");
        const result = yield* runCli(home, ["init", map]);

        assert.strictEqual(result.exitCode, 0, result.stderr);
        assert.include(
          result.stderr,
          `warning: ${map} is under a .scratch/ folder that git doesn't ignore, so the map would be committed. Add .scratch/ to the repo's .gitignore.`
        );
      }).pipe(Effect.provide(NodeServices.layer))
  );

  it.effect.skipIf(noGit)(
    "doesn't warn when git ignores the .scratch folder",
    () =>
      Effect.gen(function* () {
        const home = yield* makeHome({ ".gitignore": ".scratch/\n" });

        yield* git(home, ["init", "--quiet"]);

        const result = yield* runCli(home, [
          "init",
          `${home}/.scratch/pipeline/map`,
        ]);

        assert.strictEqual(result.exitCode, 0, result.stderr);
        assert.strictEqual(result.stderr, "");
      })
  );
});
