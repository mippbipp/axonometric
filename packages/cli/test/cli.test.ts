import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

import { makeHome, runCli } from "./harness.ts";

describe("axonometric", () => {
  it.effect("--version prints the package version", () =>
    Effect.gen(function* () {
      const home = yield* makeHome({});

      const result = yield* runCli(home, ["--version"]);

      assert.strictEqual(result.exitCode, 0);
      assert.strictEqual(result.stdout, "axonometric v0.0.0\n");
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

  it.effect("leaves files in the home folder alone", () =>
    Effect.gen(function* () {
      const home = yield* makeHome({ "map/data.mjs": "export default {};\n" });

      const result = yield* runCli(home, ["--version"]);

      assert.deepStrictEqual(result.files, {
        "map/data.mjs": "export default {};\n",
      });
    })
  );
});
