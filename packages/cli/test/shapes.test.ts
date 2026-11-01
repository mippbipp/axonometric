import { shapes, statusLabels } from "@axonometric/contracts";
import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect, Order } from "effect";
import type { Page } from "playwright";

import { shapesMap } from "./fixtures.ts";
import { buildAndOpen } from "./harness.ts";

const builtPage = Effect.gen(function* () {
  return yield* buildAndOpen(yield* shapesMap, "shapes");
});

// Code that runs in the page is written as expression strings, because this
// package has no DOM types.

const inPage = <A>(page: Page, expression: string) =>
  Effect.promise(() => page.evaluate<A>(expression));

const attributeOfAll = (page: Page, selector: string, name: string) =>
  inPage<string[]>(
    page,
    `Array.from(document.querySelectorAll(${JSON.stringify(selector)}), (element) => element.getAttribute(${JSON.stringify(name)}) ?? "")`
  );

/** A computed style property of the structure with `id`. */
const styleOf = (page: Page, id: string, property: string) =>
  inPage<string>(
    page,
    `getComputedStyle(document.querySelector('[data-structure="${id}"]')).${property}`
  );

/** The computed fill of the structure's first face. */
const faceFillOf = (page: Page, id: string) =>
  inPage<string>(
    page,
    `getComputedStyle(document.querySelector('[data-structure="${id}"] [data-face]')).fill`
  );

const lookOf = Effect.fnUntraced(function* (page: Page, id: string) {
  return {
    dashes: yield* styleOf(page, id, "strokeDasharray"),
    stroke: yield* styleOf(page, id, "stroke"),
    opacity: yield* styleOf(page, id, "opacity"),
    face: yield* faceFillOf(page, id),
  };
});

describe("shapes and statuses", () => {
  it.live("draws one structure of each shape", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page, errors } = yield* builtPage;

        const drawn = yield* attributeOfAll(
          page,
          "[data-structure]",
          "data-shape"
        );

        assert.deepStrictEqual(
          Arr.sort(drawn, Order.String),
          Arr.sort([...shapes], Order.String)
        );
        assert.deepStrictEqual(errors, []);
      })
    )
  );

  it.live("draws each shape differently", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* builtPage;

        // Compare the drawings with their positions taken out: the element
        // names, in order, plus the attributes that aren't coordinates.
        const outlines = yield* inPage<string[]>(
          page,
          `Array.from(document.querySelectorAll("[data-structure]"), (element) =>
            Array.from(element.querySelectorAll("*"), (child) =>
              child.tagName + "." + (child.getAttribute("class") ?? "")
            ).join(" ")
          )`
        );

        assert.lengthOf(new Set(outlines), shapes.length);
      })
    )
  );

  it.live("gives live, planned and off their own look and label", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* builtPage;

        const statusOf = yield* attributeOfAll(
          page,
          '[data-structure="box"], [data-structure="cards"], [data-structure="slab"]',
          "data-status"
        );

        const live = yield* lookOf(page, "box");
        const planned = yield* lookOf(page, "cards");
        const off = yield* lookOf(page, "slab");

        const titles = yield* Effect.promise(() =>
          page
            .locator(
              '[data-structure="cards"] > title, [data-structure="slab"] > title'
            )
            .allTextContents()
        );

        assert.deepStrictEqual(Arr.sort(statusOf, Order.String), [
          "live",
          "off",
          "planned",
        ]);
        assert.strictEqual(live.dashes, "none");
        assert.notStrictEqual(planned.dashes, "none");
        assert.strictEqual(off.dashes, "none");
        // Off fades its fill but keeps a full-strength outline.
        assert.notStrictEqual(off.face, live.face);
        assert.strictEqual(off.stroke, live.stroke);
        assert.strictEqual(off.opacity, "1");
        assert.strictEqual(
          yield* inPage<number>(
            page,
            "document.querySelectorAll(\"[data-structure='slab'] [data-off-mark]\").length"
          ),
          1
        );
        assert.deepStrictEqual(Arr.sort(titles, Order.String), [
          `Backend · ${statusLabels.off}`,
          `Tools · ${statusLabels.planned}`,
        ]);
      })
    )
  );
});
