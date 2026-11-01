import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect, Option, String as Str } from "effect";

import {
  gapBetween,
  fitFloorOf,
  routeRevealed,
  sceneClashes,
  sceneOf,
  tagScene,
  textZoomOf,
} from "../src/index.ts";
import type { Scene, SceneSource, SceneStructure } from "../src/index.ts";
import { fixture } from "./fixture-maps.ts";

const names = [
  "flake-pipeline",
  "review",
  "crowded",
  "shapes",
  "pipeline",
] as const;

/** Every structure of a fixture, revealed, routed once. */
const sourceOf = (name: string, view: "iso" | "plan") =>
  Effect.gen(function* () {
    const { data, layout } = yield* fixture(name);
    const revealed = new Set(Arr.map(data.structures, ({ id }) => id));

    return {
      data,
      layout,
      revealed,
      routes: routeRevealed({ data, layout, revealed }),
      view,
    } satisfies SceneSource;
  });

/** Clashes that put text over text or a box, the rule the page keeps. */
const textClashes = (scene: Scene) =>
  Arr.map(
    Arr.filter(
      sceneClashes(scene),
      ({ parts }) => !Arr.some(parts, ({ kind }) => kind === "route")
    ),
    ({ between }) => Arr.join(between, " × ")
  );

/** The structure whose outline `id`'s tag sits nearest, if `id` is drawn. */
const nearestBoxOf = (scene: Scene, id: string) =>
  Option.map(
    Arr.findFirst(scene.structures, ({ structure }) => structure.id === id),
    (own) => {
      const gapTo = ({ outline }: SceneStructure) =>
        gapBetween(own.tag, outline);

      return Arr.reduce(scene.structures, own, (best, box) =>
        gapTo(box) < gapTo(best) ? box : best
      ).structure.id;
    }
  );

/** The clashes a scene has, as keys. */
const clashKeys = (scene: Scene) =>
  Arr.map(sceneClashes(scene), ({ between }) => Arr.join(between, " × "));

describe("text placed at the size it's drawn", () => {
  for (const name of names) {
    it.effect(
      `keeps text clear of text and boxes on the ${name} fixture, zoomed out`,
      () =>
        Effect.gen(function* () {
          for (const view of ["iso", "plan"] as const) {
            const source = yield* sourceOf(name, view);
            const atFullSize = new Set(textClashes(sceneOf(source)));

            for (const zoom of [0.8, 0.6, 0.45]) {
              const at = textZoomOf(fitFloorOf(source, zoom));

              const clashes = textClashes(sceneOf({ ...source, zoom: at }));

              assert.deepStrictEqual(
                Arr.filter(clashes, (clash) => !atFullSize.has(clash)),
                [],
                `${view} view at ${at.toFixed(3)}, fitted at ${zoom}`
              );
            }
          }
        }),
      60_000
    );
  }

  // Fixtures with room for it. The crowded map walls its vault in, so no
  // spot is nearer the vault than a wall; the shapes map packs boxes so
  // tight that `check` warns about their tags. At full size the Iso view
  // keeps each tag under its front corner, as `check` measures.
  for (const name of ["flake-pipeline", "review", "pipeline"] as const) {
    it.effect(
      `puts every grown name tag nearest its own box on the ${name} fixture`,
      () =>
        Effect.gen(function* () {
          for (const view of ["iso", "plan"] as const) {
            const source = yield* sourceOf(name, view);

            for (const fitted of [0.8, 0.6, 0.45, 0.39]) {
              const zoom = textZoomOf(fitFloorOf(source, fitted));
              const scene = sceneOf({ ...source, zoom });

              for (const { structure } of scene.structures) {
                assert.deepStrictEqual(
                  nearestBoxOf(scene, structure.id),
                  Option.some(structure.id),
                  `${structure.id}'s tag, ${view} view fitted at ${fitted}`
                );
              }
            }
          }
        }),
      60_000
    );
  }
});

/** The route ends in a scene that land inside a name tag, as keys. */
const endsOnTags = (scene: Scene) =>
  Arr.flatMap(scene.hops, ({ hop, points }) =>
    Arr.flatMap([points.at(0), points.at(-1)], (end) =>
      end === undefined
        ? []
        : Arr.flatMap(scene.structures, ({ structure, tag }) =>
            end.sx > tag.left &&
            end.sx < tag.right &&
            end.sy > tag.top &&
            end.sy < tag.bottom
              ? [`${hop.id} on ${structure.id}`]
              : []
          )
    )
  );

describe("route ends", () => {
  // A paused packet may sit over a tag, but no route may start or end on
  // one. Bends may pass under a tag, which has a paper fill.
  for (const name of names) {
    it.effect(`stay off name tags on the ${name} fixture`, () =>
      Effect.gen(function* () {
        for (const view of ["iso", "plan"] as const) {
          const source = yield* sourceOf(name, view);

          for (const zoom of [1, 0.6, 0.39]) {
            const scene = sceneOf({ ...source, zoom: textZoomOf(zoom) });

            assert.deepStrictEqual(
              endsOnTags(scene),
              [],
              `${view} view at ${zoom}`
            );
          }
        }
      })
    );
  }
});

describe("name tags at full size", () => {
  // The exemption in `fitFloorOf` for clashes that exist at full size is
  // safe only if `check` warns about them. Of every fixture, only the shapes
  // map's Iso view has any, and `check` warns about both.
  it.effect("clash only where `check` already warns", () =>
    Effect.gen(function* () {
      for (const name of names) {
        for (const view of ["iso", "plan"] as const) {
          const found = clashKeys(sceneOf(yield* sourceOf(name, view)));

          const clashes = Arr.filter(
            found,
            (clash) =>
              Str.includes("tag:")(clash) && !Str.includes("route:")(clash)
          );

          const expected =
            name === "shapes" && view === "iso"
              ? ["box:store × tag:cards", "box:document × tag:job"]
              : [];

          assert.sameMembers([...clashes], expected, `${name} ${view}`);
        }
      }
    })
  );
});

describe("the fit floor", () => {
  it.effect("is the fitted zoom when name tags don't collide", () =>
    Effect.gen(function* () {
      for (const view of ["iso", "plan"] as const) {
        const source = yield* sourceOf("review", view);

        assert.strictEqual(fitFloorOf(source, 0.651), 0.651);
      }
    })
  );

  it.effect("stops zoom to fit where grown name tags would overlap a box", () =>
    Effect.gen(function* () {
      const source = yield* sourceOf("flake-pipeline", "iso");
      const floor = fitFloorOf(source, 0.2);

      // Measured: at 0.2 Iso tags land on boxes, and from about 0.39 up
      // they don't.
      assert.isAbove(floor, 0.3);
      assert.isBelow(floor, 0.6);

      const tagsOn = (zoom: number) =>
        Arr.filter(
          sceneClashes(tagScene({ ...source, zoom })),
          ({ parts }) =>
            Arr.some(parts, ({ kind }) => kind === "tag") &&
            !Arr.some(parts, ({ kind }) => kind === "route")
        );

      assert.isNotEmpty(tagsOn(textZoomOf(0.2)));
      assert.isEmpty(tagsOn(textZoomOf(floor)));
    })
  );
});
