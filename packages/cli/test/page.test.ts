import { pathToFileURL } from "node:url";

import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect, Order, Path, String as Str } from "effect";
import { chromium } from "playwright";
import type { Page } from "playwright";

import { minimalMap } from "./fixtures.ts";
import { makeHome, runCli } from "./harness.ts";

// These tests build a map through the CLI, open the HTML file it wrote in
// Chromium, and check what's on screen. They drive Playwright from Node; see
// docs/adr/0001-seam-2-drives-playwright-from-node.md for why.

const launch = Effect.acquireRelease(
  Effect.promise(() => chromium.launch()),
  (browser) => Effect.promise(() => browser.close())
);

/** Opens `file` and records page errors and every request off the disk. */
const openPage = Effect.fnUntraced(function* (file: string) {
  const browser = yield* launch;

  const page = yield* Effect.promise(() =>
    browser.newPage({ viewport: { width: 1024, height: 640 } })
  );

  const requests: string[] = [];
  const errors: string[] = [];

  page.on("request", (request) => {
    if (!Str.startsWith("file:")(request.url())) {
      requests.push(request.url());
    }
  });

  page.on("pageerror", (error) => {
    errors.push(error.message);
  });

  yield* Effect.promise(() => page.goto(pathToFileURL(file).href));

  yield* Effect.promise(() =>
    page.locator("[data-hop]").first().waitFor({ state: "attached" })
  );

  return { page, requests, errors };
});

const builtPage = Effect.gen(function* () {
  const path = yield* Path.Path;
  const home = yield* makeHome(minimalMap);
  const result = yield* runCli(home, ["build", `${home}/pipeline/map`]);

  assert.strictEqual(result.exitCode, 0, result.stderr);

  return yield* openPage(path.join(home, "pipeline", "pipeline.html"));
}).pipe(Effect.provide(NodeServices.layer));

const documentProperty = (page: Page, name: "compatMode" | "characterSet") =>
  Effect.promise(() => page.evaluate<string>(`document.${name}`));

const boxesOf = Effect.fnUntraced(function* (page: Page, selector: string) {
  const elements = yield* Effect.promise(() => page.locator(selector).all());

  const boxes = yield* Effect.forEach(elements, (element) =>
    Effect.promise(() => element.boundingBox())
  );

  return Arr.filter(boxes, (box) => box !== null);
});

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

        const route = yield* Effect.promise(() =>
          page.locator('[data-hop="h-update"] polyline').getAttribute("points")
        );

        const arrowhead = yield* Effect.promise(() =>
          page
            .locator('[data-hop="h-update"] polyline')
            .getAttribute("marker-end")
        );

        assert.deepStrictEqual(Arr.sort(tags, Order.String), [
          "Build gate",
          "Flake updater",
        ]);
        assert.strictEqual(boxes, 2);
        assert.include(hop ?? "", "update → build");
        // Start, one bend, end.
        assert.lengthOf(Str.split(" ")(route ?? ""), 3);
        assert.match(arrowhead ?? "", /^url\(#.+\)$/u);
      })
    )
  );

  it.live("fits the drawing to the window", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* builtPage;
        const [svg] = yield* boxesOf(page, "svg");
        const drawn = yield* boxesOf(page, "[data-structure], [data-name-tag]");

        assert.isDefined(svg);
        assert.lengthOf(drawn, 4);

        if (svg === undefined) {
          return;
        }

        const lefts = Arr.map(drawn, (box) => box.x);
        const tops = Arr.map(drawn, (box) => box.y);
        const rights = Arr.map(drawn, (box) => box.x + box.width);
        const bottoms = Arr.map(drawn, (box) => box.y + box.height);
        const left = Math.min(...lefts);
        const top = Math.min(...tops);
        const right = Math.max(...rights);
        const bottom = Math.max(...bottoms);

        assert.isAtLeast(left, svg.x);
        assert.isAtLeast(top, svg.y);
        assert.isAtMost(right, svg.x + svg.width);
        assert.isAtMost(bottom, svg.y + svg.height);

        // Fitted, not tiny: the drawing fills most of one dimension.
        const share = Math.max(
          (right - left) / svg.width,
          (bottom - top) / svg.height
        );

        assert.isAbove(share, 0.7);
      })
    )
  );
});
