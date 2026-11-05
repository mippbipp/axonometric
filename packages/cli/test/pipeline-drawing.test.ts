import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

import { pipelineMap } from "./fixtures.ts";
import { makeHome, runCli } from "./harness.ts";

describe("check on the pipeline map", () => {
  it.effect(
    "reports no warnings",
    () =>
      Effect.gen(function* () {
        const home = yield* makeHome(yield* pipelineMap);

        const result = yield* runCli(home, [
          "check",
          `${home}/flake-pipeline/map`,
        ]);

        assert.strictEqual(result.exitCode, 0, result.stdout + result.stderr);
        assert.include(result.stdout, ": 0 errors, 0 warnings.");
      }),
    // check routes and lays out every chapter of a 29-hop map.
    30_000
  );
});
