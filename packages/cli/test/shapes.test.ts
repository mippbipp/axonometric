import { shapes } from "@axonometric/contracts";
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

/** Whether the structure's hatching shows, as its computed `display`. */
const hatchOf = (page: Page, id: string) =>
  inPage<string>(
    page,
    `getComputedStyle(document.querySelector('[data-structure="${id}"] [data-hatch]')).display`
  );

const lookOf = Effect.fnUntraced(function* (page: Page, id: string) {
  return {
    dashes: yield* styleOf(page, id, "strokeDasharray"),
    stroke: yield* styleOf(page, id, "stroke"),
    opacity: yield* styleOf(page, id, "opacity"),
    face: yield* faceFillOf(page, id),
    hatch: yield* hatchOf(page, id),
    offMarks: yield* inPage<number>(
      page,
      `document.querySelectorAll('[data-structure="${id}"] [data-off-mark]').length`
    ),
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

  it.live("draws the document's folded corner and its crease", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* builtPage;

        // What paints on top at the middle of the crease and of the flap.
        const onTop = yield* inPage<{ crease: string; flap: string }>(
          page,
          `(() => {
            const fold = document.querySelector('[data-structure="document"] [data-fold]');
            // A flap's corners meet at the crease, so it's sampled at the
            // middle of its corners, not of its box.
            const middleOf = (element) => {
              if (element.tagName === "line") {
                const box = element.getBoundingClientRect();

                return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
              }

              const corners = [...element.points].map((point) => new DOMPoint(point.x, point.y).matrixTransform(element.getScreenCTM()));

              return {
                x: corners.reduce((sum, { x }) => sum + x, 0) / corners.length,
                y: corners.reduce((sum, { y }) => sum + y, 0) / corners.length,
              };
            };
            const topAt = (element) => {
              const { x, y } = middleOf(element);
              const top = document.elementsFromPoint(x, y)[0];

              return top === element ? "itself" : top?.tagName ?? "nothing";
            };

            return {
              crease: topAt(fold.querySelector("line")),
              flap: topAt(fold.querySelector("polygon")),
            };
          })()`
        );

        assert.deepStrictEqual(onTop, { crease: "itself", flap: "itself" });
      })
    )
  );

  for (const view of ["iso", "plan"] as const) {
    it.live(
      `gives live, planned and off their own look in the ${view} view`,
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const { page } = yield* builtPage;

            if (view === "plan") {
              yield* Effect.promise(() =>
                page.locator('[data-view-toggle] [data-view="plan"]').click()
              );
              yield* Effect.promise(() =>
                page.locator('[data-walkthrough][data-view="plan"]').waitFor()
              );
            }

            const statusOf = yield* attributeOfAll(
              page,
              '[data-structure="box"], [data-structure="cards"], [data-structure="slab"]',
              "data-status"
            );

            const live = yield* lookOf(page, "box");
            const planned = yield* lookOf(page, "cards");
            const off = yield* lookOf(page, "slab");

            assert.deepStrictEqual(Arr.sort(statusOf, Order.String), [
              "live",
              "off",
              "planned",
            ]);
            assert.strictEqual(live.dashes, "none");
            assert.notStrictEqual(planned.dashes, "none");
            assert.strictEqual(off.dashes, "none");
            // Planned has no hatching; live does.
            assert.strictEqual(planned.hatch, "none");
            assert.notStrictEqual(live.hatch, "none");
            // Off fades its fill but keeps a full-strength outline, with a
            // power mark on top.
            assert.notStrictEqual(off.face, live.face);
            assert.notStrictEqual(off.face, planned.face);
            assert.strictEqual(off.stroke, live.stroke);
            assert.strictEqual(off.opacity, "1");
            assert.strictEqual(off.offMarks, 1);
            assert.strictEqual(live.offMarks, 0);
          })
        )
    );
  }

  it.live("names the status in the hover tooltip", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* builtPage;

        const tooltipOf = Effect.fnUntraced(function* (id: string) {
          yield* Effect.promise(() =>
            page.locator(`[data-structure="${id}"]`).hover()
          );

          return yield* Effect.promise(() =>
            page.locator(`[data-tooltip="${id}"] p`).first().textContent()
          );
        });

        assert.include(
          (yield* tooltipOf("slab")) ?? "",
          "Backend · Switched off"
        );
        assert.include((yield* tooltipOf("cards")) ?? "", "Tools · Planned");
      })
    )
  );
});
