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

interface TitleReport {
  readonly zone: string;
  readonly insideOwn: boolean;
  readonly overOtherZones: readonly string[];
  readonly overStructures: readonly string[];
}

/**
 * For each zone, where its title sits on screen: inside its own plate, and
 * which other plates, structures and name tags it touches. The title is its
 * text's own box, mapped to the screen through its skew. A structure is
 * every part it draws: each polygon by its points, anything else by its own
 * box mapped to the screen.
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

  const partsOf = (element) =>
    [...element.querySelectorAll("polygon, polyline, rect, ellipse, circle, path, line, text")]
      .map((part) =>
        part.points === undefined
          ? boxOf(part)
          : toScreen(part, [...part.points])
      )
      .filter((part) => part.length > 0);

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
  const drawn = [...document.querySelectorAll("[data-structure], [data-name-tag]")];

  return zones.map((zone) => {
    const title = boxOf(zone.querySelector("[data-zone-title]"));

    return {
      zone: zone.dataset.zone,
      insideOwn: title.every((point) => inside(plateOf(zone), point)),
      overOtherZones: zones
        .filter((other) => other !== zone && overlap(title, plateOf(other)))
        .map((other) => other.dataset.zone),
      overStructures: drawn
        .filter((element) => partsOf(element).some((part) => overlap(title, part)))
        .map((element) => element.dataset.structure ?? element.dataset.nameTag),
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

  it.live(
    "puts each title on its own plate, clear of other zones, boxes and tags",
    () =>
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
              overStructures: [],
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

        // Later siblings in SVG paint over earlier ones.
        const zonesFirst = yield* Effect.promise(() =>
          page.evaluate<boolean>(zonesPaintFirst)
        );

        assert.isTrue(zonesFirst);
      })
    )
  );
});
