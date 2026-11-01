import { palette } from "@axonometric/contracts";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Option, Path, Record as Rec } from "effect";

const stylesheet = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  return yield* fs.readFileString(
    path.join(import.meta.dirname, "..", "..", "editor", "src", "index.css")
  );
}).pipe(Effect.orDie, Effect.provide(NodeServices.layer));

describe("map colours", () => {
  it.effect(
    "matches the light-dark pairs in the editor's stylesheet",
    () =>
      Effect.gen(function* () {
        const css = yield* stylesheet;

        for (const [name, light] of Rec.toEntries(palette.light)) {
          const pair = Option.fromNullishOr(
            new RegExp(
              String.raw`--${name}:\s*light-dark\((#[0-9a-f]{6}),\s*(#[0-9a-f]{6})\)`,
              "u"
            ).exec(css)
          );

          assert.isTrue(Option.isSome(pair), `--${name} is a light-dark pair`);
          assert.strictEqual(
            Option.getOrThrow(pair)[1],
            light,
            `${name}, light`
          );
          assert.strictEqual(
            Option.getOrThrow(pair)[2],
            palette.dark[name],
            `${name}, dark`
          );
        }
      }),
    10_000
  );
});
