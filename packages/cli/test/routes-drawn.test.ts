import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import type { Page } from "playwright";

import { goToChapter } from "./browser.ts";
import { crowdedMap, fullMap } from "./fixtures.ts";
import { buildAndOpen } from "./harness.ts";

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
 * For each hop with a label shown: how far its label's centre sits from its
 * own drawn route and from the nearest other hop's, in screen pixels.
 */
const labelReport = `
  (() => {
    const viewport = document.querySelector("[data-viewport]");
    const matrix = viewport.getScreenCTM();
    const toSegment = ([ax, ay], [bx, by], [x, y]) => {
      const length = (bx - ax) ** 2 + (by - ay) ** 2;
      const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / length));

      return Math.hypot(x - (ax + t * (bx - ax)), y - (ay + t * (by - ay)));
    };
    const toPolyline = (points, point) => {
      let best = Infinity;

      for (let i = 0; i + 1 < points.length; i += 1) {
        best = Math.min(best, toSegment(points[i], points[i + 1], point));
      }

      return best;
    };
    const routes = new Map(
      [...document.querySelectorAll("[data-hop]")].map((line) => [
        line.dataset.hop,
        line.dataset.route.split(" ").map((pair) => {
          const [sx, sy] = pair.split(",").map(Number);
          const point = new DOMPoint(sx, sy).matrixTransform(matrix);

          return [point.x, point.y];
        }),
      ])
    );

    return [...document.querySelectorAll("[data-hop-label]")].map((element) => {
      const id = element.dataset.hopLabel;
      const box = element.getBoundingClientRect();
      const centre = [box.x + box.width / 2, box.y + box.height / 2];
      const others = [...routes].filter(([other]) => other !== id);

      return {
        hop: id,
        own: toPolyline(routes.get(id), centre),
        nearestOther: Math.min(Infinity, ...others.map(([, line]) => toPolyline(line, centre))),
      };
    });
  })()
`;

interface LabelReport {
  readonly hop: string;
  readonly own: number;
  readonly nearestOther: number;
}

const labelsIn = Effect.fnUntraced(function* (page: Page) {
  return yield* Effect.promise((): Promise<readonly LabelReport[]> =>
    page.evaluate(labelReport)
  );
});

describe("routed hops", () => {
  it.live("put each shown label nearer its own route than any other", () =>
    Effect.scoped(
      Effect.gen(function* () {
        for (const [files, system] of [
          [yield* fullMap, "review"],
          [yield* crowdedMap, "crowded"],
        ] as const) {
          const { page } = yield* buildAndOpen(files, system);

          yield* goToChapter(page, "c-all");

          const labels = yield* labelsIn(page);

          assert.isNotEmpty(labels, system);

          for (const label of labels) {
            assert.isBelow(
              label.own,
              label.nearestOther,
              `${label.hop}'s label sits nearer another hop in ${system}`
            );
          }
        }
      })
    )
  );

  it.live("draw the crowded map's boxes in front over the ones behind", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* buildAndOpen(yield* crowdedMap, "crowded");

        yield* goToChapter(page, "c-all");

        // At a point where the west wall's box and the vault's both draw,
        // the topmost structure is the one in front.
        const onTop = yield* Effect.promise((): Promise<readonly string[]> =>
          page.evaluate(`(() => {
            const structure = (id) => document.querySelector('[data-structure="' + id + '"]');
            const west = structure("west");
            const inFill = (element, x, y) =>
              [...element.querySelectorAll("polygon, rect")].some((part) => {
                const local = new DOMPoint(x, y).matrixTransform(part.getScreenCTM().inverse());

                return part.isPointInFill(local);
              });
            const box = west.getBoundingClientRect();
            const found = [];

            for (const front of ["vault"]) {
              const other = structure(front);
              let seen = null;

              for (let i = 1; i < 40 && seen === null; i += 1) {
                for (let j = 1; j < 40 && seen === null; j += 1) {
                  const x = box.left + (box.width * i) / 40;
                  const y = box.top + (box.height * j) / 40;

                  if (inFill(west, x, y) && inFill(other, x, y)) {
                    seen = document.elementsFromPoint(x, y).map((element) => element.closest("[data-structure]")).find((element) => element !== null)?.dataset.structure ?? "nothing";
                  }
                }
              }

              found.push(front + ":" + seen);
            }

            return found;
          })()`)
        );

        // The west wall ends before the vault starts along x, so the vault
        // is drawn over it.
        assert.deepStrictEqual(onTop, ["vault:vault"]);
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
