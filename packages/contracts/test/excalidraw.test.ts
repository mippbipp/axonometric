import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect, Record as Rec, Schema } from "effect";

import {
  excalidrawOf,
  Layout,
  MapData,
  planRect,
  zonesOf,
} from "../src/index.ts";
import type { ExcalidrawElement } from "../src/index.ts";

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

    const layout = yield* Schema.decodeUnknownEffect(
      Schema.Struct({ default: Layout })
    )(layoutModule);

    return { data: data.default, layout: layout.default };
  }).pipe(Effect.orDie);

const ofType = <T extends ExcalidrawElement["type"]>(
  elements: readonly ExcalidrawElement[],
  type: T
) =>
  Arr.filter(
    elements,
    (element): element is Extract<ExcalidrawElement, { type: T }> =>
      element.type === type
  );

describe("excalidraw export", () => {
  it.effect(
    "draws a rectangle per structure, an arrow per hop and a frame per group",
    () =>
      Effect.gen(function* () {
        const { data, layout } = yield* fixture("flake-pipeline");
        const file = excalidrawOf({ data, layout });

        assert.strictEqual(file.type, "excalidraw");
        assert.strictEqual(file.version, 2);
        assert.strictEqual(
          ofType(file.elements, "rectangle").length,
          data.structures.length
        );
        assert.strictEqual(
          ofType(file.elements, "arrow").length,
          data.hops.length
        );
        assert.strictEqual(
          ofType(file.elements, "frame").length,
          zonesOf({ data, layout }).length
        );
      })
  );

  it.effect("binds every arrow, label and name to an element that exists", () =>
    Effect.gen(function* () {
      const { data, layout } = yield* fixture("flake-pipeline");
      const { elements } = excalidrawOf({ data, layout });
      const byId = new Map(
        Arr.map(elements, (element) => [element.id, element])
      );

      assert.strictEqual(byId.size, elements.length, "ids are unique");

      for (const arrow of ofType(elements, "arrow")) {
        for (const binding of [arrow.startBinding, arrow.endBinding]) {
          assert.isNotNull(binding);

          const target = byId.get(binding?.elementId ?? "");

          assert.strictEqual(target?.type, "rectangle");
          assert.isTrue(
            Arr.some(target?.boundElements ?? [], ({ id }) => id === arrow.id),
            `${binding?.elementId} lists ${arrow.id}`
          );
        }

        assert.deepStrictEqual(arrow.points[0], [0, 0]);
      }

      for (const element of elements) {
        for (const bound of element.boundElements) {
          assert.strictEqual(byId.get(bound.id)?.type, bound.type);
        }

        if (element.frameId !== null) {
          assert.strictEqual(byId.get(element.frameId)?.type, "frame");
        }
      }

      for (const text of ofType(elements, "text")) {
        const container = byId.get(text.containerId);

        assert.isTrue(
          Arr.some(container?.boundElements ?? [], ({ id }) => id === text.id)
        );
      }
    })
  );

  it.effect(
    "uses Plan view positions, names, labels and group frames from the map",
    () =>
      Effect.gen(function* () {
        const { data, layout } = yield* fixture("pipeline");
        const { elements } = excalidrawOf({ data, layout });
        const byId = new Map(
          Arr.map(elements, (element) => [element.id, element])
        );
        const gate = byId.get("structure:gate");
        const placement = layout.structures.gate;

        assert.isDefined(placement);

        if (placement !== undefined) {
          const rect = planRect(placement);

          assert.deepInclude(gate, {
            x: rect.left,
            y: rect.top,
            width: rect.right - rect.left,
            height: rect.bottom - rect.top,
            frameId: "group:pipeline",
          });
        }

        assert.deepInclude(byId.get("structure-name:gate"), {
          text: "Build gate",
          containerId: "structure:gate",
        });
        assert.deepInclude(byId.get("hop-label:h-update"), {
          text: "update → build",
          containerId: "hop:h-update",
        });
        assert.deepInclude(byId.get("group:pipeline"), {
          type: "frame",
          name: "Pipeline",
        });
      })
  );

  it.effect("writes the same file for the same map", () =>
    Effect.gen(function* () {
      const { data, layout } = yield* fixture("crowded");

      assert.deepStrictEqual(
        excalidrawOf({ data, layout }),
        excalidrawOf({ data, layout })
      );
    })
  );

  it.effect("leaves out structures with no placement and their hops", () =>
    Effect.gen(function* () {
      const { data, layout } = yield* fixture("pipeline");

      const { elements } = excalidrawOf({
        data,
        layout: {
          ...layout,
          structures: Rec.remove(layout.structures, "gate"),
        },
      });

      assert.strictEqual(ofType(elements, "rectangle").length, 1);
      assert.strictEqual(ofType(elements, "arrow").length, 0);
    })
  );
});
