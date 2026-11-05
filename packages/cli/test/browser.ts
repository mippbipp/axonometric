import { pathToFileURL } from "node:url";

import { assert } from "@effect/vitest";
import { Array as Arr, Effect, String as Str } from "effect";
import { chromium } from "playwright";
import type { Browser, Page } from "playwright";

// Browser tests build a map through the CLI, open the HTML file it wrote in
// Chromium, and check what's on screen. They drive Playwright from Node,
// because a Vitest browser-mode test page can't read a file:// page, or a
// page that `serve` serves from another origin.

// Each test file launches Chromium once, on its first page, and
// test/browser-setup.ts closes it after the file, even when a test failed.
// Vitest runs without isolation (see vitest.config.ts), so the test files in
// one worker share this module, but it runs the setup file again for each.
// Every test still gets a fresh browser context, so storage, theme and
// viewport don't carry over.
let browser: Promise<Browser> | undefined;

/** Closes the test file's Chromium, if it launched one. */
export const closeBrowser = () => {
  const launched = browser;

  browser = undefined;

  return launched?.then((open) => open.close());
};

const openContext = Effect.acquireRelease(
  Effect.promise(() => {
    browser ??= chromium.launch();

    return browser.then((launched) =>
      launched.newContext({ viewport: { width: 1024, height: 640 } })
    );
  }),
  (context) => Effect.promise(() => context.close())
);

/** Opens `url` and records page errors and every request off the disk. */
export const openUrl = Effect.fnUntraced(function* (url: string) {
  const context = yield* openContext;
  const page = yield* Effect.promise(() => context.newPage());

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
// oxlint-disable-next-line effecttsgo/prefer-schema-over-json -- a JSON string is a JavaScript string literal
export const literal = (value: string | null) => JSON.stringify(value);

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

/** How long a page test waits for the page to show something. */
export const waitTimeout = { timeout: 15_000 };

/** The map's two views. */
export type View = "iso" | "plan";

/** Runs `expression` in the page and returns what it gives. */
export const inPage = <A>(page: Page, expression: string) =>
  Effect.promise(() => page.evaluate<A>(expression));

/** Waits until an element matching `selector` is on the page. */
export const waitFor = (page: Page, selector: string) =>
  Effect.promise(() => page.locator(selector).first().waitFor(waitTimeout));

/** Waits until no element matching `selector` is on the page. */
export const waitGone = (page: Page, selector: string) =>
  Effect.promise(() =>
    page
      .locator(selector)
      .first()
      .waitFor({ state: "detached", ...waitTimeout })
  );

/**
 * Clicks the element matching `selector`. More than one match fails the
 * test, so a click can't land on a different element than the test means.
 */
export const click = (page: Page, selector: string) =>
  Effect.promise(() => page.locator(selector).click());

/** Presses `key`, such as `+` or `Control+z`, on the page. */
export const press = (page: Page, key: string) =>
  Effect.promise(() => page.keyboard.press(key));

/** How many elements match `selector`, shown or hidden. */
export const count = (page: Page, selector: string) =>
  Effect.promise(() => page.locator(selector).count());

/** The text of the first element matching `selector`, or "" when it has none. */
export const textOf = (page: Page, selector: string) =>
  Effect.promise(() =>
    page
      .locator(selector)
      .first()
      .textContent()
      .then((text) => text ?? "")
  );

/** The attribute `name` of the first element matching `selector`. */
export const attributeOf = (page: Page, selector: string, name: string) =>
  Effect.promise(() => page.locator(selector).first().getAttribute(name));

/** The computed stroke colour of the element matching `selector`. */
export const strokeOf = (page: Page, selector: string) =>
  inPage<string>(
    page,
    `getComputedStyle(document.querySelector(${literal(selector)})).stroke`
  );

/** The middle of the element matching `selector`, in window pixels. */
export const centreOf = Effect.fnUntraced(function* (
  page: Page,
  selector: string
) {
  const box = yield* Effect.promise(() =>
    page.locator(selector).first().boundingBox()
  );

  assert.isNotNull(box, `${selector} isn't on screen`);

  return box === null
    ? { x: 0, y: 0 }
    : { x: box.x + box.width / 2, y: box.y + box.height / 2 };
});

/** Opens chapter `id` from the chapter rail. */
export const goToChapter = Effect.fnUntraced(function* (
  page: Page,
  id: string
) {
  yield* click(page, `[data-chapter-rail] button[data-chapter="${id}"]`);
  yield* waitFor(page, `[data-walkthrough][data-chapter="${id}"]`);
});

/**
 * Opens chapter `id` and pauses its packets, so they stay off the lines and
 * a packet's selection doesn't bring a hidden label in.
 */
export const goToChapterPaused = Effect.fnUntraced(function* (
  page: Page,
  id: string
) {
  yield* goToChapter(page, id);
  yield* click(page, '[data-playback-controls] [data-control="pause"]');
});

/** Switches to `view` with the view toggle. */
export const showView = Effect.fnUntraced(function* (page: Page, view: View) {
  yield* click(page, `[data-view-toggle] [data-view="${view}"]`);
  yield* waitFor(page, `[data-walkthrough][data-view="${view}"]`);
});

/**
 * Switches to `view` and zooms to fit. A switch keeps the zoom; 0 fits the
 * chapter in this view.
 */
export const showViewFitted = Effect.fnUntraced(function* (
  page: Page,
  view: View
) {
  yield* showView(page, view);
  yield* press(page, "0");
});

/** One grid unit along x or y on screen, at the view's current zoom. */
export const unitOnScreen = Effect.fnUntraced(function* (
  page: Page,
  view: View
) {
  const scale = yield* attributeOf(page, "svg[data-scale]", "data-scale");

  return (view === "plan" ? 60 : Math.hypot(36, 18)) * Number(scale);
});

/** The viewport's current zoom, as the `data-scale` on the canvas, run in the page. */
export const scaleExpression =
  'Number(document.querySelector("svg[data-scale]").dataset.scale)';

/** The viewport's current zoom, as the `data-scale` on the canvas. */
export const scaleOf = (page: Page) => inPage<number>(page, scaleExpression);

/**
 * Waits until the zoom passes `test`, such as `> 2`. Input reaches the page
 * asynchronously, so a test waits for the new state instead of reading once.
 */
export const waitForScale = (page: Page, test: string) =>
  Effect.promise(() =>
    page.waitForFunction(`${scaleExpression} ${test}`, undefined, {
      timeout: 5000,
    })
  );

/**
 * A point on screen where a segment of hop `id` is the topmost element, so a
 * press there lands on the hop. In the Iso view a segment can run under a
 * box, so the points along every segment are tried until one is not covered.
 */
export const pointOnHop = (page: Page, id: string) =>
  inPage<{ x: number; y: number } | null>(
    page,
    `((id) => {
      const segments = document.querySelectorAll(
        '[data-route-segment][data-hop-id="' + id + '"]'
      );

      for (const segment of segments) {
        const length = segment.getTotalLength();

        for (let step = 0; step < 40; step += 1) {
          const along = 0.5 + (step % 2 === 0 ? 1 : -1) * Math.ceil(step / 2) * 0.0125;
          const at = segment.getPointAtLength(length * Math.min(Math.max(along, 0.02), 0.98));
          const m = segment.getScreenCTM();
          const x = m.a * at.x + m.c * at.y + m.e;
          const y = m.b * at.x + m.d * at.y + m.f;

          if (document.elementFromPoint(x, y) === segment) {
            return { x, y };
          }
        }
      }

      return null;
    })(${literal(id)})`
  );
