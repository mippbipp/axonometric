import { Layout, MapData } from "@axonometric/contracts";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import { draftChecker } from "../../editor/src/draft-check.ts";
import type { DraftAnswer } from "../../editor/src/draft-check.ts";

// The add form's checker as the worker runs it, and as the page runs it where
// there are no workers, on the flake pipeline: 8 chapters, so finding a spot
// for a new name takes seconds. The page's own tests of the form are in
// add-structure-big-map.test.ts.

const decodeData = Schema.decodeUnknownEffect(
  Schema.Struct({ default: MapData })
);

const decodeLayout = Schema.decodeUnknownEffect(
  Schema.Struct({ default: Layout })
);

const pipelineState = Effect.gen(function* () {
  const folder = new URL("fixtures/flake-pipeline/map/", import.meta.url);

  const dataModule: unknown = yield* Effect.promise(
    () => import(new URL("data.mjs", folder).href)
  );
  const { default: data } = yield* decodeData(dataModule);

  const layoutModule: unknown = yield* Effect.promise(
    () =>
      import(new URL("layout.json", folder).href, {
        with: { type: "json" },
      })
  );
  const { default: layout } = yield* decodeLayout(layoutModule);

  return { data, layout };
}).pipe(Effect.orDie);

describe("the add form's checker", () => {
  it.live(
    "answers nothing more once the form stops it mid-search",
    () =>
      Effect.gen(function* () {
        const { data, layout } = yield* pipelineState;
        const answers: Array<DraftAnswer> = [];
        const checker = draftChecker((found) => {
          answers.push(found);
        });

        checker.map({ data, kind: "draft map", layout, shown: layout });
        checker.ask({
          ask: 1,
          draft: {
            group: "pewter",
            name: "Build cache",
            shape: "box",
            status: "planned",
          },
          kind: "draft ask",
          picked: null,
        });

        // Drawing the first spot tried takes seconds on this map, so the
        // search is still on it.
        yield* Effect.sleep("300 millis");
        assert.deepStrictEqual(answers, [], "nothing answered yet");
        checker.stop();

        // A whole search for a first name here took 9.4 s in Node, so a
        // search the stop missed would answer within this wait.
        yield* Effect.sleep("10 seconds");
        assert.deepStrictEqual(answers, []);
      }),
    60_000
  );
});
