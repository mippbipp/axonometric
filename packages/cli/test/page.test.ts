import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect, Order } from "effect";
import type { Page } from "playwright";

import { minimalMap } from "./fixtures.ts";
import { buildAndOpen } from "./harness.ts";

const builtPage = Effect.gen(function* () {
  return yield* buildAndOpen(yield* minimalMap, "pipeline");
});

const documentProperty = (page: Page, name: "compatMode" | "characterSet") =>
  Effect.promise(() => page.evaluate<string>(`document.${name}`));

describe("the built page", () => {
  it.live("opens from disk in standards mode with no network requests", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page, requests, errors } = yield* builtPage;

        const compatMode = yield* documentProperty(page, "compatMode");
        const characterSet = yield* documentProperty(page, "characterSet");

        assert.strictEqual(compatMode, "CSS1Compat");
        // oxlint-disable-next-line unicorn/text-encoding-identifier-case -- the DOM reports it this way
        assert.strictEqual(characterSet, "UTF-8");
        assert.deepStrictEqual(requests, []);
        assert.deepStrictEqual(errors, []);
      })
    )
  );

  it.live("draws both structures with name tags, and the hop", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* builtPage;

        const tags = yield* Effect.promise(() =>
          page.locator("[data-name-tag]").allTextContents()
        );

        const boxes = yield* Effect.promise(() =>
          page.locator("[data-structure]").count()
        );

        const hop = yield* Effect.promise(() =>
          page.locator('[data-hop="h-update"]').textContent()
        );

        const arrowheads = yield* Effect.promise(() =>
          page.locator('[data-hop="h-update"] [data-arrowhead]').count()
        );

        assert.deepStrictEqual(Arr.sort(tags, Order.String), [
          "Build gate",
          "Flake updater",
        ]);
        assert.strictEqual(boxes, 2);
        assert.include(hop ?? "", "update → build");
        assert.strictEqual(arrowheads, 1);
      })
    )
  );
});
