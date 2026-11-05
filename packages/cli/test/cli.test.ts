import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

import packageJson from "../package.json" with { type: "json" };
import { makeHome, runCli } from "./harness.ts";

describe("axonometric", () => {
  it.effect("--version prints the package version", () =>
    Effect.gen(function* () {
      const home = yield* makeHome({});

      const result = yield* runCli(home, ["--version"]);

      assert.strictEqual(result.exitCode, 0);
      assert.strictEqual(
        result.stdout,
        `axonometric v${packageJson.version}\n`
      );
      assert.strictEqual(result.stderr, "");
      assert.deepStrictEqual(result.files, {});
    })
  );

  it.effect("--help prints usage and the version flag", () =>
    Effect.gen(function* () {
      const home = yield* makeHome({});

      const result = yield* runCli(home, ["--help"]);

      assert.strictEqual(result.exitCode, 0);
      assert.include(result.stdout, "USAGE\n  axonometric");
      assert.include(result.stdout, "--version");
      assert.strictEqual(result.stderr, "");
    })
  );

  it.effect("an unknown flag fails with exit code 1", () =>
    Effect.gen(function* () {
      const home = yield* makeHome({});

      const result = yield* runCli(home, ["--no-such-flag"]);

      assert.strictEqual(result.exitCode, 1);
      assert.include(result.stderr, "Unrecognized flag: --no-such-flag");
    })
  );
});
