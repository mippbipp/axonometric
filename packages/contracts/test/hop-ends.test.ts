import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect, Order } from "effect";

import {
  chapterStopsOf,
  edgeSpotsOf,
  fittedViewOf,
  groundProjections,
  hopEndAt,
  hopEndsOf,
  views,
} from "../src/index.ts";
import type { Scene, View } from "../src/index.ts";
import { fixture } from "./fixture-maps.ts";

const canvas = { height: 800, width: 1280 };

const fitted = Effect.fnUntraced(function* (name: string, view: View) {
  const { data, layout } = yield* fixture(name);
  const state = { data, layout, system: name };
  const chapter = Arr.lastNonEmpty(chapterStopsOf(state));
  const { scene } = fittedViewOf({ chapter, size: canvas, state, view });
  const revealed = new Set(
    Arr.map(scene.structures, ({ structure }) => structure.id)
  );

  return { layout, revealed, scene };
});

const tagOver = (scene: Scene, id: string): Scene => ({
  ...scene,
  structures: Arr.map(scene.structures, (item) =>
    item.structure.id === id
      ? {
          ...item,
          tag: {
            bottom: item.bounds.bottom + 100,
            left: item.bounds.left - 100,
            right: item.bounds.right + 100,
            top: item.bounds.top - 100,
          },
        }
      : item
  ),
});

describe("hop ends", () => {
  it.effect("have one key each, an edge handle's id", () =>
    Effect.gen(function* () {
      const { revealed, scene } = yield* fitted("review", "iso");
      const ends = hopEndsOf({ revealed, scene });
      const spots = Arr.flatMap(scene.structures, ({ structure }) =>
        edgeSpotsOf({ scene, structure: structure.id })
      );

      assert.lengthOf(
        Arr.dedupeWith(ends, (a, b) => a.key === b.key),
        ends.length
      );
      assert.deepStrictEqual(
        Arr.map(ends, ({ key }) => key),
        Arr.map(spots, ({ id }) => id)
      );
    })
  );

  for (const view of views) {
    it.effect(
      `give every revealed structure one at least in the ${view} view`,
      () =>
        Effect.gen(function* () {
          const { revealed, scene } = yield* fitted("crowded", view);
          const owners = new Set(
            Arr.map(hopEndsOf({ revealed, scene }), ({ owner }) => owner)
          );

          assert.deepStrictEqual(
            Arr.sort([...owners], Order.String),
            Arr.sort([...revealed], Order.String)
          );
        })
    );
  }

  it.effect(
    "are one centre hop end for a structure with no room on any side",
    () =>
      Effect.gen(function* () {
        const { layout, revealed, scene } = yield* fitted("review", "plan");
        const [first] = scene.structures;

        assert.isDefined(first);

        const { id } = first.structure;
        const covered = tagOver(scene, id);
        const at = layout.structures[id];

        assert.deepStrictEqual(
          edgeSpotsOf({ scene: covered, structure: id }),
          []
        );
        assert.isDefined(at);

        const ground = { x: at.x + at.w / 2, y: at.y + at.d / 2 };

        assert.deepStrictEqual(
          Arr.filter(
            hopEndsOf({ revealed, scene: covered }),
            ({ owner }) => owner === id
          ),
          [
            {
              at: groundProjections.plan.toScreen(ground),
              ground,
              key: `${id}:centre`,
              owner: id,
              side: "centre",
            },
          ]
        );
      })
  );

  it.effect("are none for a structure not revealed", () =>
    Effect.gen(function* () {
      const { revealed, scene } = yield* fitted("review", "iso");
      const [hidden] = revealed;

      assert.isDefined(hidden);

      const shown = new Set(Arr.filter([...revealed], (id) => id !== hidden));

      assert.isFalse(
        Arr.some(
          hopEndsOf({ revealed: shown, scene }),
          ({ owner }) => owner === hidden
        )
      );
    })
  );
});

describe("the hop end a drop lands on", () => {
  for (const view of views) {
    it.effect(
      `is the nearest of the structure's, however far from it, in the ${view} view`,
      () =>
        Effect.gen(function* () {
          const { layout, revealed, scene } = yield* fitted("review", view);
          const ends = hopEndsOf({ revealed, scene });
          const placements = layout.structures;
          const [from, to] = [...revealed];

          assert.isDefined(from);
          assert.isDefined(to);

          const box = placements[to];

          assert.isDefined(box);

          const point = { x: box.x + box.w / 4, y: box.y + box.d / 4 };
          const { sx, sy } = groundProjections[view].toScreen(point);
          const distance = (end: (typeof ends)[number]) =>
            Math.hypot(end.at.sx - sx, end.at.sy - sy);
          const own = Arr.filter(ends, ({ owner }) => owner === to);
          const nearest = Arr.reduce(own, own[0], (best, end) =>
            best === undefined || distance(end) < distance(best) ? end : best
          );

          assert.strictEqual(
            hopEndAt({
              ends,
              except: from,
              placements,
              point,
              revealed,
              view,
            }),
            nearest
          );
        })
    );
  }

  it.effect("is never on the structure it starts from", () =>
    Effect.gen(function* () {
      const { layout, revealed, scene } = yield* fitted("review", "iso");
      const ends = hopEndsOf({ revealed, scene });
      const placements = layout.structures;
      const [from] = [...revealed];

      assert.isDefined(from);

      const box = placements[from];

      assert.isDefined(box);

      const point = { x: box.x + box.w / 2, y: box.y + box.d / 2 };
      const end = hopEndAt({
        ends,
        except: from,
        placements,
        point,
        revealed,
        view: "iso",
      });

      assert.notStrictEqual(end?.owner, from);
    })
  );

  it.effect("is none over empty ground", () =>
    Effect.gen(function* () {
      const { layout, revealed, scene } = yield* fitted("review", "plan");
      const [from] = [...revealed];

      assert.isDefined(from);
      assert.isNull(
        hopEndAt({
          ends: hopEndsOf({ revealed, scene }),
          except: from,
          placements: layout.structures,
          point: { x: -1000, y: -1000 },
          revealed,
          view: "plan",
        })
      );
    })
  );
});
