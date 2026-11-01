import { assert, describe, it } from "@effect/vitest";
import { Effect, String as Str } from "effect";
import type { Page } from "playwright";

import { attributesOf } from "./browser.ts";
import { fullMap } from "./fixtures.ts";
import { buildAndOpen } from "./harness.ts";

const dataFile = "review/map/data.mjs";

/**
 * The review map with a second flow, so the flow picker has a real choice:
 * "A note" plays h-note, h-save and h-store; "Accepting" plays h-store and
 * h-pr.
 */
const twoFlowPage = Effect.gen(function* () {
  const files = yield* fullMap;
  const original = files[dataFile] ?? "";

  return yield* buildAndOpen(
    {
      ...files,
      [dataFile]: `${Str.replace("export default {", "const data = {")(original)}
data.flows.push({ id: "f-accept", name: "Accepting", hops: ["h-store", "h-pr"] });
export default data;
`,
    },
    "review"
  );
});

const reviewPage = Effect.gen(function* () {
  return yield* buildAndOpen(yield* fullMap, "review");
});

const waitFor = (page: Page, selector: string) =>
  Effect.promise(() => page.locator(selector).first().waitFor());

const click = (page: Page, selector: string) =>
  Effect.promise(() => page.locator(selector).click());

const attribute = (page: Page, selector: string, name: string) =>
  Effect.promise(() => page.locator(selector).first().getAttribute(name));

const packetIds = (page: Page) =>
  attributesOf(page, "[data-packet]", "data-packet");

const goToChapter = Effect.fnUntraced(function* (page: Page, id: string) {
  yield* click(page, `[data-chapter-rail] button[data-chapter="${id}"]`);
  yield* waitFor(page, `[data-walkthrough][data-chapter="${id}"]`);
});

/** Steps and waits until the packet panel shows `hop`. */
const stepTo = Effect.fnUntraced(function* (page: Page, hop: string) {
  yield* click(page, '[data-playback-controls] [data-control="step"]');
  yield* waitFor(page, `[data-packet-panel="${hop}"]`);
});

/** Steps until the packet panel shows `hop`, at most `limit` times. */
const stepUntil = Effect.fnUntraced(function* (
  page: Page,
  hop: string,
  limit: number
) {
  for (let steps = 0; steps < limit; steps++) {
    const shown = yield* Effect.promise(() =>
      page.locator(`[data-packet-panel="${hop}"]`).count()
    );

    if (shown > 0) {
      return;
    }

    yield* click(page, '[data-playback-controls] [data-control="step"]');
  }

  yield* waitFor(page, `[data-packet-panel="${hop}"]`);
});

/** Waits two animation frames in the page. */
const nextFrames = (page: Page) =>
  Effect.promise(() =>
    page.evaluate(
      "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))"
    )
  );

const packetCentre = Effect.fnUntraced(function* (page: Page) {
  const dot = page.locator("[data-packet] circle").first();
  const cx = yield* Effect.promise(() => dot.getAttribute("cx"));
  const cy = yield* Effect.promise(() => dot.getAttribute("cy"));

  return { cx, cy };
});

describe("packets", () => {
  it.live("move along the chapter's hops while playing", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* reviewPage;

        yield* waitFor(page, '[data-packets][data-playing="true"]');

        const start = yield* packetCentre(page);

        // Every leg runs along a grid axis, which moves the dot on screen
        // both across and down, so a new cy means the dot has moved.
        yield* waitFor(page, `[data-packet] circle:not([cy="${start.cy}"])`);

        assert.deepStrictEqual(yield* packetIds(page), ["h-note"]);
      })
    )
  );

  it.live("leave the hop's label drawn once while they play on it", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* reviewPage;

        yield* goToChapter(page, "c-save");
        yield* click(page, '[data-playback-controls] [data-control="pause"]');
        yield* click(page, "[data-packet]");
        yield* stepUntil(page, "h-save", 3);

        const labels = yield* Effect.promise(() =>
          page
            .locator("svg text")
            .filter({ hasText: /^POST \/proposals$/u })
            .count()
        );

        assert.strictEqual(labels, 1);
      })
    )
  );

  it.live("pause when clicked and show the hop's label and payload", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page, errors } = yield* reviewPage;

        yield* goToChapter(page, "c-save");
        yield* waitFor(page, '[data-packets][data-playing="true"]');

        // The packet is moving, so dispatch the click on it rather than
        // aiming the mouse at where it was.
        yield* Effect.promise(() =>
          page.locator("[data-packet]").dispatchEvent("click")
        );

        yield* waitFor(page, '[data-packets][data-playing="false"]');
        yield* waitFor(page, "[data-packet-panel]");

        const clicked = yield* attribute(page, "[data-packet]", "data-packet");

        const panel = yield* attribute(
          page,
          "[data-packet-panel]",
          "data-packet-panel"
        );

        assert.strictEqual(panel, clicked);

        // Step on to the hop with a payload, h-save.
        const order = ["h-note", "h-save", "h-store"];
        const at = order.indexOf(clicked ?? "");

        assert.isAtLeast(at, 0);

        for (let offset = 1; offset <= (1 - at + 3) % 3; offset++) {
          yield* stepTo(page, order[(at + offset) % 3] ?? "");
        }

        yield* waitFor(page, '[data-packet-panel="h-save"]');

        const label = yield* Effect.promise(() =>
          page.locator("[data-packet-label]").textContent()
        );

        const payload = yield* Effect.promise(() =>
          page.locator("[data-packet-payload]").textContent()
        );

        assert.strictEqual(label, "POST /proposals");
        assert.strictEqual(
          payload,
          `{
  "kind": "note",
  "target": "server"
}`
        );

        yield* click(page, '[data-playback-controls] [data-control="play"]');
        yield* waitFor(page, '[data-packets][data-playing="true"]');
        yield* waitFor(page, "[data-chapter-story]");
        assert.deepStrictEqual(errors, []);
      })
    )
  );

  it.live("pause, step through the hops in order and play again", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* reviewPage;

        yield* goToChapter(page, "c-save");
        yield* click(page, '[data-playback-controls] [data-control="pause"]');
        yield* waitFor(page, '[data-packets][data-playing="false"]');

        // Paused, the packet can be clicked like anything else.
        yield* click(page, "[data-packet]");

        const first = yield* attribute(
          page,
          "[data-packet-panel]",
          "data-packet-panel"
        );

        const order = ["h-note", "h-save", "h-store"];
        const at = order.indexOf(first ?? "");

        assert.isAtLeast(at, 0);

        for (const offset of [1, 2, 3]) {
          yield* stepTo(page, order[(at + offset) % order.length] ?? "");
        }

        yield* click(page, '[data-playback-controls] [data-control="play"]');
        yield* waitFor(page, '[data-packets][data-playing="true"]');
      })
    )
  );

  it.live("stay still when the user prefers reduced motion", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* reviewPage;

        yield* Effect.promise(() =>
          page.emulateMedia({ reducedMotion: "reduce" })
        );
        yield* Effect.promise(() => page.reload());
        yield* goToChapter(page, "c-save");
        yield* waitFor(page, '[data-packets][data-playing="false"]');

        const before = yield* packetCentre(page);

        yield* nextFrames(page);

        const after = yield* packetCentre(page);

        const playDisabled = yield* Effect.promise(() =>
          page
            .locator('[data-playback-controls] [data-control="play"]')
            .isDisabled()
        );

        assert.deepStrictEqual(after, before);
        assert.isTrue(playDisabled);
        // At rest, the packet waits on the chapter's first hop.
        assert.deepStrictEqual(yield* packetIds(page), ["h-note"]);

        yield* stepTo(page, "h-save");
        assert.deepStrictEqual(yield* packetIds(page), ["h-save"]);
      })
    )
  );
});

describe("the flow picker", () => {
  it.live("shows only in the last chapter", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* twoFlowPage;

        const early = yield* Effect.promise(() =>
          page.locator("[data-flow-picker]").count()
        );

        yield* goToChapter(page, "c-all");

        const buttons = yield* Effect.promise(() =>
          page.locator("[data-flow-picker] button").allTextContents()
        );

        assert.strictEqual(early, 0);
        assert.deepStrictEqual(buttons, ["A note", "Accepting", "All flows"]);
      })
    )
  );

  it.live("plays every flow, or the one picked", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* twoFlowPage;

        yield* goToChapter(page, "c-all");

        // The last chapter plays no hops of its own, so it starts on all
        // flows: one packet each.
        assert.strictEqual(
          yield* attribute(
            page,
            '[data-flow-picker] [data-flow="all"]',
            "aria-pressed"
          ),
          "true"
        );
        yield* waitFor(page, '[data-packet][data-run="f-note"]');
        yield* waitFor(page, '[data-packet][data-run="f-accept"]');

        yield* click(page, '[data-flow-picker] [data-flow="f-accept"]');
        yield* waitFor(page, '[data-flow="f-accept"][aria-pressed="true"]');

        const runs = yield* attributesOf(page, "[data-packet]", "data-run");

        assert.deepStrictEqual(runs, ["f-accept"]);

        yield* click(page, '[data-playback-controls] [data-control="pause"]');
        yield* click(page, "[data-packet]");

        const first = yield* attribute(
          page,
          "[data-packet-panel]",
          "data-packet-panel"
        );

        yield* stepTo(page, first === "h-store" ? "h-pr" : "h-store");

        const eyebrow = yield* Effect.promise(() =>
          page.locator("[data-packet-panel] p").first().textContent()
        );

        assert.include(eyebrow ?? "", "Accepting");
      })
    )
  );
});
