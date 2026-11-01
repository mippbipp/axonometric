import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect, String as Str } from "effect";

import {
  crowdedMap,
  fullMap,
  minimalMap,
  pipelineMap,
  shapesMap,
} from "./fixtures.ts";
import type { HomeFiles } from "./harness.ts";
import { makeHome, runCli } from "./harness.ts";

// Text sizing must not change what `check` says: it measures at full size.
// The expected output is what `check` printed on main, before text was
// placed at its drawn size.

const clean = ["0 errors, 0 warnings."];

const expected: readonly {
  readonly system: string;
  readonly files: Effect.Effect<HomeFiles>;
  readonly lines: readonly string[];
}[] = [
  { system: "review", files: fullMap, lines: clean },
  { system: "flake-pipeline", files: pipelineMap, lines: clean },
  { system: "pipeline", files: minimalMap, lines: clean },
  {
    system: "crowded",
    files: crowdedMap,
    lines: [
      'warning layout.json routes["h-secret"]: hop "h-secret" from "api" to "vault" runs under "west": no clear route goes around it. Move the structures apart to open a gap, or write a route override.',
      "0 errors, 1 warning.",
    ],
  },
  {
    system: "shapes",
    files: shapesMap,
    lines: [
      'warning layout.json structures.cards: name tag is drawn on top of "store". Move one of them apart, so the tag under the front corner has room.',
      'warning layout.json structures.job: name tag is drawn on top of "document". Move one of them apart, so the tag under the front corner has room.',
      'warning layout.json: the zones of groups "people" and "core" overlap. Move one group\'s structures away from the other, for example with axonometric layout <home> <id> --x <x> --y <y>.',
      'warning layout.json: the zones of groups "core" and "outside" overlap. Move one group\'s structures away from the other, for example with axonometric layout <home> <id> --x <x> --y <y>.',
      "0 errors, 4 warnings.",
    ],
  },
];

describe("check", () => {
  for (const { system, files, lines } of expected) {
    it.effect(
      `prints on the ${system} map what it printed before text was sized`,
      () =>
        Effect.gen(function* () {
          const home = yield* makeHome(yield* files);
          const map = `${home}/${system}/map`;
          const result = yield* runCli(home, ["check", map]);

          const printed = Arr.map(
            Str.split("\n")(Str.trim(result.stdout)),
            Str.replace(`${map}: `, "")
          );

          assert.deepStrictEqual(printed, lines);
        }),
      30_000
    );
  }
});
