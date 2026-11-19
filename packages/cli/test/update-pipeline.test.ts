import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

import { updatePipelineMap } from "./fixtures.ts";
import { makeHome, runCli } from "./harness.ts";

describe("the update pipeline map", () => {
  it.effect(
    "is placed by build, and check finds no errors in that layout",
    () =>
      Effect.gen(function* () {
        const updatePipelineMap_1 = yield* updatePipelineMap;
        const home = yield* makeHome(updatePipelineMap_1);
        const map = `${home}/update-pipeline/map`;

        const built = yield* runCli(home, ["build", map]);

        assert.strictEqual(built.exitCode, 0, built.stdout + built.stderr);
        assert.isString(built.files["update-pipeline/map/layout.json"]);

        const checked = yield* runCli(home, ["check", map]);

        assert.strictEqual(checked.exitCode, 0, checked.stdout);
        assert.match(checked.stdout, /: 0 errors, \d+ warnings?\.$/mu);
      }),
    // build and check route and lay out every chapter of a 27-hop map.
    60_000
  );
});
