import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import {
  Array as Arr,
  Effect,
  FileSystem,
  Order,
  Record as Rec,
  String as Str,
} from "effect";

import {
  defaultSeconds,
  fileSeconds,
  splitByWeight,
  weight,
} from "./shard-sequencer.ts";

const listTestFiles = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const names = yield* fs.readDirectory(import.meta.dirname);

  return Arr.filter(names, Str.endsWith(".test.ts"));
}).pipe(Effect.provide(NodeServices.layer));

const seconds = (files: readonly string[]) =>
  Arr.reduce(files, 0, (total, file) => total + weight(file));

describe("ci shards of the cli tests", () => {
  it.effect.each([2, 3])(
    "run every test file once in %i shards, none over 60% of the time",
    (count) =>
      Effect.gen(function* () {
        const testFiles = yield* listTestFiles;
        const shards = splitByWeight(testFiles, count);

        assert.deepStrictEqual(
          Arr.sort(Arr.flatten(shards), Order.String),
          Arr.sort(testFiles, Order.String)
        );

        const total = seconds(testFiles);

        for (const shard of shards) {
          assert.isAtMost(seconds(shard) / total, 0.6);
        }
      })
  );

  it.effect("weigh only files that exist", () =>
    Effect.gen(function* () {
      const testFiles = yield* listTestFiles;

      for (const file of Rec.keys(fileSeconds)) {
        assert.include(testFiles, file);
      }

      assert.isAbove(defaultSeconds, 0);
    })
  );
});
