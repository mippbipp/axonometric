import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect, Order } from "effect";

import {
  chapterStopsOf,
  edgeSpotsOf,
  fittedViewOf,
  groundProjections,
  hopPortAt,
  hopPortsOf,
  views,
} from "../src/index.ts";
import type { Scene, View } from "../src/index.ts";
import { fixture } from "./fixture-maps.ts";

const canvas = { height: 800, width: 1280 };

const fitted = (name: string, view: View) =>
  Effect.gen(function* () {
    const { data, layout } = yield* fixture(name);
    const state = { data, layout, system: name };
    const chapter = Arr.lastNonEmpty(chapterStopsOf(state));
    const { scene } = fittedViewOf({ chapter, size: canvas, state, view });
    const revealed = new Set(
      Arr.map(scene.structures, ({ structure }) => structure.id)
    );

    return { layout, revealed, scene };
  });

/** `scene` with structure `id`'s name tag grown over its whole outline. */
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

describe("hop ports", () => {
  it.effect("have one key each, an edge handle's id", () =>
    Effect.gen(function* () {
      const { revealed, scene } = yield* fitted("review", "iso");
      const ports = hopPortsOf({ revealed, scene });
      const spots = Arr.flatMap(scene.structures, ({ structure }) =>
        edgeSpotsOf({ scene, structure: structure.id })
      );

      assert.lengthOf(
        Arr.dedupeWith(ports, (a, b) => a.key === b.key),
        ports.length
      );
      assert.deepStrictEqual(
        Arr.map(ports, ({ key }) => key),
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
            Arr.map(hopPortsOf({ revealed, scene }), ({ owner }) => owner)
          );

          assert.deepStrictEqual(
            Arr.sort([...owners], Order.String),
            Arr.sort([...revealed], Order.String)
          );
        })
    );
  }

  it.effect(
    "are one centre port for a structure with no room on any side",
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
            hopPortsOf({ revealed, scene: covered }),
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
          hopPortsOf({ revealed: shown, scene }),
          ({ owner }) => owner === hidden
        )
      );
    })
  );
});

describe("the port a drop lands on", () => {
  for (const view of views) {
    it.effect(
      `is the nearest of the structure's, however far from it, in the ${view} view`,
      () =>
        Effect.gen(function* () {
          const { layout, revealed, scene } = yield* fitted("review", view);
          const ports = hopPortsOf({ revealed, scene });
          const placements = layout.structures;
          const [from, to] = [...revealed];

          assert.isDefined(from);
          assert.isDefined(to);

          const box = placements[to];

          assert.isDefined(box);

          // A quarter in from the north-west corner: far from every handle.
          const point = { x: box.x + box.w / 4, y: box.y + box.d / 4 };
          const { sx, sy } = groundProjections[view].toScreen(point);
          const distance = (port: (typeof ports)[number]) =>
            Math.hypot(port.at.sx - sx, port.at.sy - sy);
          const own = Arr.filter(ports, ({ owner }) => owner === to);
          const nearest = Arr.reduce(own, own[0], (best, port) =>
            best === undefined || distance(port) < distance(best) ? port : best
          );

          assert.strictEqual(
            hopPortAt({
              except: from,
              placements,
              point,
              ports,
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
      const ports = hopPortsOf({ revealed, scene });
      const placements = layout.structures;
      const [from] = [...revealed];

      assert.isDefined(from);

      const box = placements[from];

      assert.isDefined(box);

      const point = { x: box.x + box.w / 2, y: box.y + box.d / 2 };
      const port = hopPortAt({
        except: from,
        placements,
        point,
        ports,
        revealed,
        view: "iso",
      });

      assert.notStrictEqual(port?.owner, from);
    })
  );

  it.effect("is none over empty ground", () =>
    Effect.gen(function* () {
      const { layout, revealed, scene } = yield* fitted("review", "plan");
      const [from] = [...revealed];

      assert.isDefined(from);
      assert.isNull(
        hopPortAt({
          except: from,
          placements: layout.structures,
          point: { x: -1000, y: -1000 },
          ports: hopPortsOf({ revealed, scene }),
          revealed,
          view: "plan",
        })
      );
    })
  );
});
