import { fileURLToPath } from "node:url";

import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect, FileSystem } from "effect";
import type { Page } from "playwright";

import { literal } from "./browser.ts";
import { fullMap, minimalMap } from "./fixtures.ts";
import { buildAndOpen } from "./harness.ts";

const reviewPage = Effect.gen(function* () {
  return yield* buildAndOpen(yield* fullMap, "review");
});

const pipelinePage = Effect.gen(function* () {
  return yield* buildAndOpen(yield* minimalMap, "pipeline");
});

const overviewButton = "header [data-control='overview']";

const overviewPage = "dialog[open][data-overview-page]";

const click = (page: Page, selector: string) =>
  Effect.promise(() => page.locator(selector).click());

const press = (page: Page, key: string) =>
  Effect.promise(() => page.keyboard.press(key));

const waitFor = (page: Page, selector: string) =>
  Effect.promise(() => page.locator(selector).first().waitFor());

const waitGone = (page: Page, selector: string) =>
  Effect.promise(() =>
    page.locator(selector).first().waitFor({ state: "detached" })
  );

const texts = (page: Page, selector: string) =>
  Effect.promise(() => page.locator(selector).allTextContents());

const inPage = <A>(page: Page, expression: string) =>
  Effect.promise(() => page.evaluate<A>(expression));

const openOverview = Effect.fnUntraced(function* (page: Page) {
  yield* click(page, overviewButton);
  yield* waitFor(page, overviewPage);
});

/** The resolved `href` of each link matching `selector`. */
const resolvedLinks = (page: Page, selector: string) =>
  inPage<readonly string[]>(
    page,
    `[...document.querySelectorAll(${literal(selector)})].map((a) => a.href)`
  );

/** Whether a `file:` URL, without its fragment, names a file on disk. */
const fileExists = (url: string) => {
  const file = new URL(url);

  file.hash = "";

  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    return yield* fs.exists(fileURLToPath(file));
  }).pipe(Effect.orDie, Effect.provide(NodeServices.layer));
};

describe("the page title", () => {
  it.live("shows the overview's title in the header and the tab", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* pipelinePage;

        const heading = yield* texts(page, "header h1");
        const title = yield* Effect.promise(() => page.title());

        assert.deepStrictEqual(heading, ["Flake update pipeline"]);
        assert.strictEqual(title, "Flake update pipeline · axonometric");
      })
    )
  );
});

describe("the How it's built page", () => {
  it.live("shows every overview field in SYSTEM.md's order", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page, errors } = yield* reviewPage;

        yield* openOverview(page);

        const label = yield* inPage<string>(
          page,
          `document.getElementById(document.querySelector(${literal(overviewPage)}).getAttribute("aria-labelledby")).textContent`
        );

        const headings = yield* texts(page, `${overviewPage} h3`);

        const text = yield* texts(page, overviewPage);

        const decisions = yield* texts(
          page,
          `${overviewPage} [data-overview-decisions] tbody tr`
        );

        const layout = yield* texts(page, `${overviewPage} pre`);

        const deepDives = yield* texts(
          page,
          `${overviewPage} [data-deep-dive]`
        );

        assert.strictEqual(label, "How it's built");
        assert.deepStrictEqual(headings, [
          "Decisions",
          "What the platform provides",
          "What we own",
          "File layout",
          "Cost model",
          "Deep dives",
        ]);

        const [all = ""] = text;

        assert.include(all, "The engineer pins a note on the page.");
        assert.include(all, "Runtime");
        assert.include(all, "Node 24");
        assert.include(all, "Node's file system and an HTTP server.");
        assert.include(all, "The proposal format and the review commands.");
        assert.include(all, "One agent run per batch, about 20k tokens.");
        assert.lengthOf(decisions, 3);
        assert.include(decisions[0] ?? "", "Server");
        assert.include(decisions[0] ?? "", "adr/0001-local-server.md");
        assert.include(decisions[2] ?? "", "Proposals live in proposals.json.");
        assert.deepStrictEqual(layout, [
          "map/\n  data.mjs\n  layout.json\n  proposals.json",
        ]);
        assert.lengthOf(deepDives, 2);
        assert.include(deepDives[0] ?? "", "Clipboard access");
        assert.include(
          deepDives[0] ?? "",
          "Browsers block the clipboard outside a click."
        );
        assert.deepStrictEqual(errors, []);
      })
    )
  );

  it.live("links ADRs and deep dives to the files next to SYSTEM.md", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* reviewPage;

        yield* openOverview(page);

        const adrs = yield* resolvedLinks(
          page,
          `${overviewPage} [data-overview-decisions] a`
        );

        const deepDives = yield* resolvedLinks(
          page,
          `${overviewPage} [data-deep-dive] a`
        );

        const [adr = "", url = ""] = adrs;
        const [research = ""] = deepDives;

        assert.lengthOf(adrs, 2);
        assert.match(adr, /^file:.*\/review\/adr\/0001-local-server\.md$/u);
        assert.isTrue(yield* fileExists(adr), adr);
        assert.strictEqual(url, "https://example.com/adr/harness");
        assert.lengthOf(deepDives, 1);
        assert.match(
          research,
          /^file:.*\/review\/research\/clipboard\.md#findings$/u
        );
        assert.isTrue(yield* fileExists(research), research);
      })
    )
  );

  it.live("leaves out the fields that aren't set", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* pipelinePage;

        yield* openOverview(page);

        const headings = yield* texts(page, `${overviewPage} h3`);

        const tables = yield* texts(
          page,
          `${overviewPage} table, ${overviewPage} pre, ${overviewPage} dl`
        );

        const [all = ""] = yield* texts(page, overviewPage);

        assert.deepStrictEqual(headings, []);
        assert.deepStrictEqual(tables, []);
        assert.include(
          all,
          "The updater bumps flake inputs and the Build gate checks them."
        );
      })
    )
  );

  it.live("moves focus in and back, and closes with Esc or the button", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* reviewPage;
        const focusInside = `document.querySelector(${literal(overviewPage)})?.contains(document.activeElement) ?? false`;

        const focusOnButton = `document.activeElement === document.querySelector(${literal(overviewButton)})`;

        yield* openOverview(page);

        const expanded = yield* Effect.promise(() =>
          page.locator(overviewButton).getAttribute("aria-expanded")
        );

        assert.strictEqual(expanded, "true");
        assert.isTrue(yield* inPage<boolean>(page, focusInside));
        assert.deepStrictEqual(yield* texts(page, "[data-hint]"), [
          "Esc closes this page",
        ]);

        yield* press(page, "Escape");
        yield* waitGone(page, overviewPage);
        assert.isTrue(yield* inPage<boolean>(page, focusOnButton));

        yield* openOverview(page);
        yield* click(page, overviewButton);
        yield* waitGone(page, overviewPage);
        assert.isTrue(yield* inPage<boolean>(page, focusOnButton));
      })
    )
  );

  it.live("keeps the chapter, the selection and the zoom", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* reviewPage;
        const scale = 'document.querySelector("svg[data-scale]").dataset.scale';

        yield* click(page, '[data-chapter-rail] button[data-chapter="c-save"]');
        yield* waitFor(page, '[data-walkthrough][data-chapter="c-save"]');
        yield* click(page, '[data-structure="server"]');
        yield* waitFor(page, '[data-structure-panel="server"][data-pinned]');
        yield* click(page, 'button[aria-label="Zoom in"]');

        const zoomed = yield* inPage<string>(page, scale);

        yield* openOverview(page);
        yield* press(page, "Escape");
        yield* waitGone(page, overviewPage);
        yield* openOverview(page);
        yield* click(page, overviewButton);
        yield* waitGone(page, overviewPage);

        const chapter = yield* inPage<string>(
          page,
          'document.querySelector("[data-walkthrough]").dataset.chapter'
        );

        const pinned = yield* Effect.promise(() =>
          page.locator('[data-structure-panel="server"][data-pinned]').count()
        );

        assert.strictEqual(chapter, "c-save");
        assert.strictEqual(pinned, 1);
        assert.strictEqual(yield* inPage<string>(page, scale), zoomed);
        assert.isTrue(
          Arr.isArrayNonEmpty(yield* texts(page, "[data-structure]"))
        );
      })
    )
  );
});
