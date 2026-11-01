import { pathToFileURL } from "node:url";

import { Array as Arr, Effect, String as Str } from "effect";
import { chromium } from "playwright";
import type { Page } from "playwright";

// Browser tests build a map through the CLI, open the HTML file it wrote in
// Chromium, and check what's on screen. They drive Playwright from Node,
// because a Vitest browser-mode test page can't read a file:// page, or a
// page that `serve` serves from another origin.

const launch = Effect.acquireRelease(
  Effect.promise(() => chromium.launch()),
  (browser) => Effect.promise(() => browser.close())
);

/** Opens `url` and records page errors and every request off the disk. */
export const openUrl = Effect.fnUntraced(function* (url: string) {
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

  yield* Effect.promise(() => page.goto(url));

  yield* Effect.promise(() =>
    page.locator("[data-structure]").first().waitFor({ state: "attached" })
  );

  return { page, requests, errors };
});

/** Opens the HTML file `file`, as `openUrl` does. */
export const openPage = (file: string) => openUrl(pathToFileURL(file).href);

/** The on-screen boxes of every element matching `selector`. */
export const boxesOf = Effect.fnUntraced(function* (
  page: Page,
  selector: string
) {
  const elements = yield* Effect.promise(() => page.locator(selector).all());

  const boxes = yield* Effect.forEach(elements, (element) =>
    Effect.promise(() => element.boundingBox())
  );

  return Arr.filter(boxes, (box) => box !== null);
});

/**
 * `value` as a JavaScript literal, for building the expression strings that
 * `page.evaluate` and `page.waitForFunction` run in the page.
 */
export const literal = (value: string | null) =>
  value === null
    ? "null"
    : `"${Str.replaceAll('"', String.raw`\"`)(Str.replaceAll("\\", String.raw`\\`)(value))}"`;

/** The `name` attribute of every element matching `selector`, in order. */
export const attributesOf = Effect.fnUntraced(function* (
  page: Page,
  selector: string,
  name: string
) {
  const elements = yield* Effect.promise(() => page.locator(selector).all());

  const values = yield* Effect.forEach(elements, (element) =>
    Effect.promise(() => element.getAttribute(name))
  );

  return Arr.filter(values, (value) => value !== null);
});
