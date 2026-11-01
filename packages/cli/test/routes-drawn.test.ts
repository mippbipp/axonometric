import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect } from "effect";
import type { Page } from "playwright";

import { crowdedMap, fullMap, pipelineMap } from "./fixtures.ts";
import { buildAndOpen } from "./harness.ts";

const goToChapter = Effect.fnUntraced(function* (page: Page, id: string) {
  yield* Effect.promise(() =>
    page.locator(`[data-chapter-rail] button[data-chapter="${id}"]`).click()
  );
  yield* Effect.promise(() =>
    page.locator(`[data-walkthrough][data-chapter="${id}"]`).waitFor()
  );
});

/**
 * For each hop label, whether it's drawn after every structure and how many
 * points of a grid over its box land on a structure's face.
 */
const labelReport = `
  [...document.querySelectorAll("[data-hop-label]")].map((label) => {
    const structures = [...document.querySelectorAll("[data-structure]")];
    const faces = [...document.querySelectorAll("[data-structure] [data-face]")];
    const box = label.getBBox();
    const covered = [];

    for (let i = 0; i <= 8; i += 1) {
      for (let j = 0; j <= 4; j += 1) {
        const point = new DOMPoint(
          box.x + (box.width * i) / 8,
          box.y + (box.height * j) / 4
        );

        for (const face of faces) {
          if (face.isPointInFill(point)) {
            covered.push(face.closest("[data-structure]").dataset.structure);
          }
        }
      }
    }

    return {
      hop: label.dataset.hopLabel,
      text: label.textContent,
      onTop: structures.every(
        (structure) =>
          structure.compareDocumentPosition(label) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ),
      covered: [...new Set(covered)],
    };
  })
`;

interface LabelReport {
  readonly hop: string;
  readonly text: string;
  readonly onTop: boolean;
  readonly covered: readonly string[];
}

/**
 * How far the packet's dot sits from its hop's drawn route, in screen
 * units, or -1 when there's no packet.
 */
const packetOffRoute = `
  (() => {
    const packet = document.querySelector("[data-packet]");

    if (packet === null) {
      return -1;
    }

    const dot = packet.querySelector("circle");
    const x = Number(dot.getAttribute("cx"));
    const y = Number(dot.getAttribute("cy"));
    const line = document.querySelector(
      '[data-hop="' + packet.dataset.packet + '"]'
    );
    const points = line
      .dataset.route
      .split(" ")
      .map((pair) => pair.split(",").map(Number));
    let best = Infinity;

    for (let i = 0; i + 1 < points.length; i += 1) {
      const [ax, ay] = points[i];
      const [bx, by] = points[i + 1];
      const length = (bx - ax) ** 2 + (by - ay) ** 2;
      const t =
        length === 0
          ? 0
          : Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / length));

      best = Math.min(best, Math.hypot(x - (ax + t * (bx - ax)), y - (ay + t * (by - ay))));
    }

    return best;
  })()
`;

/**
 * For each hop: how far its first and last points sit from the ground
 * outlines of its source and target footprints, and how far its label's
 * centre sits from its own route and from the nearest other route, all in
 * screen pixels. Footprints come from the map state inlined in the page,
 * projected the way the Iso view projects them.
 */
const hopReport = `
  (() => {
    const state = JSON.parse(document.getElementById("axonometric-map-state").textContent);
    const viewport = document.querySelector("[data-viewport]");
    const matrix = viewport.getScreenCTM();
    const toScreen = ({ sx, sy }) => {
      const point = new DOMPoint(sx, sy).matrixTransform(matrix);

      return [point.x, point.y];
    };
    const project = (x, y) => toScreen({ sx: ((x - y) * 72) / 2, sy: ((x + y) * 36) / 2 });
    const outline = (id) => {
      const { x, y, w, d } = state.layout.structures[id];

      return [project(x, y), project(x + w, y), project(x + w, y + d), project(x, y + d)];
    };
    const toSegment = ([ax, ay], [bx, by], [x, y]) => {
      const length = (bx - ax) ** 2 + (by - ay) ** 2;
      const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / length));

      return Math.hypot(x - (ax + t * (bx - ax)), y - (ay + t * (by - ay)));
    };
    const toPolyline = (points, point, closed) => {
      let best = Infinity;
      const count = closed ? points.length : points.length - 1;

      for (let i = 0; i < count; i += 1) {
        best = Math.min(best, toSegment(points[i], points[(i + 1) % points.length], point));
      }

      return best;
    };
    const routes = new Map(
      [...document.querySelectorAll("[data-hop]")].map((line) => [
        line.dataset.hop,
        line.dataset.route
          .split(" ")
          .map((pair) => {
            const [sx, sy] = pair.split(",").map(Number);

            return toScreen({ sx, sy });
          }),
      ])
    );

    return [...routes].map(([id, points]) => {
      const hop = state.data.hops.find((item) => item.id === id);
      const element = document.querySelector('[data-hop-label="' + id + '"]');
      const label = element === null ? undefined : element.getBoundingClientRect();
      const centre = label === undefined ? undefined : [label.x + label.width / 2, label.y + label.height / 2];
      const others = [...routes].filter(([other]) => other !== id);

      return {
        hop: id,
        bends: points.length - 2,
        offset: (() => {
          const a = state.layout.structures[hop.from];
          const b = state.layout.structures[hop.to];
          const overlapX = a.x < b.x + b.w && b.x < a.x + a.w;
          const overlapY = a.y < b.y + b.d && b.y < a.y + a.d;

          return !overlapX && !overlapY;
        })(),
        start: toPolyline(outline(hop.from), points[0], true),
        end: toPolyline(outline(hop.to), points.at(-1), true),
        label: centre === undefined ? 0 : toPolyline(points, centre, false),
        nearestOther: centre === undefined ? Infinity : Math.min(Infinity, ...others.map(([, line]) => toPolyline(line, centre, false))),
      };
    });
  })()
`;

interface HopReport {
  readonly hop: string;
  readonly bends: number;
  /** Whether the hop's ends are apart along both axes. */
  readonly offset: boolean;
  readonly start: number;
  readonly end: number;
  readonly label: number;
  readonly nearestOther: number;
}

const hopsIn = Effect.fnUntraced(function* (page: Page) {
  return yield* Effect.promise((): Promise<readonly HopReport[]> =>
    page.evaluate(hopReport)
  );
});

/** How far, in pixels at fit, a label's centre may sit from its route. */
const labelReach = 40;

describe("routed hops", () => {
  it.live(
    "start and end on their footprints' ground outlines, in both maps",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          for (const [files, system] of [
            [yield* fullMap, "review"],
            [yield* crowdedMap, "crowded"],
          ] as const) {
            const { page } = yield* buildAndOpen(files, system);

            yield* goToChapter(page, "c-all");

            for (const hop of yield* hopsIn(page)) {
              assert.isBelow(
                hop.start,
                1.5,
                `${hop.hop} starts off its source`
              );
              assert.isBelow(hop.end, 1.5, `${hop.hop} ends off its target`);
            }
          }
        })
      ),
    30_000
  );

  it.live(
    "put each label next to its own route, nearer it than any other",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          for (const [files, system] of [
            [yield* fullMap, "review"],
            [yield* crowdedMap, "crowded"],
          ] as const) {
            const { page } = yield* buildAndOpen(files, system);

            yield* goToChapter(page, "c-all");

            for (const hop of yield* hopsIn(page)) {
              assert.isBelow(
                hop.label,
                labelReach,
                `${hop.hop}'s label is far from its route`
              );
              assert.isBelow(
                hop.label,
                hop.nearestOther,
                `${hop.hop}'s label sits nearer another hop`
              );
            }
          }
        })
      ),
    30_000
  );

  it.live("draw the crowded map's boxes in front over the ones behind", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* buildAndOpen(yield* crowdedMap, "crowded");

        yield* goToChapter(page, "c-all");

        const order = yield* Effect.promise((): Promise<readonly string[]> =>
          page.evaluate(
            '[...document.querySelectorAll("[data-structure]")].map((box) => box.dataset.structure)'
          )
        );

        // The west wall ends before the vault and the south wall start
        // along x, so both are drawn over it.
        assert.isBelow(order.indexOf("west"), order.indexOf("vault"));
        assert.isBelow(order.indexOf("west"), order.indexOf("south"));
      })
    )
  );

  it.live(
    "bend every hop between structures offset on both axes",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { page } = yield* buildAndOpen(
            yield* pipelineMap,
            "flake-pipeline"
          );

          yield* goToChapter(page, "c-all");

          const offset = Arr.filter(yield* hopsIn(page), (hop) => hop.offset);

          assert.isNotEmpty(offset);

          for (const hop of offset) {
            assert.isAtLeast(hop.bends, 1, `${hop.hop} is one straight leg`);
          }
        })
      ),
    // The pipeline map routes 29 hops for each of its eight chapters.
    30_000
  );

  it.live("draw every shown label in the review map clear of every box", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* buildAndOpen(yield* fullMap, "review");

        yield* goToChapter(page, "c-all");

        const labels = yield* Effect.promise(
          (): Promise<readonly LabelReport[]> => page.evaluate(labelReport)
        );

        // A label with no clear spot beside its hop is hidden, and shows
        // while the pointer is on the hop.
        const hidden = Arr.filter(
          ["h-note", "h-save", "h-store", "h-pr"],
          (hop) => !Arr.some(labels, (label) => label.hop === hop)
        );

        for (const hop of hidden) {
          // Packets move over the line, so dispatch the hover on the hop
          // rather than aiming the mouse at it.
          yield* Effect.promise(() =>
            page.locator(`[data-hop="${hop}"]`).dispatchEvent("pointerover")
          );
          yield* Effect.promise(() =>
            page.locator(`[data-hop-label="${hop}"]`).waitFor()
          );
        }

        assert.isAtLeast(labels.length, 2);

        for (const label of labels) {
          assert.isTrue(label.onTop, `${label.hop} is drawn under a box`);
          assert.deepStrictEqual(
            label.covered,
            [],
            `${label.hop} sits on a box`
          );
        }
      })
    )
  );

  it.live("draw stretches hidden behind boxes faintly over them", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* buildAndOpen(yield* crowdedMap, "crowded");

        yield* goToChapter(page, "c-all");

        // h-secret runs under the west wall to reach the vault.
        const stretches = yield* Effect.promise(() =>
          page.locator('[data-hidden-hop="h-secret"] polyline').count()
        );

        const lastStructure = yield* Effect.promise(() =>
          page.evaluate(`
            document.querySelector('[data-hidden-hop="h-secret"]')
              .compareDocumentPosition(
                [...document.querySelectorAll("[data-structure]")].at(-1)
              ) & Node.DOCUMENT_POSITION_PRECEDING
          `)
        );

        // h-reply runs straight back from the API to the client, in front
        // of everything, so no box hides it.
        const clear = yield* Effect.promise(() =>
          page.locator('[data-hidden-hop="h-reply"] polyline').count()
        );

        assert.isAbove(stretches, 0);
        assert.isAbove(Number(lastStructure), 0);
        assert.strictEqual(clear, 0);
      })
    )
  );

  it.live("carry packets along the drawn route", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* buildAndOpen(yield* fullMap, "review");

        yield* goToChapter(page, "c-save");
        yield* Effect.promise(() =>
          page.locator('[data-packets][data-playing="true"]').waitFor()
        );

        for (let sample = 0; sample < 5; sample += 1) {
          const off = yield* Effect.promise((): Promise<number> =>
            page.evaluate(packetOffRoute)
          );

          assert.isAtLeast(off, 0, "no packet is playing");
          assert.isBelow(off, 1, "the packet left its hop's route");
          yield* Effect.promise(() => page.waitForTimeout(150));
        }
      })
    )
  );
});
