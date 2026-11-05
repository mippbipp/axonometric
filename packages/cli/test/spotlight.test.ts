import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Path } from "effect";
import type { Page } from "playwright";

import { attributeOf, literal, openUrl, showView } from "./browser.ts";
import { pipelineMap } from "./fixtures.ts";
import { buildAndOpen, makeHome, startServe } from "./harness.ts";

// Seam 2: parts outside the spotlight are faded on the page, in both views.
// The flake pipeline's chapter 2 reveals updater, main, upstream and pr, and
// plays h-updater-pr, so h-main-updater is drawn but not played. Its last
// chapter has four flows, f-stale among them, and "All flows" fades nothing.

const faded = { line: "0.25", structure: "0.5" } as const;

const views = ["iso", "plan"] as const;

const hop = (id: string) => `[data-hop="${id}"]`;

const structure = (id: string) => `[data-structure="${id}"]`;

const openChapter = Effect.fnUntraced(function* (page: Page, id: string) {
  yield* Effect.promise(() =>
    page.locator(`[data-chapter-rail] button[data-chapter="${id}"]`).click()
  );
  yield* Effect.promise(() =>
    page.locator(`[data-walkthrough][data-chapter="${id}"]`).waitFor()
  );
  // Pause, so packets stay off the lines and hops can be pointed at.
  yield* Effect.promise(() =>
    page.locator('[data-playback-controls] [data-control="pause"]').click()
  );
});

/**
 * Waits for the page to mark `selector` with `data-faded="<expected>"`. The
 * page applies a hover in a later task than the pointer event, so reading
 * the mark straight after the event can come too early.
 */
const waitForFaded = (
  page: Page,
  selector: string,
  expected: "true" | "false"
) =>
  Effect.promise(() =>
    page.waitForFunction(
      `document.querySelector(${literal(selector)})?.getAttribute("data-faded") === "${expected}"`,
      undefined,
      { timeout: 5000 }
    )
  );

/** Waits out the opacity transition, then returns the computed opacity. */
const opacityOf = Effect.fnUntraced(function* (
  page: Page,
  selector: string,
  expected: string
) {
  const opacity = `getComputedStyle(document.querySelector(${literal(selector)})).opacity`;

  yield* Effect.promise(() =>
    page.waitForFunction(
      `document.querySelector(${literal(selector)}) !== null && ${opacity} === ${literal(expected)}`
    )
  );

  return yield* Effect.promise(() => page.evaluate<string>(opacity));
});

/** Waits until nothing on the map is faded. */
const waitForNothingFaded = (page: Page) =>
  Effect.promise(() =>
    page.waitForFunction(
      "document.querySelector('[data-faded=\"true\"]') === null"
    )
  );

const styleOf = (page: Page, selector: string, property: string) =>
  Effect.promise(() =>
    page.evaluate<string>(
      `getComputedStyle(document.querySelector(${literal(selector)})).${property}`
    )
  );

/** The hop is inside the spotlight, at full strength. */
const assertInside = Effect.fnUntraced(function* (page: Page, hopId: string) {
  yield* waitForFaded(page, hop(hopId), "false");
  assert.strictEqual(yield* opacityOf(page, hop(hopId), "1"), "1", hopId);
});

/** The hop is outside the spotlight, at the faded strength. */
const assertOutside = Effect.fnUntraced(function* (page: Page, hopId: string) {
  yield* waitForFaded(page, hop(hopId), "true");
  assert.strictEqual(
    yield* opacityOf(page, hop(hopId), faded.line),
    faded.line,
    hopId
  );
});

const assertStructureInside = Effect.fnUntraced(function* (
  page: Page,
  id: string
) {
  yield* waitForFaded(page, structure(id), "false");
  assert.strictEqual(yield* opacityOf(page, structure(id), "1"), "1", id);
});

const assertStructureOutside = Effect.fnUntraced(function* (
  page: Page,
  id: string
) {
  yield* waitForFaded(page, structure(id), "true");
  assert.strictEqual(
    yield* opacityOf(page, structure(id), faded.structure),
    faded.structure,
    id
  );
});

/** The ends of the first flow's hops, which the first packet walks. */
const ends = new Map<string, readonly [string, string]>([
  ["h-main-updater", ["main", "updater"]],
  ["h-upstream-updater", ["upstream", "updater"]],
  ["h-updater-pr", ["updater", "pr"]],
  ["h-pr-build", ["pr", "build"]],
  ["h-attic-build", ["attic", "build"]],
  ["h-build-attic", ["build", "attic"]],
  ["h-pr-checks", ["pr", "checks"]],
  ["h-pr-scope", ["pr", "scope"]],
  ["h-blocked-scope", ["blocked", "scope"]],
  ["h-build-ruleset", ["build", "ruleset"]],
  ["h-checks-ruleset", ["checks", "ruleset"]],
  ["h-scope-ruleset", ["scope", "ruleset"]],
  ["h-ruleset-main", ["ruleset", "main"]],
]);

const pipelinePage = Effect.gen(function* () {
  return yield* buildAndOpen(yield* pipelineMap, "flake-pipeline");
});

/** Points at a hop. Packets move over lines, so the event is dispatched. */
const pointAtHop = (page: Page, id: string) =>
  Effect.promise(() => page.locator(hop(id)).dispatchEvent("pointerover"));

const pointAway = (page: Page) =>
  Effect.promise(() => page.locator("header").hover());

describe("the spotlight of a chapter", () => {
  it.live(
    "fades the hops it only shows, and their ends, in both views",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { page, errors } = yield* pipelinePage;

          yield* openChapter(page, "c-pr");

          for (const view of views) {
            yield* showView(page, view);
            yield* assertInside(page, "h-updater-pr");
            yield* assertOutside(page, "h-main-updater");
            yield* assertOutside(page, "h-upstream-updater");
            yield* assertStructureInside(page, "updater");
            yield* assertStructureInside(page, "pr");
            yield* assertStructureOutside(page, "main");

            // The name tag follows its structure. Its border and text fade to
            // the hop strength, and its fill stays opaque so it still masks
            // the lines behind it.
            const tag = '[data-name-tag="main"]';

            assert.strictEqual(
              yield* opacityOf(page, `${tag} text`, faded.line),
              faded.line
            );
            assert.strictEqual(
              yield* styleOf(page, `${tag} rect`, "strokeOpacity"),
              faded.line
            );
            assert.strictEqual(
              yield* styleOf(page, `${tag} rect`, "fillOpacity"),
              "1"
            );
            assert.strictEqual(yield* styleOf(page, tag, "opacity"), "1");

            yield* waitForFaded(page, '[data-name-tag="main"]', "true");
            yield* waitForFaded(page, '[data-name-tag="pr"]', "false");
          }

          assert.deepStrictEqual(errors, []);
        })
      ),
    120_000
  );
});

describe("the spotlight of a picked flow", () => {
  it.live(
    'fades every hop outside the flow, and nothing for a chapter that plays every hop it draws, plays nothing, or plays "All flows"',
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { page } = yield* pipelinePage;

          // The opening chapter plays every hop it draws.
          yield* Effect.promise(() =>
            page.locator(hop("h-main-updater")).waitFor()
          );
          assert.strictEqual(
            yield* Effect.promise(() =>
              page.locator('[data-faded="true"]').count()
            ),
            0,
            "the opening chapter"
          );

          // The last chapter plays nothing, so nothing carries a fade at all.
          yield* openChapter(page, "c-all");
          assert.strictEqual(
            yield* Effect.promise(() => page.locator("[data-faded]").count()),
            0,
            "a chapter that plays nothing"
          );

          for (const view of views) {
            yield* showView(page, view);

            yield* Effect.promise(() =>
              page.locator('[data-flow="all"]').click()
            );
            assert.strictEqual(
              yield* Effect.promise(() => page.locator("[data-faded]").count()),
              0,
              `${view}: all flows`
            );

            yield* Effect.promise(() =>
              page.locator('[data-flow="f-stale"]').click()
            );
            yield* assertInside(page, "h-main-watchdog");
            yield* assertOutside(page, "h-pr-build");
            yield* assertStructureInside(page, "watchdog");
            yield* assertStructureOutside(page, "build");
          }
        })
      ),
    120_000
  );
});

describe("the spotlight of a hovered item", () => {
  it.live(
    "holds a hovered hop and its two structures, and gives back on leaving",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { page } = yield* pipelinePage;

          yield* openChapter(page, "c-all");

          for (const view of views) {
            yield* showView(page, view);
            yield* pointAtHop(page, "h-pr-build");
            yield* assertInside(page, "h-pr-build");
            yield* assertOutside(page, "h-main-updater");
            yield* assertStructureInside(page, "pr");
            yield* assertStructureInside(page, "build");
            yield* assertStructureOutside(page, "updater");

            yield* Effect.promise(() =>
              page.locator(hop("h-pr-build")).dispatchEvent("pointerout")
            );
            yield* waitForNothingFaded(page);
          }
        })
      ),
    120_000
  );

  it.live(
    "holds a hovered structure, its hops and their other ends, over a picked flow",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { page } = yield* pipelinePage;

          yield* openChapter(page, "c-all");
          yield* Effect.promise(() =>
            page.locator('[data-flow="f-stale"]').click()
          );

          for (const view of views) {
            yield* showView(page, view);
            yield* Effect.promise(() =>
              page.locator(structure("updater")).hover()
            );
            yield* assertInside(page, "h-main-updater");
            yield* assertOutside(page, "h-pr-build");
            yield* assertStructureInside(page, "updater");
            yield* assertStructureInside(page, "main");
            yield* assertStructureOutside(page, "build");

            // Back to the picked flow.
            yield* pointAway(page);
            yield* assertInside(page, "h-main-watchdog");
            yield* assertOutside(page, "h-main-updater");
          }
        })
      ),
    120_000
  );
});

describe("the spotlight of a focused structure", () => {
  it.live("follows keyboard focus as it follows the pointer", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* pipelinePage;

        yield* openChapter(page, "c-all");
        // A key press makes the next focus a keyboard one.
        yield* Effect.promise(() => page.keyboard.press("Shift"));
        yield* Effect.promise(() => page.locator(structure("updater")).focus());
        yield* assertInside(page, "h-main-updater");
        yield* assertOutside(page, "h-pr-build");
        yield* assertStructureInside(page, "main");

        yield* Effect.promise(() => page.locator(structure("updater")).blur());
        yield* waitForNothingFaded(page);
      })
    )
  );
});

describe("a faded structure", () => {
  it.live("stays fainter than the rest while it is dragged", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const root = yield* makeHome(yield* pipelineMap);

        const serve = yield* startServe(
          path.join(root, "flake-pipeline", "map"),
          ["--port", "0"]
        );

        const { page } = yield* openUrl(serve.url);

        yield* Effect.promise(() =>
          page.setViewportSize({ width: 1280, height: 800 })
        );

        yield* openChapter(page, "c-pr");
        yield* assertStructureOutside(page, "main");
        // No transition, so the opacity read is the settled one.
        yield* Effect.promise(() =>
          page.emulateMedia({ reducedMotion: "reduce" })
        );

        // Shift-click puts main and pr in one set, so dragging pr moves the
        // faded main with it.
        for (const id of ["main", "pr"]) {
          yield* Effect.promise(() =>
            page.locator(structure(id)).click({ modifiers: ["Shift"] })
          );
        }

        const box = yield* Effect.promise(() =>
          page.locator(structure("pr")).boundingBox()
        );

        const from = {
          x: (box?.x ?? 0) + (box?.width ?? 0) / 2,
          y: (box?.y ?? 0) + (box?.height ?? 0) / 2,
        };

        yield* Effect.promise(() => page.mouse.move(from.x, from.y));
        yield* Effect.promise(() => page.mouse.down());
        yield* Effect.promise(() =>
          page.mouse.move(from.x, from.y + 40, { steps: 8 })
        );
        yield* Effect.promise(() =>
          page.waitForFunction(
            `document.querySelectorAll("[data-structure][data-drag-shifted]").length === 2`
          )
        );
        yield* waitForFaded(page, structure("main"), "true");

        const opacity = (id: string) =>
          styleOf(page, structure(id), "opacity").pipe(Effect.map(Number));

        const dragged = yield* opacity("pr");
        const fadedAndDragged = yield* opacity("main");

        assert.isBelow(dragged, 1, "a dragged structure is see-through");
        assert.isBelow(fadedAndDragged, dragged, "the fade still shows");
        assert.isAbove(fadedAndDragged, 0);

        yield* Effect.promise(() => page.mouse.up());
      }).pipe(Effect.provide(NodeServices.layer))
    )
  );
});

describe("the spotlight of a pinned item", () => {
  it.live(
    "holds the selected structure, its hops and their other ends, until cleared",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { page } = yield* pipelinePage;

          yield* openChapter(page, "c-all");

          for (const view of views) {
            yield* showView(page, view);
            yield* Effect.promise(() =>
              page.locator(structure("updater")).click()
            );
            yield* pointAway(page);
            yield* assertInside(page, "h-main-updater");
            yield* assertOutside(page, "h-pr-build");
            yield* assertStructureInside(page, "main");
            yield* assertStructureOutside(page, "build");

            yield* Effect.promise(() => page.keyboard.press("Escape"));
            yield* waitForNothingFaded(page);
          }
        })
      ),
    120_000
  );

  it.live(
    "holds the selected packet's hop and its two structures until deselected",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { page } = yield* pipelinePage;

          yield* openChapter(page, "c-all");

          for (const view of views) {
            yield* showView(page, view);
            yield* Effect.promise(() =>
              page
                .locator('[data-playback-controls] [data-control="step"]')
                .click()
            );

            const pinned = yield* attributeOf(
              page,
              "[data-packet-panel]",
              "data-packet-panel"
            );

            assert.isNotNull(pinned);

            const [first, second] = ends.get(pinned ?? "") ?? [];

            assert.isDefined(first, `${pinned} is a hop of the first flow`);
            assert.isDefined(second);
            yield* assertStructureInside(page, first ?? "");
            yield* assertStructureInside(page, second ?? "");

            yield* assertInside(page, pinned ?? "");
            yield* assertOutside(
              page,
              pinned === "h-pr-build" ? "h-main-updater" : "h-pr-build"
            );
          }
        })
      ),
    120_000
  );
});

describe("faded parts", () => {
  it.live(
    "still take hover and click, so the reader can move the spotlight",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { page } = yield* pipelinePage;

          yield* openChapter(page, "c-pr");

          for (const view of views) {
            yield* showView(page, view);
            yield* assertOutside(page, "h-main-updater");

            yield* pointAtHop(page, "h-main-updater");
            yield* assertInside(page, "h-main-updater");

            yield* Effect.promise(() =>
              page.locator(hop("h-main-updater")).dispatchEvent("pointerout")
            );
            yield* assertOutside(page, "h-main-updater");

            yield* assertStructureOutside(page, "main");
            yield* Effect.promise(() =>
              page.locator(structure("main")).click()
            );
            yield* pointAway(page);
            yield* assertStructureInside(page, "main");

            assert.strictEqual(
              yield* attributeOf(page, structure("main"), "data-selected"),
              "true"
            );
            yield* assertOutside(page, "h-updater-pr");

            yield* Effect.promise(() => page.keyboard.press("Escape"));
          }
        })
      ),
    120_000
  );

  it.live("don't transition when the system asks for reduced motion", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* pipelinePage;

        yield* openChapter(page, "c-pr");
        yield* assertOutside(page, "h-main-updater");

        // The opacity at the moment the spotlight takes the hop in, read as
        // the page marks it: mid-change it is still faded.
        const opacityOnHover = Effect.fnUntraced(function* () {
          const read = Effect.promise(() =>
            page.evaluate<string>(
              `new Promise((resolve) => {
                const line = document.querySelector(${literal(hop("h-main-updater"))});
                new MutationObserver((_, observer) => {
                  if (line.getAttribute("data-faded") === "false") {
                    observer.disconnect();
                    resolve(getComputedStyle(line).opacity);
                  }
                }).observe(line, { attributes: true });
              })`
            )
          );

          const [opacity] = yield* Effect.all(
            [read, pointAtHop(page, "h-main-updater")],
            { concurrency: "unbounded" }
          );

          yield* Effect.promise(() =>
            page.locator(hop("h-main-updater")).dispatchEvent("pointerout")
          );
          yield* assertOutside(page, "h-main-updater");

          return opacity;
        });

        assert.notStrictEqual(yield* opacityOnHover(), "1", "with motion");

        yield* Effect.promise(() =>
          page.emulateMedia({ reducedMotion: "reduce" })
        );
        assert.strictEqual(yield* opacityOnHover(), "1", "reduced motion");
      })
    )
  );
});

describe("an export", () => {
  it.live("draws the pinned spotlight as it is on screen", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const { page } = yield* pipelinePage;

        yield* openChapter(page, "c-all");
        yield* Effect.promise(() => page.locator(structure("updater")).click());
        yield* Effect.promise(() =>
          page.locator('[data-control="export"]').click()
        );

        const [download] = yield* Effect.promise(() =>
          Promise.all([
            page.waitForEvent("download"),
            page.locator('[data-export-item="svg"]').click(),
          ])
        );

        const text = yield* fs.readFileString(
          yield* Effect.promise(() => download.path())
        );

        assert.match(
          text,
          /id="flake-pipeline-iso-chapter-8-hop-h-main-updater"[^>]* data-faded="false"/u
        );
        assert.match(
          text,
          /id="flake-pipeline-iso-chapter-8-hop-h-pr-build"[^>]* data-faded="true"[^>]* opacity="0.25"/u
        );
        assert.match(
          text,
          /id="flake-pipeline-iso-chapter-8-structure-build"[^>]* data-faded="true"[^>]* opacity="0.5"/u
        );
      }).pipe(Effect.provide(NodeServices.layer))
    )
  );
});
