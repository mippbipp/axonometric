import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

import { pipelineMap } from "./fixtures.ts";
import { makeHome, runCli, mapIn } from "./harness.ts";

describe("check on the pipeline map", () => {
  it.effect(
    "reports only the Plan label of the gate verdict, which has no clear spot",
    () =>
      Effect.gen(function* () {
        const pipelineMapFiles = yield* pipelineMap;
        const home = yield* makeHome(pipelineMapFiles);

        const result = yield* runCli(home, [
          "check",
          mapIn(home, "flake-pipeline").home,
        ]);

        assert.strictEqual(result.exitCode, 0, result.stdout + result.stderr);
        // The saved layout is the one the routing tests in contracts pin
        // down. Every move of its structures that frees the label of
        // "gate verdict" adds a bend those tests reject, and a shorter
        // label would no longer say what the hop carries. A layout that
        // `build` places itself has no warnings: see build-places.test.ts.
        assert.include(result.stdout, ": 0 errors, 1 warning.");
        assert.include(result.stdout, 'the label of hop "h-ruleset-updater"');
        assert.include(result.stdout, 'in chapter "c-merge" in Plan view');
      }),
    // check routes and lays out every chapter of a 29-hop map.
    30_000
  );
});
