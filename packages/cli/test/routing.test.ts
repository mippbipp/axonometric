import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

import { crowdedMap } from "./fixtures.ts";
import { makeHome, runCli } from "./harness.ts";

describe("routing", () => {
  it.effect("check warns about the crowded map's hop under a box", () =>
    Effect.gen(function* () {
      const home = yield* makeHome(yield* crowdedMap);
      const result = yield* runCli(home, ["check", `${home}/crowded/map`]);

      assert.strictEqual(result.exitCode, 0, result.stdout + result.stderr);
      assert.include(result.stdout, ": 0 errors, 1 warning.");
      assert.include(
        result.stdout,
        'warning layout.json routes["h-secret"]: hop "h-secret" from "api" to "vault" runs under "west": no clear route goes around it. Move the structures apart to open a gap, or write a route override.'
      );
    })
  );
});
