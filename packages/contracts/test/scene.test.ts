import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect, Record as Rec, Schema } from "effect";

import {
  arrowheadOf,
  arrowLength,
  corners,
  endsOnTarget,
  Layout,
  MapData,
  routeHops,
  sceneClashes,
  sceneOf,
} from "../src/index.ts";
import type { Placement, ScreenPoint } from "../src/index.ts";

/** A fixture map from the CLI's test fixtures, decoded. */
const fixture = (name: string) =>
  Effect.gen(function* () {
    const folder = new URL(
      `../../cli/test/fixtures/${name}/map/`,
      import.meta.url
    );

    const module: unknown = yield* Effect.promise(
      () => import(new URL("data.mjs", folder).href)
    );

    const layoutModule: unknown = yield* Effect.promise(
      () =>
        import(new URL("layout.json", folder).href, { with: { type: "json" } })
    );

    const data = yield* Schema.decodeUnknownEffect(
      Schema.Struct({ default: MapData })
    )(module);

    const layout: Layout = yield* Schema.decodeUnknownEffect(
      Schema.Struct({ default: Layout })
    )(layoutModule).pipe(Effect.map(({ default: value }) => value));

    return { data: data.default, layout };
  }).pipe(Effect.orDie);

/** What each chapter shows: its reveals and every earlier chapter's. */
const chaptersOf = (data: MapData) =>
  Arr.map(data.chapters, (chapter, index) => ({
    id: chapter.id,
    plays: chapter.plays,
    revealed: new Set(
      Arr.flatMap(data.chapters.slice(0, index + 1), ({ reveals }) => reveals)
    ),
  }));

const placementOf = (layout: Layout, id: string): Placement => {
  const placement = layout.structures[id];

  assert.isDefined(placement, `${id} has no placement`);

  return placement;
};

const distance = (a: ScreenPoint, b: ScreenPoint) =>
  Math.hypot(a.sx - b.sx, a.sy - b.sy);

/** How far a point sits from the segment between `a` and `b`. */
const offSegment = (point: ScreenPoint, a: ScreenPoint, b: ScreenPoint) => {
  const length = distance(a, b);

  const across =
    ((b.sx - a.sx) * (a.sy - point.sy) - (a.sx - point.sx) * (b.sy - a.sy)) /
    length;

  return Math.abs(across);
};

describe("scene", () => {
  for (const name of ["flake-pipeline", "review", "crowded"]) {
    it.effect(`draws nothing over anything in any chapter of ${name}`, () =>
      Effect.gen(function* () {
        const { data, layout } = yield* fixture(name);
        const routes = routeHops(data, layout);

        for (const chapter of chaptersOf(data)) {
          const scene = sceneOf({
            data,
            layout,
            revealed: chapter.revealed,
            routes,
            labelFirst: chapter.plays,
          });

          // The crowded map walls the vault in on purpose, so its only
          // allowed clashes are the walls' boxes over the vault's.
          const clashes = Arr.filter(
            sceneClashes(scene),
            ({ between }) => !(name === "crowded" && between[1] === "box:vault")
          );

          assert.deepStrictEqual(clashes, [], `in chapter ${chapter.id}`);
        }
      })
    );
  }

  it.effect(
    "puts every arrowhead's tip on its target's outline and its base on the last leg",
    () =>
      Effect.gen(function* () {
        const { data, layout } = yield* fixture("flake-pipeline");

        const scene = sceneOf({
          data,
          layout,
          revealed: new Set(Arr.map(data.structures, ({ id }) => id)),
        });

        assert.lengthOf(scene.hops, data.hops.length);

        for (const hop of scene.hops) {
          const head = arrowheadOf(hop.points);
          const before = hop.points.at(-2);

          assert.isDefined(head);
          assert.isDefined(before);
          assert.isTrue(
            endsOnTarget(hop, placementOf(layout, hop.hop.to)),
            `${hop.hop.id} ends off its target`
          );
          assert.isBelow(offSegment(head.base, before, head.tip), 1e-6);
          assert.closeTo(distance(head.base, head.tip), arrowLength, 1e-6);
        }
      })
  );

  it.effect("starts every route on its source's ground outline", () =>
    Effect.gen(function* () {
      const { data, layout } = yield* fixture("flake-pipeline");

      const scene = sceneOf({
        data,
        layout,
        revealed: new Set(Arr.map(data.structures, ({ id }) => id)),
      });

      for (const hop of scene.hops) {
        const { back, right, front, left } = corners(
          placementOf(layout, hop.hop.from),
          0
        );

        const [start] = hop.points;

        assert.isDefined(start);

        const edges = [
          [back, right],
          [right, front],
          [front, left],
          [left, back],
        ] as const;

        assert.isBelow(
          Math.min(...Arr.map(edges, ([a, b]) => offSegment(start, a, b))),
          0.5,
          `${hop.hop.id} starts off its source`
        );
      }
    })
  );

  it.effect("keeps every route inside the zones' bounds plus a margin", () =>
    Effect.gen(function* () {
      const { data, layout } = yield* fixture("flake-pipeline");

      const xs = Arr.flatMap(Rec.values(layout.structures), (p) => [
        p.x,
        p.x + p.w,
      ]);

      const ys = Arr.flatMap(Rec.values(layout.structures), (p) => [
        p.y,
        p.y + p.d,
      ]);

      // Zones reach one unit past their structures; routes may go two more.
      const margin = 3;

      for (const route of Rec.values(routeHops(data, layout))) {
        for (const point of route.points) {
          assert.isAtLeast(point.x, Math.min(...xs) - margin);
          assert.isAtMost(point.x, Math.max(...xs) + margin);
          assert.isAtLeast(point.y, Math.min(...ys) - margin);
          assert.isAtMost(point.y, Math.max(...ys) + margin);
        }
      }
    })
  );
});
