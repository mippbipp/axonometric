import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

import { pipelineMap } from "./fixtures.ts";
import { makeHome, runCli, mapIn } from "./harness.ts";

describe("check on the pipeline map", () => {
  it.effect(
    "reports no warnings, as every played label has a clear spot",
    () =>
      Effect.gen(function* () {
        const pipelineMapFiles = yield* pipelineMap;
        const home = yield* makeHome(pipelineMapFiles);

        const result = yield* runCli(home, [
          "check",
          mapIn(home, "flake-pipeline").home,
        ]);

        assert.strictEqual(result.exitCode, 0, result.stdout + result.stderr);
        // The "gate verdict" label of h-ruleset-updater has no Plan spot in
        // chapter "c-merge", which shows the hop but doesn't play it. There it
        // is faded and unlabelled, so it doesn't warn. The chapters that
        // label it find it a spot.
        assert.include(result.stdout, ": 0 errors, 0 warnings.");
      }),
    // check routes and lays out every chapter of a 29-hop map.
    30_000
  );
});
