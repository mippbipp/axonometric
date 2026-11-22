import {
  defaultSpotFor,
  Layout,
  MapData,
  proposalProblems,
} from "@axonometric/contracts";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect, Schema } from "effect";
import type { Page } from "playwright";

import {
  click,
  goToChapterPaused,
  inPage,
  openUrl,
  waitFor,
} from "./browser.ts";
import { pipelineMap } from "./fixtures.ts";
import { makeHome, mapIn, startServe } from "./harness.ts";

// The add form on a map big enough that finding a spot for a new structure
// takes seconds: the flake pipeline, with 15 structures, 29 hops and 8
// chapters. Every change to the name moves the spot, because the name sets
// the width of the name tag, so the search runs again for each keystroke.
//
// A slow runner slows every keystroke, so the test doesn't hold one to a
// fixed time. It types the same keys into the Flows tab's name field, which
// checks nothing as it changes, and holds the add form's slowest keystroke to
// a factor of that one's. Measured on a 2-core Linux machine, the Flows
// field's slowest keystroke took 20 to 35 ms to paint, the add form's 20 to
// 60 ms once the search left the main thread, and over 13 s before.

/** The add form's slowest keystroke may be this many times the baseline's. */
const factor = 5;

/**
 * Added to the allowance, so a baseline of a few milliseconds isn't a limit
 * of tens. Drawing one chapter of this map takes about 550 ms here, so a
 * keystroke that waits on even one chapter's drawing goes over.
 */
const floorMillis = 250;

/** What the test types into each field. */
const keys = "cache";

/**
 * Runs before the page's own scripts. For each key pressed it records how
 * long the page took from the keydown to its next frame, which is how long
 * the keystroke held the page.
 */
const timeKeys = `
globalThis.keyFrames = [];
addEventListener("keydown", () => {
  const at = performance.now();
  globalThis.keyFrames.push(
    new Promise((done) => requestAnimationFrame(() => done(performance.now() - at)))
  );
}, { capture: true });
`;

/**
 * Runs before the page's own scripts. It records the name field's value each
 * time the hint stops saying a spot is being found, so a test can tell which
 * names the form showed a spot for.
 */
const recordSettles = `
globalThis.settledFor = [];
new MutationObserver(() => {
  const hint = document.querySelector("[data-add-hint]");
  const finding = hint !== null && hint.hasAttribute("data-finding");
  if (globalThis.wasFinding === true && !finding && hint !== null) {
    globalThis.settledFor.push(document.querySelector('[data-add="name"]').value);
  }
  globalThis.wasFinding = finding;
}).observe(document, { attributes: true, childList: true, subtree: true });
`;

/** Runs before the page's own scripts, so the page finds no workers. */
const noWorkers = "delete globalThis.Worker;";

/**
 * Runs before the page's own scripts. It records when the add form's worker
 * answers, and when Cancel is clicked, on the page's clock.
 */
const recordAnswers = `
globalThis.draftAnswers = [];
const PageWorker = globalThis.Worker;
globalThis.Worker = class extends PageWorker {
  constructor(url, options) {
    super(url, options);
    if (options?.name === "add form check") {
      this.addEventListener("message", () => {
        globalThis.draftAnswers.push(performance.now());
      });
    }
  }
};
`;

/**
 * Runs before the page's own scripts. It records when Cancel is clicked and
 * every long task, on the page's clock.
 */
const recordCancel = `
globalThis.longTasks = [];
new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    globalThis.longTasks.push({ at: entry.startTime, duration: entry.duration });
  }
}).observe({ type: "longtask" });
addEventListener("click", (event) => {
  if (event.target instanceof Element && event.target.closest('[data-add="cancel"]') !== null) {
    globalThis.cancelledAt = performance.now();
  }
}, { capture: true });
`;

/**
 * How long a test waits after Cancel for the search to show it kept going.
 * A search for a new name here answers its spot about 4.5 s after it starts
 * in the worker, and an in-page one draws a chapter about every 550 ms.
 */
const afterCancel = "10 seconds";

/**
 * Opens the form, types a name and cancels the form while the search for it
 * is still running.
 */
const cancelMidSearch = Effect.fnUntraced(function* (page: Page) {
  yield* openForm(page);
  yield* settled(page);
  yield* Effect.promise(() =>
    page.locator('[data-add="name"]').fill(typedName)
  );
  yield* Effect.sleep("1 second");

  const finding = yield* inPage<boolean>(
    page,
    `document.querySelector("[data-add-hint][data-finding]") !== null`
  );

  assert.isTrue(finding, "the search was still running at Cancel");
  yield* click(page, '[data-add="cancel"]');
  yield* Effect.promise(() =>
    page
      .locator("[data-add-structure]")
      .waitFor({ state: "detached", timeout: 15_000 })
  );
  yield* Effect.sleep(afterCancel);
});

const served = (initScript: string) =>
  Effect.gen(function* () {
    const pipelineMapFiles = yield* pipelineMap;
    const root = yield* makeHome(pipelineMapFiles);
    const { home } = mapIn(root, "flake-pipeline");
    const serve = yield* startServe(home, ["--port", "0"]);
    const { errors, page } = yield* openUrl(serve.url, { initScript });

    yield* Effect.promise(() =>
      page.setViewportSize({ height: 900, width: 1600 })
    );

    return { errors, page };
  }).pipe(Effect.provide(NodeServices.layer));

const decodeData = Schema.decodeUnknownEffect(
  Schema.Struct({ default: MapData })
);

const decodeLayout = Schema.decodeUnknownEffect(
  Schema.Struct({ default: Layout })
);

/** The flake pipeline's data and layout, as the page loads them. */
const pipelineState = Effect.gen(function* () {
  const folder = new URL("fixtures/flake-pipeline/map/", import.meta.url);

  const dataModule: unknown = yield* Effect.promise(
    () => import(new URL("data.mjs", folder).href)
  );
  const { default: data } = yield* decodeData(dataModule);

  const layoutModule: unknown = yield* Effect.promise(
    () =>
      import(new URL("layout.json", folder).href, {
        with: { type: "json" },
      })
  );
  const { default: layout } = yield* decodeLayout(layoutModule);

  return { data, layout };
}).pipe(Effect.orDie);

/** Opens the add form on the whole pipeline. */
const openForm = Effect.fnUntraced(function* (page: Page) {
  yield* goToChapterPaused(page, "c-all");
  yield* click(page, '[data-control="add-structure"]');
  yield* waitFor(page, "[data-add-structure]");
});

/** Waits until the form has found its spot and checked it. */
const settled = (page: Page) =>
  Effect.promise(() =>
    page
      .locator(
        "[data-add-structure]:not([data-checking]) [data-add-hint]:not([data-finding])"
      )
      .waitFor({ timeout: 120_000 })
  );

/** The x and y the form shows. */
const shownSpot = Effect.fnUntraced(function* (page: Page) {
  const x = yield* Effect.promise(() =>
    page.locator('[data-add="x"]').inputValue()
  );
  const y = yield* Effect.promise(() =>
    page.locator('[data-add="y"]').inputValue()
  );

  return { x: Number(x), y: Number(y) };
});

/**
 * Where `defaultSpotFor` puts a box called `name` in the first group, and
 * the warnings `check` would then report, as the panel words them.
 */
const expectedFor = Effect.fnUntraced(function* (name: string) {
  const { data, layout } = yield* pipelineState;
  const group = data.groups[0]?.id ?? "";
  const { spot } = defaultSpotFor({ data, group, layout, name, shape: "box" });

  const problems = proposalProblems({
    before: { data, layout },
    items: [
      {
        change: {
          action: "add",
          at: spot,
          structure: {
            group,
            id: "draft-structure",
            name,
            shape: "box",
            status: "planned",
          },
        },
        id: "preview",
        kind: "structure",
      },
    ],
  });

  return {
    spot: { x: spot.x, y: spot.y },
    warnings: Arr.map(problems, ({ problem }) => problem.message),
  };
});

/** The name the tests type, a letter first and then the rest. */
const firstLetter = "B";

const rest = "uild cache";

const typedName = `${firstLetter}${rest}`;

/** The spot the form shows, and the warnings in the panel. */
const shown = Effect.fnUntraced(function* (page: Page) {
  const spot = yield* shownSpot(page);

  const warnings = yield* inPage<ReadonlyArray<string>>(
    page,
    `[...document.querySelectorAll("[data-drag-warning] [data-warning-message]")].map((item) => item.textContent)`
  );

  return { spot, warnings };
});

/**
 * Types `keys` into the field `selector`, as a person types, and gives the
 * longest any keystroke held the page, in milliseconds.
 */
const slowestKey = Effect.fnUntraced(function* (page: Page, selector: string) {
  const field = page.locator(selector);

  yield* Effect.promise(() => field.click());
  yield* inPage(page, "globalThis.keyFrames.splice(0).length");
  yield* Effect.promise(() => page.keyboard.type(keys, { delay: 80 }));

  const times = yield* inPage<ReadonlyArray<number>>(
    page,
    "Promise.all(globalThis.keyFrames.splice(0))"
  );

  const typed = yield* Effect.promise(() => field.inputValue());

  assert.strictEqual(typed, keys, selector);
  assert.lengthOf(times, keys.length, selector);

  return Arr.reduce(times, 0, Math.max);
});

describe("the add form on a big map", () => {
  it.live(
    "keeps painting every keystroke of a new structure's name",
    () =>
      Effect.gen(function* () {
        const { errors, page } = yield* served(timeKeys);

        yield* goToChapterPaused(page, "c-all");
        yield* click(page, '[data-tab="flows"]');
        yield* waitFor(page, "[data-flows-tab]");

        const baseline = yield* slowestKey(page, "[data-new-flow-name]");

        yield* click(page, '[data-control="add-structure"]');
        yield* waitFor(page, "[data-add-structure]");
        yield* settled(page);

        const slowest = yield* slowestKey(page, '[data-add="name"]');
        const allowed = baseline * factor + floorMillis;

        assert.isAtMost(
          slowest,
          allowed,
          `a keystroke held the page for ${Math.round(slowest)} ms, where the Flows tab's name field took ${Math.round(baseline)} ms`
        );
        assert.deepStrictEqual(errors, []);
      }).pipe(Effect.provide(NodeServices.layer)),
    240_000
  );

  it.live(
    "shows the spot for the name as typed, never for a name typed over, with workers or without",
    () =>
      Effect.gen(function* () {
        // Worked out once, since it takes as long as the page's own search.
        const wanted = yield* expectedFor(typedName);

        const typing = yield* served(recordSettles);
        const name = typing.page.locator('[data-add="name"]');

        yield* openForm(typing.page);
        yield* settled(typing.page);
        yield* inPage(typing.page, "globalThis.settledFor.splice(0).length");
        yield* Effect.promise(() => name.click());
        yield* Effect.promise(() => typing.page.keyboard.type(firstLetter));
        // Long enough that the search for the first letter has started drawing.
        yield* Effect.sleep("1 second");
        yield* Effect.promise(() =>
          typing.page.keyboard.type(rest, { delay: 40 })
        );
        yield* settled(typing.page);

        const settledFor = yield* inPage<ReadonlyArray<string>>(
          typing.page,
          "globalThis.settledFor"
        );

        assert.deepStrictEqual(settledFor, [typedName]);

        const typed = yield* shown(typing.page);

        assert.deepStrictEqual(typed, wanted, "with workers");

        const proposeDisabled = yield* Effect.promise(() =>
          typing.page.locator('[data-add="submit"]').isDisabled()
        );

        assert.isFalse(proposeDisabled);
        assert.deepStrictEqual(typing.errors, []);

        const workerless = yield* served(noWorkers);

        yield* openForm(workerless.page);
        yield* Effect.promise(() =>
          workerless.page.locator('[data-add="name"]').fill(typedName)
        );
        yield* settled(workerless.page);

        const filled = yield* shown(workerless.page);

        assert.deepStrictEqual(filled, wanted, "with no workers");
        assert.deepStrictEqual(workerless.errors, []);
      }).pipe(Effect.provide(NodeServices.layer)),
    240_000
  );

  it.live(
    "stops finding a spot once the form is cancelled, in a worker",
    () =>
      Effect.gen(function* () {
        const { errors, page } = yield* served(
          `${recordAnswers}${recordCancel}`
        );

        yield* cancelMidSearch(page);

        const late = yield* inPage<ReadonlyArray<number>>(
          page,
          "globalThis.draftAnswers.filter((at) => at > globalThis.cancelledAt)"
        );

        assert.deepStrictEqual(late, [], "the worker answered after Cancel");
        assert.deepStrictEqual(errors, []);
      }).pipe(Effect.provide(NodeServices.layer)),
    240_000
  );

  it.live(
    "stops finding a spot once the form is cancelled, on a page with no workers",
    () =>
      Effect.gen(function* () {
        const { errors, page } = yield* served(`${noWorkers}${recordCancel}`);

        yield* cancelMidSearch(page);

        // The search on the page draws a chapter per long task, so a search
        // that kept going shows here. The page settles within a second of
        // closing the form, and with playback paused it then runs nothing.
        const late = yield* inPage<ReadonlyArray<number>>(
          page,
          "globalThis.longTasks.filter(({ at }) => at > globalThis.cancelledAt + 1000).map(({ duration }) => Math.round(duration))"
        );

        assert.deepStrictEqual(late, [], "long tasks after Cancel");
        assert.deepStrictEqual(errors, []);
      }).pipe(Effect.provide(NodeServices.layer)),
    240_000
  );
});
