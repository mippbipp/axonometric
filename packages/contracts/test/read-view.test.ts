import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect } from "effect";

import { chapterStopsOf, fittedViewOf, viewReadOf } from "../src/index.ts";
import type { Camera, View, ViewBox } from "../src/index.ts";
import { fixture } from "./fixture-maps.ts";

const canvas = { height: 800, width: 1280 };

const readAt = Effect.fnUntraced(function* (
  view: View,
  move: (camera: Camera) => Camera = (c) => c
) {
  const { data, layout } = yield* fixture("flake-pipeline");
  const state = { data, layout, system: "flake-pipeline" };
  const stops = chapterStopsOf(state);
  const stop = Arr.lastNonEmpty(stops);
  const fitted = fittedViewOf({ chapter: stop, size: canvas, state, view });
  const camera = move(fitted.camera);

  const read = viewReadOf({
    chapter: stop,
    inside: null,
    multiSelection: new Set(["b", "a"]),
    pinned: null,
    scene: fitted.scene,
    spotlight: null,
    toScreen: ({ x, y }) => ({
      x: x * camera.zoom + camera.x,
      y: y * camera.zoom + camera.y,
    }),
    view,
  });

  return { camera, read, stop };
});

const width = ({ left, right }: ViewBox) => right - left;
const height = ({ bottom, top }: ViewBox) => bottom - top;

const touches = (a: ViewBox, b: ViewBox) =>
  a.left <= b.right &&
  b.left <= a.right &&
  a.top <= b.bottom &&
  b.top <= a.bottom;

describe("reading the view", () => {
  for (const view of ["iso", "plan"] as const) {
    it.effect(`has a box for each revealed structure in the ${view} view`, () =>
      Effect.gen(function* () {
        const { read, stop } = yield* readAt(view);

        assert.sameMembers(
          Arr.map(read.structures, ({ id }) => id),
          [...stop.revealed]
        );

        for (const { box } of read.structures) {
          assert.isAbove(width(box), 0);
          assert.isAbove(height(box), 0);
        }

        assert.strictEqual(read.view, view);
        assert.strictEqual(read.chapter.id, stop.id);
      })
    );

    it.effect(`reaches both ends of each hop in the ${view} view`, () =>
      Effect.gen(function* () {
        const { read } = yield* readAt(view);
        const byId = new Map(
          Arr.map(read.structures, (one) => [one.id, one.box] as const)
        );

        assert.isNotEmpty(read.hops);

        for (const { box, from, id, to } of read.hops) {
          const source = byId.get(from);
          const target = byId.get(to);

          assert.isDefined(source, `${id} starts at a drawn structure`);
          assert.isDefined(target, `${id} ends at a drawn structure`);

          if (source !== undefined && target !== undefined) {
            assert.isTrue(touches(box, source), `${id} to ${from}`);
            assert.isTrue(touches(box, target), `${id} to ${to}`);
          }
        }
      })
    );
  }

  it.effect("scales a box with the zoom and moves it with the pan", () =>
    Effect.gen(function* () {
      const before = yield* readAt("iso");

      const after = yield* readAt("iso", (camera) => ({
        x: camera.x + 30,
        y: camera.y - 20,
        zoom: camera.zoom * 2,
      }));

      Arr.forEach(before.read.structures, (one, index) => {
        const two = after.read.structures[index]?.box;

        assert.isDefined(two);

        if (two !== undefined) {
          assert.closeTo(width(two), width(one.box) * 2, 1e-6);
          assert.closeTo(height(two), height(one.box) * 2, 1e-6);
        }
      });

      const panned = yield* readAt("iso", (camera) => ({
        ...camera,
        x: camera.x + 30,
        y: camera.y - 20,
      }));

      Arr.forEach(before.read.structures, (one, index) => {
        const two = panned.read.structures[index]?.box;

        assert.isDefined(two);

        if (two !== undefined) {
          assert.closeTo(two.left - one.box.left, 30, 1e-6);
          assert.closeTo(two.top - one.box.top, -20, 1e-6);
          assert.closeTo(width(two), width(one.box), 1e-6);
        }
      });
    })
  );

  it.effect("draws the same layout in different boxes in each view", () =>
    Effect.gen(function* () {
      const iso = yield* readAt("iso");
      const plan = yield* readAt("plan");
      const first = (read: typeof iso.read) => read.structures[0];

      assert.notDeepEqual(first(iso.read)?.box, first(plan.read)?.box);
    })
  );

  it.effect("lists the multi-selection sorted and keeps a null spotlight", () =>
    Effect.gen(function* () {
      const { read } = yield* readAt("plan");

      assert.deepStrictEqual(read.multiSelection, ["a", "b"]);
      assert.isNull(read.spotlight);
      assert.isNull(read.pinned);
      assert.isNull(read.inside);
    })
  );
});
