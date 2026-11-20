import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect, String as Str } from "effect";

import { checkMap } from "../src/index.ts";
import { fixture } from "./fixture-maps.ts";
import { layoutProblems } from "./layout-problems.ts";

const options = { linkExists: () => true };

const mentions = (messages: ReadonlyArray<string>) =>
  Arr.some(messages, Str.includes("h-secret"));

describe("checkMap's drawing warnings", () => {
  it.effect("leave out the chapter drawing findings unless asked for", () =>
    Effect.gen(function* () {
      const files = yield* fixture("crowded");
      const fast = checkMap(files, options);
      const slow = checkMap(files, { ...options, drawingWarnings: true });

      assert.isFalse(mentions(Arr.map(fast, ({ message }) => message)));
      assert.isTrue(mentions(Arr.map(slow, ({ message }) => message)));
    })
  );

  it.effect(
    "give every layout problem layoutProblems gives when asked for",
    () =>
      Effect.gen(function* () {
        const files = yield* fixture("shapes");
        const reported = checkMap(files, { ...options, drawingWarnings: true });
        const inLayout = Arr.filter(
          reported,
          ({ file }) => file === "layout.json"
        );

        assert.deepStrictEqual(
          inLayout,
          layoutProblems(files.data, files.layout)
        );
      })
  );
});
