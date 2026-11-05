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
 * At the middle of each structure and of each hop's first leg, what the
 * browser finds on top there: the item itself, or a zone over it. Only spots
 * where a zone plate lies under the pointer too are reported.
 */
const stacksOverZones = `(() => {
  const viewport = document.querySelector("[data-viewport]");
  const toScreen = (point) => new DOMPoint(point.x, point.y).matrixTransform(viewport.getScreenCTM());
  const spots = [
    ...[...document.querySelectorAll("[data-structure]")].map((structure) => {
      const box = structure.getBoundingClientRect();

      return { id: "box:" + structure.dataset.structure, element: structure, x: box.x + box.width / 2, y: box.y + box.height / 2 };
    }),
    ...[...document.querySelectorAll("[data-hop]")].map((hop) => {
      const [a, b] = hop.dataset.route.split(" ").slice(0, 2).map((pair) => {
        const [x, y] = pair.split(",").map(Number);

        return toScreen({ x, y });
      });

      return { id: "hop:" + hop.dataset.hop, element: hop, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }),
  ];

  return spots.flatMap(({ id, element, x, y }) => {
    const stack = document.elementsFromPoint(x, y);
    const zone = stack.findIndex((under) => under.closest("[data-zone]") !== null);
    const own = stack.findIndex((under) => element.contains(under));

    return zone === -1 ? [] : [{ id, onTop: own !== -1 && own < zone }];
  });
})()`;

interface Spot {
  readonly id: string;
  readonly onTop: boolean;
}

interface TitleReport {
  readonly zone: string;
  readonly insideOwn: boolean;
  readonly overOtherZones: readonly string[];
}

/**
 * For each zone, where its title sits on screen: inside its own plate, and
 * which other plates it touches. The title is its text's own box, mapped to
 * the screen through its skew.
 */
const titleReports = `(() => {
  const toScreen = (element, points) => {
    const matrix = element.getScreenCTM();

    return points.map((point) => {
      const at = new DOMPoint(point.x, point.y).matrixTransform(matrix);

      return { x: at.x, y: at.y };
    });
  };

  const boxOf = (element) => {
    const box = element.getBBox();

    return toScreen(element, [
      { x: box.x, y: box.y },
      { x: box.x + box.width, y: box.y },
      { x: box.x + box.width, y: box.y + box.height },
      { x: box.x, y: box.y + box.height },
    ]);
  };

  const inside = (polygon, point) => {
    const signs = polygon.map((corner, index) => {
      const next = polygon[(index + 1) % polygon.length];

      return Math.sign(
        (next.x - corner.x) * (point.y - corner.y) -
          (next.y - corner.y) * (point.x - corner.x)
      );
    });

    return signs.every((sign) => sign >= 0) || signs.every((sign) => sign <= 0);
  };

  const axes = (polygon) =>
    polygon.map((corner, index) => {
      const next = polygon[(index + 1) % polygon.length];

      return { x: next.y - corner.y, y: corner.x - next.x };
    });

  // Separating axis test, on the convex hull a polygon's edges bound.
  const overlap = (a, b) =>
    [...axes(a), ...axes(b)].every((axis) => {
      const along = (polygon) => polygon.map((p) => p.x * axis.x + p.y * axis.y);
      const first = along(a);
      const second = along(b);

      return (
        Math.min(...first) < Math.max(...second) - 1e-6 &&
        Math.min(...second) < Math.max(...first) - 1e-6
      );
    });

  const zones = [...document.querySelectorAll("[data-zone]")];
  const plateOf = (zone) => {
    const plate = zone.querySelector("[data-zone-plate]");

    return toScreen(plate, [...plate.points]);
  };

  return zones.map((zone) => {
    const title = boxOf(zone.querySelector("[data-zone-title]"));

    return {
      zone: zone.dataset.zone,
      insideOwn: title.every((point) => inside(plateOf(zone), point)),
      overOtherZones: zones
        .filter((other) => other !== zone && overlap(title, plateOf(other)))
        .map((other) => other.dataset.zone),
    };
  });
})()`;

describe("zones in the Iso view", () => {
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

  it.live("puts each title on its own plate, clear of other zones", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* reviewPage;

        yield* goToLast(page);

        const reports = yield* Effect.promise(() =>
          page.evaluate<readonly TitleReport[]>(titleReports)
        );

        assert.lengthOf(reports, 3);
        assert.deepStrictEqual(
          reports,
          Arr.map(reports, ({ zone }) => ({
            zone,
            insideOwn: true,
            overOtherZones: [],
          }))
        );
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

        const spots = yield* Effect.promise(() =>
          page.evaluate<readonly Spot[]>(stacksOverZones)
        );

        // Every structure, and every hop, stands on a zone in this chapter.
        assert.isAbove(spots.length, 6);
        assert.deepStrictEqual(
          Arr.filter(spots, ({ onTop }) => !onTop),
          []
        );
      })
    )
  );
});
