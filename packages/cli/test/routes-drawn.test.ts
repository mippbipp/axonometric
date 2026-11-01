import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import type { Page } from "playwright";

import { crowdedMap, fullMap } from "./fixtures.ts";
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
      '[data-hop="' + packet.dataset.packet + '"] polyline'
    );
    const points = line
      .getAttribute("points")
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

describe("routed hops", () => {
  it.live("draw every label in the review map clear of every box", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* buildAndOpen(yield* fullMap, "review");

        yield* goToChapter(page, "c-all");

        const labels = yield* Effect.promise(
          (): Promise<readonly LabelReport[]> => page.evaluate(labelReport)
        );

        assert.lengthOf(labels, 4);

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

        // h-query leaves the API's front edge and reaches the database's
        // front edge, running in front of the cache, so no box hides it.
        const clear = yield* Effect.promise(() =>
          page.locator('[data-hidden-hop="h-query"] polyline').count()
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
