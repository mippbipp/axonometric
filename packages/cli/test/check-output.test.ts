import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect, String as Str } from "effect";

import { shapesMap } from "./fixtures.ts";
import { makeHome, runCli } from "./harness.ts";

describe("check", () => {
  it.effect(
    "warns about covered name tags and overlapping zones on the shapes map",
    () =>
      Effect.gen(function* () {
        const home = yield* makeHome(yield* shapesMap);
        const map = `${home}/shapes/map`;
        const result = yield* runCli(home, ["check", map]);

        const printed = Arr.map(
          Str.split("\n")(Str.trim(result.stdout)),
          Str.replace(`${map}: `, "")
        );

        assert.deepStrictEqual(printed, [
          'warning layout.json structures.cards: name tag is drawn on top of "store". Move one of them apart, so the tag under the front corner has room.',
          'warning layout.json structures.job: name tag is drawn on top of "document". Move one of them apart, so the tag under the front corner has room.',
          'warning layout.json: the zones of groups "people" and "core" overlap. Move one group\'s structures away from the other, for example with axonometric layout <home> <id> --x <x> --y <y>.',
          'warning layout.json: the zones of groups "core" and "outside" overlap. Move one group\'s structures away from the other, for example with axonometric layout <home> <id> --x <x> --y <y>.',
          "0 errors, 4 warnings.",
        ]);
      }),
    30_000
  );
});
