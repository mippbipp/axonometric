import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect, String as Str } from "effect";

import { pipelineMap } from "./fixtures.ts";
import { makeHome, runCli } from "./harness.ts";

describe("check on the pipeline map", () => {
  it.effect(
    "reports only the labels that have no room beside their routes",
    () =>
      Effect.gen(function* () {
        const home = yield* makeHome(yield* pipelineMap);

        const result = yield* runCli(home, [
          "check",
          `${home}/flake-pipeline/map`,
        ]);

        assert.strictEqual(result.exitCode, 0, result.stdout + result.stderr);
        assert.include(result.stdout, ": 0 errors, 3 warnings.");

        // These hops run through gaps packed with boxes and other routes,
        // so no spot beside them is clear. Their labels show on hover.
        const unplaced = Arr.filter(Str.split("\n")(result.stdout), (line) =>
          Str.includes("has no clear spot beside its route")(line)
        );

        assert.lengthOf(unplaced, 3);
      }),
    // check routes and lays out every chapter of a 29-hop map.
    30_000
  );
});
