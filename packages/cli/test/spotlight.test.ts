import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem } from "effect";
import type { Page } from "playwright";

import { literal } from "./browser.ts";
import { pipelineMap } from "./fixtures.ts";
import { buildAndOpen } from "./harness.ts";

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

const showView = Effect.fnUntraced(function* (
  page: Page,
  view: (typeof views)[number]
) {
  yield* Effect.promise(() =>
    page.locator(`[data-view-toggle] [data-view="${view}"]`).click()
  );
  yield* Effect.promise(() =>
    page.locator(`[data-walkthrough][data-view="${view}"]`).waitFor()
  );
});

const attribute = (page: Page, selector: string, name: string) =>
  Effect.promise(() => page.locator(selector).first().getAttribute(name));

/**
 * Asserts that the page marks `selector` with `data-faded="<expected>"`. The
 * page applies a hover in a later task than the pointer event, so it waits
 * up to 5 s for the mark first, then asserts on what's there.
 */
const assertFaded = Effect.fnUntraced(function* (
  page: Page,
  selector: string,
  expected: "true" | "false"
) {
  yield* Effect.ignore(
    Effect.tryPromise(() =>
      page.waitForFunction(
        `document.querySelector(${literal(selector)})?.getAttribute("data-faded") === ${literal(expected)}`,
        undefined,
        { timeout: 5000 }
      )
    )
  );

  assert.strictEqual(
    yield* attribute(page, selector, "data-faded"),
    expected,
    selector
  );
});

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
  yield* assertFaded(page, hop(hopId), "false");
  assert.strictEqual(yield* opacityOf(page, hop(hopId), "1"), "1", hopId);
});

/** The hop is outside the spotlight, at the faded strength. */
const assertOutside = Effect.fnUntraced(function* (page: Page, hopId: string) {
  yield* assertFaded(page, hop(hopId), "true");
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
  yield* assertFaded(page, structure(id), "false");
  assert.strictEqual(yield* opacityOf(page, structure(id), "1"), "1", id);
});

const assertStructureOutside = Effect.fnUntraced(function* (
  page: Page,
  id: string
) {
  yield* assertFaded(page, structure(id), "true");
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

            yield* assertFaded(page, '[data-name-tag="main"]', "true");
            yield* assertFaded(page, '[data-name-tag="pr"]', "false");
          }

          assert.deepStrictEqual(errors, []);
        })
      ),
    120_000
  );

  it.live("fades nothing in a chapter that plays every hop it draws", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* pipelinePage;

        yield* Effect.promise(() =>
          page.locator(hop("h-main-updater")).waitFor()
        );

        assert.strictEqual(
          yield* Effect.promise(() =>
            page.locator('[data-faded="true"]').count()
          ),
          0
        );
      })
    )
  );

  it.live("looks as it did before when it plays nothing", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { page } = yield* pipelinePage;

        yield* openChapter(page, "c-all");

        assert.strictEqual(
          yield* Effect.promise(() => page.locator("[data-faded]").count()),
          0
        );
      })
    )
  );
});

describe("the spotlight of a picked flow", () => {
  it.live(
    'fades every hop outside the flow, and "All flows" fades nothing',
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { page } = yield* pipelinePage;

          yield* openChapter(page, "c-all");

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
  it.live(
    "multiplies the fade into the see-through looks of a drag and a ghost",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { page } = yield* pipelinePage;

          yield* openChapter(page, "c-pr");
          yield* assertStructureOutside(page, "main");

          const mark = (name: string, value: string) =>
            Effect.promise(() =>
              page.evaluate(
                `document.querySelector(${literal(structure("main"))}).setAttribute(${literal(name)}, ${literal(value)})`
              )
            );

          yield* mark("data-drag-shifted", "");
          assert.strictEqual(
            yield* opacityOf(page, structure("main"), "0.275"),
            "0.275"
          );

          yield* Effect.promise(() =>
            page.evaluate(
              `document.querySelector(${literal(structure("main"))}).removeAttribute("data-drag-shifted")`
            )
          );
          yield* mark("data-compare", "removed");
          assert.strictEqual(
            yield* opacityOf(page, structure("main"), "0.225"),
            "0.225"
          );
        })
      ),
    60_000
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

            const pinned = yield* attribute(
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

            assert.strictEqual(
              yield* attribute(page, structure("main"), "data-selected"),
              "true"
            );
            yield* assertStructureInside(page, "main");
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

        const duration = () =>
          Effect.promise(() =>
            page.evaluate<string>(
              `getComputedStyle(document.querySelector(${literal(hop("h-main-updater"))})).transitionDuration`
            )
          );

        assert.strictEqual(yield* duration(), "0.12s, 0.12s");

        yield* Effect.promise(() =>
          page.emulateMedia({ reducedMotion: "reduce" })
        );
        assert.strictEqual(yield* duration(), "0s");
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
