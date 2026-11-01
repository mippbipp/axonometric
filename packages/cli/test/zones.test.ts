import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect, Order } from "effect";
import type { Page } from "playwright";

import { attributesOf } from "./browser.ts";
import { fullMap } from "./fixtures.ts";
import { buildAndOpen } from "./harness.ts";

const reviewPage = Effect.gen(function* () {
  return yield* buildAndOpen(yield* fullMap, "review");
});

const drawnZones = (page: Page) =>
  attributesOf(page, "[data-zone]", "data-zone").pipe(
    Effect.map((ids) => Arr.sort(ids, Order.String))
  );

const goToLast = Effect.fnUntraced(function* (page: Page) {
  yield* Effect.promise(() =>
    page.locator('[data-chapter-rail] button[data-chapter="c-all"]').click()
  );
  yield* Effect.promise(() =>
    page.locator('[data-walkthrough][data-chapter="c-all"]').waitFor()
  );
});

/**
 * Whether the zones come before every structure and hop in the document,
 * so they paint underneath them.
 */
const zonesPaintFirst = `(() => {
  const zones = document.querySelector("[data-zones]");
  const later = [...document.querySelectorAll("[data-structure], [data-hop]")];

  return zones !== null && later.length > 0 && later.every(
    (element) =>
      (zones.compareDocumentPosition(element) &
        Node.DOCUMENT_POSITION_FOLLOWING) !== 0
  );
})()`;

describe("zones in the iso view", () => {
  it.live(
    "draws a zone with its title for every group in the last chapter",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { page, errors } = yield* reviewPage;

          yield* goToLast(page);

          assert.deepStrictEqual(yield* drawnZones(page), [
            "loop",
            "outside",
            "people",
          ]);

          const titles = yield* Effect.promise(() =>
            page.locator("[data-zone] [data-zone-title]").allTextContents()
          );

          // Titles come from data.mjs, in groups order.
          assert.deepStrictEqual(titles, ["People", "The loop", "Outside"]);
          assert.deepStrictEqual(errors, []);
        })
      )
  );

  it.live("draws only the zones of groups revealed so far", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* reviewPage;

        // Chapter 1 reveals the engineer (people) and the page (loop).
        assert.deepStrictEqual(yield* drawnZones(page), ["loop", "people"]);
      })
    )
  );

  it.live("paints zones under hops and structures", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* reviewPage;

        yield* goToLast(page);

        // Later siblings in SVG paint over earlier ones.
        const zonesFirst = yield* Effect.promise(() =>
          page.evaluate<boolean>(zonesPaintFirst)
        );

        assert.isTrue(zonesFirst);
      })
    )
  );
});
