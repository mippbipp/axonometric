import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect, Record as Rec, String as Str } from "effect";

import { excalidrawOf } from "../src/index.ts";
import type { ExcalidrawElement } from "../src/index.ts";
import { fixture } from "./fixture-maps.ts";

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
        assert.strictEqual(ofType(file.elements, "frame").length, 4);
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

        // gate sits at x 4, y 0 with a 2 by 1.5 footprint, at 60 px a unit.
        assert.deepInclude(byId.get("structure:gate"), {
          x: 240,
          y: 0,
          width: 120,
          height: 90,
          frameId: "group:pipeline",
        });

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

  it.effect(
    "wraps every name and label to fit, and keeps text in its frame",
    () =>
      Effect.gen(function* () {
        const { data, layout } = yield* fixture("flake-pipeline");
        const { elements } = excalidrawOf({ data, layout });

        const byId = new Map(
          Arr.map(elements, (element) => [element.id, element])
        );

        const texts = ofType(elements, "text");

        assert.isAbove(texts.length, 0);

        for (const text of texts) {
          const container = byId.get(text.containerId);

          // A name with no space to break at is cut, so compare without spaces.
          assert.strictEqual(
            Str.replaceAll(/\s/gu, "")(text.text),
            Str.replaceAll(/\s/gu, "")(text.originalText)
          );

          const longest = Math.max(
            ...Arr.map(Str.split(text.text, "\n"), Str.length)
          );

          assert.isAtMost(longest * text.fontSize * 0.6, text.width + 0.001);

          if (container?.type === "rectangle") {
            assert.isAtMost(text.width, container.width, text.originalText);
            assert.isAtMost(text.height, container.height, text.originalText);
          }

          if (text.frameId !== null) {
            const frame = byId.get(text.frameId);

            assert.isDefined(frame);
            assert.isAtLeast(text.x, frame?.x ?? Number.NaN, text.originalText);
            assert.isAtLeast(text.y, frame?.y ?? Number.NaN, text.originalText);
            assert.isAtMost(
              text.x + text.width,
              (frame?.x ?? Number.NaN) + (frame?.width ?? Number.NaN),
              text.originalText
            );
            assert.isAtMost(
              text.y + text.height,
              (frame?.y ?? Number.NaN) + (frame?.height ?? Number.NaN),
              text.originalText
            );
          }
        }

        const long = byId.get("structure-name:workspace");

        assert.isDefined(long);
        assert.include(long?.type === "text" ? long.text : "", "\n");
      })
  );

  it.effect(
    "stamps every element with created, and text with baseFontSize",
    () =>
      Effect.gen(function* () {
        const { data, layout } = yield* fixture("pipeline");
        const { elements } = excalidrawOf({ data, layout });

        for (const element of elements) {
          assert.isNumber(element.created);

          if (element.type === "text") {
            assert.isNull(element.baseFontSize);
          }
        }
      })
  );
});
