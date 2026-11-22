import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import type { Page } from "playwright";

import {
  click,
  goToChapter,
  inPage,
  press,
  showView,
  waitFor,
  waitGone,
} from "./browser.ts";
import { fullMap, pipelineMap } from "./fixtures.ts";
import { buildAndOpen } from "./harness.ts";

const reviewPage = Effect.gen(function* () {
  const files = yield* fullMap;

  return yield* buildAndOpen(files, "review");
});

const pipelinePage = Effect.gen(function* () {
  const files = yield* pipelineMap;

  return yield* buildAndOpen(files, "flake-pipeline");
});

/** What has focus: a map item's key, the canvas, or the element's tag. */
const focusedOn = (page: Page) =>
  inPage<string>(
    page,
    `(() => {
      const el = document.activeElement;
      if (!el) return "none";
      if (el.matches('[data-slot="canvas-items-item"]')) {
        return el.getAttribute("data-structure") ?? el.getAttribute("data-packet") ?? el.getAttribute("data-note-marker") ?? "item";
      }
      if (el.matches('[data-slot="pannable-canvas"]')) return "canvas";
      return el.tagName.toLowerCase();
    })()`
  );

const focusItem = (page: Page, selector: string) =>
  Effect.promise(() => page.locator(selector).focus());

const waitForFocusOnMap = (page: Page) =>
  Effect.promise(() =>
    page.waitForFunction(
      `(() => {
        const el = document.activeElement;
        return !!el && el !== document.body && !!el.closest('[data-slot="pannable-canvas"]');
      })()`
    )
  ).pipe(Effect.asVoid);

const liveText = `[...document.querySelectorAll('[aria-live]')].map((el) => el.textContent).join(" ")`;

const heard = (page: Page) =>
  Effect.promise(() =>
    page.waitForFunction(`(${liveText}).includes("Focus moved to")`)
  ).pipe(Effect.andThen(inPage<string>(page, liveText)));

describe.each(["iso", "plan"] as const)(
  "focus recovery in the %s view",
  (view) => {
    it.live(
      "moves to the nearest item when a chapter change takes the focused packet away",
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const { page } = yield* pipelinePage;

            yield* showView(page, view);
            yield* goToChapter(page, "c-monday");
            yield* click(
              page,
              '[data-playback-controls] [data-control="pause"]'
            );

            const run = yield* inPage<string>(
              page,
              `document.querySelector("[data-packet]").getAttribute("data-run")`
            );

            yield* focusItem(page, `[data-packet][data-run="${run}"]`);
            yield* press(page, "BracketRight");
            yield* waitFor(page, '[data-walkthrough][data-chapter="c-pr"]');
            yield* waitGone(page, `[data-packet][data-run="${run}"]`);
            yield* waitForFocusOnMap(page);

            const focused = yield* focusedOn(page);

            assert.notStrictEqual(focused, "body");
            const value = yield* heard(page);
            assert.include(value, "Focus moved to");
          })
        )
    );

    it.live(
      "moves to the nearest structure when going back hides the focused one",
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const { page } = yield* reviewPage;

            yield* showView(page, view);
            yield* goToChapter(page, "c-save");

            yield* focusItem(page, '[data-structure="server"]');
            yield* press(page, "BracketLeft");
            yield* waitFor(page, '[data-walkthrough][data-chapter="c-page"]');
            yield* waitGone(page, '[data-structure="server"]');
            yield* waitForFocusOnMap(page);

            const focused = yield* focusedOn(page);

            assert.include(["engineer", "page"], focused);
            const value = yield* heard(page);
            assert.include(value, "Focus moved to");
          })
        )
    );

    it.live(
      "keeps focus on the map when going back closes the inside view",
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const { page } = yield* pipelinePage;

            yield* showView(page, view);
            yield* goToChapter(page, "c-repair");

            yield* focusItem(page, '[data-structure="fixer"]');
            yield* press(page, "Enter");
            yield* waitFor(page, '[data-inside-view="fixer"]');
            yield* press(page, "BracketLeft");
            yield* waitGone(page, "[data-inside-view]");
            yield* waitFor(page, '[data-walkthrough][data-chapter="c-merge"]');
            yield* waitForFocusOnMap(page);

            const focused = yield* focusedOn(page);

            assert.notStrictEqual(focused, "body");
            const value = yield* heard(page);
            assert.include(value, "Focus moved to");
          })
        )
    );
  }
);
