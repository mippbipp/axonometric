import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect } from "effect";

import { spotAnswer, spotCasesOf, spotFixtures } from "./default-spot-cases.ts";
import recorded from "./default-spots.json" with { type: "json" };

// The search reuses each chapter's drawing across every spot it tries and
// every map it is asked about. default-spots.json holds the answers of the
// search before it did, on 022ffd9, which drew every chapter of every spot.

describe("the default spot for a new structure, on every fixture map", () => {
  for (const name of spotFixtures) {
    it.effect(
      `is the spot and the warnings the full check found, on ${name}`,
      () =>
        Effect.gen(function* () {
          const { cases, map } = yield* spotCasesOf(name);
          const answers = Arr.map(cases, (asked) => spotAnswer(map, asked));

          assert.deepStrictEqual(answers, recorded[name]);
        })
    );
  }
});
