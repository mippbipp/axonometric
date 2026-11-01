import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

// The editor has no test runner of its own; its pure modules are tested here.
import { fitOf } from "../../editor/src/fit.ts";

const box = (id: string, sx: number, sy: number) => ({
  ids: [id],
  points: [
    { sx, sy },
    { sx: sx + 10, sy: sy + 10 },
  ],
});

const drawn = [
  box("a", 0, 0),
  box("b", 100, 0),
  box("c", 0, 200),
  { ids: ["a", "b"], points: [{ sx: 50, sy: -40 }] },
  { ids: ["b", "c"], points: [{ sx: 300, sy: 300 }] },
];

describe("what the iso view fits to the window", () => {
  it.effect("fits everything when fitTo is left out", () =>
    Effect.sync(() => {
      assert.deepStrictEqual(fitOf({ drawn }).bounds, {
        minX: 0,
        minY: -40,
        maxX: 300,
        maxY: 300,
      });
    })
  );

  it.effect("fits only the structures in fitTo, and hops between them", () =>
    Effect.sync(() => {
      assert.deepStrictEqual(fitOf({ drawn, fitTo: ["a", "b"] }).bounds, {
        minX: 0,
        minY: -40,
        maxX: 110,
        maxY: 10,
      });
    })
  );

  it.effect("fits nothing when fitTo is empty", () =>
    Effect.sync(() => {
      assert.isUndefined(fitOf({ drawn, fitTo: [] }).bounds);
    })
  );

  it.effect(
    "keys the fit by the set of ids, not their order or the geometry",
    () =>
      Effect.sync(() => {
        const moved = [box("a", 500, 500), ...drawn.slice(1)];

        assert.strictEqual(
          fitOf({ drawn, fitTo: ["b", "a"] }).key,
          fitOf({ drawn: moved, fitTo: ["a", "b", "a"] }).key
        );
        assert.strictEqual(fitOf({ drawn }).key, fitOf({ drawn: moved }).key);
        assert.notStrictEqual(
          fitOf({ drawn, fitTo: ["a", "b"] }).key,
          fitOf({ drawn, fitTo: ["a", "b", "c"] }).key
        );
        assert.notStrictEqual(
          fitOf({ drawn, fitTo: ["a", "b", "c"] }).key,
          fitOf({ drawn }).key
        );
      })
  );
});
