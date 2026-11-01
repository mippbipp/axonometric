import {
  Layout,
  MapData,
  routeRevealed,
  sceneClashes,
  sceneOf,
} from "@axonometric/contracts";
import type { SceneSource } from "@axonometric/contracts";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect, Schema, String as Str } from "effect";

// The editor has no test runner of its own; its pure modules are tested here.
import { fitFloorOf, textZoomOf } from "../../editor/src/readable-text.ts";
import { crowdedMap, fullMap, pipelineMap, shapesMap } from "./fixtures.ts";
import type { HomeFiles } from "./harness.ts";
import { makeHome, runCli } from "./harness.ts";

/** A fixture's map state, as `build` inlines it in the page. */
const stateOf = Effect.fnUntraced(function* (files: HomeFiles, system: string) {
  const home = yield* makeHome(files);
  const built = yield* runCli(home, ["build", `${home}/${system}/map`]);

  assert.strictEqual(built.exitCode, 0, built.stderr);

  const html = built.files[`${system}/${system}.html`] ?? "";

  const [, json = "{}"] =
    /<script[^>]*id="axonometric-map-state"[^>]*>(?<json>[\s\S]*?)<\/script>/u.exec(
      html
    ) ?? [];

  const state = yield* Schema.decodeEffect(
    Schema.fromJsonString(Schema.Struct({ data: MapData, layout: Layout }))
  )(json);

  return state;
}, Effect.provide(NodeServices.layer));

const fixtures = [
  { name: "review", files: fullMap, system: "review" },
  { name: "crowded", files: crowdedMap, system: "crowded" },
  { name: "pipeline", files: pipelineMap, system: "flake-pipeline" },
  { name: "shapes", files: shapesMap, system: "shapes" },
] as const;

/** Every structure of a map, revealed, routed once. */
const sourceOf = (
  { data, layout }: { data: MapData; layout: Layout },
  view: "iso" | "plan"
): SceneSource => {
  const revealed = new Set(Arr.map(data.structures, ({ id }) => id));

  return {
    data,
    layout,
    revealed,
    routes: routeRevealed({ data, layout, revealed }),
    view,
  };
};

/** Clashes that put text over text or a box, the rule the page keeps. */
const textClashes = (source: SceneSource, zoom: number) => {
  const clashes = sceneClashes(sceneOf({ ...source, zoom }));
  const keys = Arr.map(clashes, ({ between }) => Arr.join(between, " × "));

  return Arr.filter(keys, (clash) => !Str.includes("route:")(clash));
};

describe("the zoom text is sized for", () => {
  it.effect("is 1 at and above full size, and steps down by 10%", () =>
    Effect.sync(() => {
      assert.strictEqual(textZoomOf(1.4), 1);
      assert.strictEqual(textZoomOf(1), 1);
      assert.closeTo(textZoomOf(0.95), 1 / 1.1, 1e-9);
      assert.closeTo(textZoomOf(1 / 1.1), 1 / 1.1, 1e-9);
      assert.closeTo(textZoomOf(0.5), 1 / 1.1 ** 8, 1e-9);
    })
  );

  it.effect("is never above the view's zoom, so text never shrinks", () =>
    Effect.sync(() => {
      for (const zoom of [0.99, 0.8, 0.61, 0.43, 0.3, 0.2]) {
        assert.isAtMost(textZoomOf(zoom), zoom);
        assert.isAbove(textZoomOf(zoom), zoom / 1.1 - 1e-9);
      }
    })
  );
});

describe("text placed at the size it's drawn", () => {
  for (const { name, files, system } of fixtures) {
    it.effect(
      `keeps text clear of text and boxes on the ${name} map, zoomed out`,
      () =>
        Effect.gen(function* () {
          const state = yield* stateOf(yield* files, system);

          for (const view of ["iso", "plan"] as const) {
            const source = sourceOf(state, view);
            const atFullSize = new Set(textClashes(source, 1));

            for (const zoom of [0.8, 0.6, 0.45]) {
              const at = textZoomOf(fitFloorOf(source, zoom));

              assert.deepStrictEqual(
                Arr.filter(
                  textClashes(source, at),
                  (clash) => !atFullSize.has(clash)
                ),
                [],
                `${view} view at ${at.toFixed(3)}, fitted at ${zoom}`
              );
            }
          }
        }),
      60_000
    );
  }
});

describe("the fit floor", () => {
  it.effect("is the fitted zoom when name tags don't collide", () =>
    Effect.gen(function* () {
      const state = yield* stateOf(yield* fullMap, "review");

      for (const view of ["iso", "plan"] as const) {
        assert.strictEqual(fitFloorOf(sourceOf(state, view), 0.651), 0.651);
      }
    })
  );

  it.effect(
    "stops zoom to fit where grown name tags would overlap a box",
    () =>
      Effect.gen(function* () {
        const state = yield* stateOf(yield* pipelineMap, "flake-pipeline");
        const source = sourceOf(state, "iso");
        const floor = fitFloorOf(source, 0.2);

        // Measured: at 0.2 Iso tags land on boxes, and from about 0.45 up
        // they don't.
        assert.isAbove(floor, 0.3);
        assert.isBelow(floor, 0.6);

        const tagsOn = (zoom: number) => {
          const scene = sceneOf({ ...source, zoom, tagsOnly: true });

          return Arr.filter(
            sceneClashes(scene),
            ({ between: [a, b] }) =>
              Str.startsWith("tag:")(a) || Str.startsWith("tag:")(b)
          );
        };

        const outAt = tagsOn(textZoomOf(0.2));
        const atFloor = tagsOn(textZoomOf(floor));

        assert.isNotEmpty(
          Arr.filter(outAt, ({ between }) =>
            Arr.some(between, Str.startsWith("box:"))
          )
        );
        assert.isEmpty(
          Arr.filter(atFloor, ({ between }) =>
            Arr.every(between, (id) => !Str.startsWith("route:")(id))
          )
        );
      }),
    60_000
  );
});
