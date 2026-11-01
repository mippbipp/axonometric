import { convexOverlap, segmentCrosses } from "@axonometric/contracts";
import type { ScreenPoint } from "@axonometric/contracts";
import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect } from "effect";
import type { Page } from "playwright";

import { pipelineMap } from "./fixtures.ts";
import { buildAndOpen, makeHome, runCli } from "./harness.ts";

/** Chapters 1, 2 and 8 of the pipeline map. */
const chapters = ["c-monday", "c-pr", "c-all"] as const;

const sizes = [
  { width: 1280, height: 800 },
  { width: 1780, height: 1020 },
] as const;

/**
 * Everything drawn as text and every structure's drawn outline, in screen
 * pixels, plus each hop's first leg. Text boxes come from
 * `getBoundingClientRect`, except zone titles, which lie skewed along an
 * edge, so their box is their own box mapped through the skew. A
 * structure's outline is the convex hull of the points of every polygon it
 * draws, so a box that leans past its footprint still counts.
 */
const drawingReport = `(() => {
  const toScreen = (element, points) => {
    const matrix = element.getScreenCTM();

    return points.map((point) => {
      const at = new DOMPoint(point.x, point.y).matrixTransform(matrix);

      return { x: at.x, y: at.y };
    });
  };

  const rectPolygon = (rect) => [
    { x: rect.left, y: rect.top },
    { x: rect.right, y: rect.top },
    { x: rect.right, y: rect.bottom },
    { x: rect.left, y: rect.bottom },
  ];

  const ownBox = (element) => {
    const box = element.getBBox();

    return toScreen(element, [
      { x: box.x, y: box.y },
      { x: box.x + box.width, y: box.y },
      { x: box.x + box.width, y: box.y + box.height },
      { x: box.x, y: box.y + box.height },
    ]);
  };

  const hull = (points) => {
    const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
    const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const half = (list) => {
      const out = [];

      for (const point of list) {
        while (out.length >= 2 && cross(out.at(-2), out.at(-1), point) <= 0) {
          out.pop();
        }

        out.push(point);
      }

      out.pop();

      return out;
    };

    return [...half(sorted), ...half([...sorted].reverse())];
  };

  const text = [
    ...[...document.querySelectorAll("[data-name-tag]")].map((tag) => ({
      id: "tag:" + tag.dataset.nameTag,
      polygon: rectPolygon(tag.querySelector("rect").getBoundingClientRect()),
    })),
    ...[...document.querySelectorAll("[data-hop-label]")].map((label) => ({
      id: "label:" + label.dataset.hopLabel,
      polygon: rectPolygon(label.getBoundingClientRect()),
    })),
    ...[...document.querySelectorAll("[data-zone-title]")].map((title) => ({
      id: "title:" + title.closest("[data-zone]").dataset.zone,
      polygon: ownBox(title),
    })),
  ];

  const structures = [...document.querySelectorAll("[data-structure]")].map(
    (structure) => ({
      id: "box:" + structure.dataset.structure,
      polygon: hull(
        [...structure.querySelectorAll("polygon")].flatMap((part) =>
          toScreen(part, [...part.points])
        )
      ),
    })
  );

  const state = JSON.parse(
    document.getElementById("axonometric-map-state").textContent
  );
  const sourceOf = new Map(state.data.hops.map((hop) => [hop.id, hop.from]));

  const firstLegs = [...document.querySelectorAll("[data-hop]")].map((hop) => {
    const [a, b] = hop.dataset.route.split(" ").slice(0, 2).map((pair) => {
      const [x, y] = pair.split(",").map(Number);

      return { x, y };
    });

    return {
      hop: hop.dataset.hop,
      from: sourceOf.get(hop.dataset.hop),
      leg: toScreen(document.querySelector("[data-viewport]"), [a, b]),
    };
  });

  return { text, structures, firstLegs };
})()`;

interface Point {
  readonly x: number;
  readonly y: number;
}

interface Drawn {
  readonly id: string;
  readonly polygon: readonly { readonly x: number; readonly y: number }[];
}

interface DrawingReport {
  readonly text: readonly Drawn[];
  readonly structures: readonly Drawn[];
  readonly firstLegs: readonly {
    readonly hop: string;
    readonly from: string;
    readonly leg: readonly { readonly x: number; readonly y: number }[];
  }[];
}

const toScreenPoints = (polygon: readonly Point[]): readonly ScreenPoint[] =>
  Arr.map(polygon, ({ x, y }) => ({ sx: x, sy: y }));

/**
 * Whether two drawn shapes overlap. Each is shrunk by half a pixel first,
 * so shapes the browser's rounding makes touch don't count.
 */
const overlap = (a: readonly Point[], b: readonly Point[]) =>
  convexOverlap(shrink(toScreenPoints(a)), shrink(toScreenPoints(b)));

/** A convex polygon pulled half a pixel towards its centre. */
const shrink = (polygon: readonly ScreenPoint[]): readonly ScreenPoint[] => {
  const count = Math.max(polygon.length, 1);
  const cx = Arr.reduce(polygon, 0, (sum, { sx }) => sum + sx) / count;
  const cy = Arr.reduce(polygon, 0, (sum, { sy }) => sum + sy) / count;

  return Arr.map(polygon, ({ sx, sy }) => {
    const length = Math.hypot(sx - cx, sy - cy) || 1;

    return {
      sx: sx - ((sx - cx) / length) * 0.5,
      sy: sy - ((sy - cy) / length) * 0.5,
    };
  });
};

/** Whether a segment runs through a drawn shape. */
const crosses = (segment: readonly Point[], polygon: readonly Point[]) => {
  const [start, end] = toScreenPoints(segment);

  return (
    start !== undefined &&
    end !== undefined &&
    segmentCrosses({ start, end }, shrink(toScreenPoints(polygon)))
  );
};

const openChapter = Effect.fnUntraced(function* (page: Page, id: string) {
  yield* Effect.promise(() =>
    page.locator(`[data-chapter-rail] button[data-chapter="${id}"]`).click()
  );
  yield* Effect.promise(() =>
    page.locator(`[data-walkthrough][data-chapter="${id}"]`).waitFor()
  );
  // Pause, so a packet's selection doesn't bring a hidden label in.
  yield* Effect.promise(() =>
    page.locator('[data-playback-controls] [data-control="pause"]').click()
  );
});

describe("the pipeline map's drawing", () => {
  it.live(
    "keeps text clear of text and boxes, and first legs off their own tags",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { page } = yield* buildAndOpen(
            yield* pipelineMap,
            "flake-pipeline"
          );

          for (const size of sizes) {
            yield* Effect.promise(() => page.setViewportSize(size));

            for (const chapter of chapters) {
              yield* openChapter(page, chapter);

              const report = yield* Effect.promise((): Promise<DrawingReport> =>
                page.evaluate(drawingReport)
              );

              const where = `${chapter} at ${size.width}×${size.height}`;

              const textClashes = Arr.flatMap(report.text, (first, index) =>
                Arr.flatMap(report.text.slice(index + 1), (second) =>
                  overlap(first.polygon, second.polygon)
                    ? [`${first.id} × ${second.id}`]
                    : []
                )
              );

              const underBoxes = Arr.flatMap(report.text, (text) =>
                Arr.flatMap(report.structures, (box) =>
                  overlap(text.polygon, box.polygon)
                    ? [`${text.id} × ${box.id}`]
                    : []
                )
              );

              const throughOwnTag = Arr.flatMap(
                report.firstLegs,
                ({ hop, from, leg }) =>
                  Arr.some(
                    report.text,
                    (tag) =>
                      tag.id === `tag:${from}` && crosses(leg, tag.polygon)
                  )
                    ? [hop]
                    : []
              );

              assert.isNotEmpty(report.text, where);
              assert.deepStrictEqual(
                textClashes,
                [],
                `text over text in ${where}`
              );
              assert.deepStrictEqual(
                underBoxes,
                [],
                `text under boxes in ${where}`
              );
              assert.deepStrictEqual(
                throughOwnTag,
                [],
                `first legs through their own tag in ${where}`
              );
            }
          }
        })
      ),
    60_000
  );
});

describe("check on the pipeline map", () => {
  it.effect("reports no warnings", () =>
    Effect.gen(function* () {
      const home = yield* makeHome(yield* pipelineMap);

      const result = yield* runCli(home, [
        "check",
        `${home}/flake-pipeline/map`,
      ]);

      assert.strictEqual(result.exitCode, 0, result.stdout + result.stderr);
      assert.include(result.stdout, ": 0 errors, 0 warnings.");
    })
  );
});
