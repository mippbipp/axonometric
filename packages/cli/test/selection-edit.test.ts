import { Proposals } from "@axonometric/contracts";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import {
  Array as Arr,
  Effect,
  FileSystem,
  Option,
  Path,
  Record as Rec,
  Schema,
} from "effect";
import type { Page } from "playwright";

import { openPage, openUrl } from "./browser.ts";
import { fullMap } from "./fixtures.ts";
import { makeHome, runCli, startServe } from "./harness.ts";

// Selecting several structures in a page that a real serve serves, and
// moving, nudging, aligning, distributing, undoing and redoing them. The
// review map has engineer, page, server, proposals, pull-request and
// upstream at 0,0, 4,0, 8,0, 8,6, 12,6 and 18,0; the first chapter shows
// engineer and page.

type View = "iso" | "plan";

const waitTimeout = { timeout: 15_000 };

const decodeProposals = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Proposals)
);

const served = Effect.gen(function* () {
  const path = yield* Path.Path;
  const root = yield* makeHome(yield* fullMap);
  const home = path.join(root, "review", "map");
  const serve = yield* startServe(home, ["--port", "0"]);
  const opened = yield* openUrl(serve.url);

  yield* Effect.promise(() =>
    opened.page.setViewportSize({ width: 1280, height: 800 })
  );

  return { root, home, serve, ...opened };
}).pipe(Effect.provide(NodeServices.layer));

/** The served review map, open in its last chapter, which shows everything. */
const servedAll = Effect.gen(function* () {
  const opened = yield* served;

  yield* Effect.promise(() =>
    opened.page
      .locator('[data-chapter-rail] button[data-chapter="c-all"]')
      .click()
  );
  yield* Effect.promise(() =>
    opened.page
      .locator('[data-walkthrough][data-chapter="c-all"]')
      .waitFor(waitTimeout)
  );

  return opened;
});

const toView = Effect.fnUntraced(function* (page: Page, view: View) {
  yield* Effect.promise(() =>
    page.locator(`[data-view-toggle] [data-view="${view}"]`).click()
  );
  yield* Effect.promise(() =>
    page.locator(`[data-walkthrough][data-view="${view}"]`).waitFor()
  );
});

/** What proposals.json in `home` holds, or nothing when there's no file. */
const proposalsIn = Effect.fnUntraced(function* (home: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const file = path.join(home, "proposals.json");

  if (!(yield* fs.exists(file))) {
    return Option.none<Proposals>();
  }

  return Option.some(yield* decodeProposals(yield* fs.readFileString(file)));
}, Effect.provide(NodeServices.layer));

/** Waits until proposals.json in `home` is at `revision`, and returns it. */
const waitForRevision = Effect.fnUntraced(function* (
  home: string,
  revision: number
) {
  for (let tries = 0; tries < 150; tries++) {
    const now = yield* proposalsIn(home);

    if (Option.isSome(now) && now.value.revision >= revision) {
      assert.strictEqual(now.value.revision, revision);

      return now.value;
    }

    yield* Effect.sleep("100 millis");
  }

  return assert.fail(`proposals.json never reached revision ${revision}`);
});

const waitFor = (page: Page, selector: string) =>
  Effect.promise(() => page.locator(selector).first().waitFor(waitTimeout));

const waitGone = (page: Page, selector: string) =>
  Effect.promise(() =>
    page
      .locator(selector)
      .first()
      .waitFor({ state: "detached", ...waitTimeout })
  );

const count = (page: Page, selector: string) =>
  Effect.promise(() => page.locator(selector).count());

const attribute = (page: Page, selector: string, name: string) =>
  Effect.promise(() => page.locator(selector).first().getAttribute(name));

const press = (page: Page, key: string) =>
  Effect.promise(() => page.keyboard.press(key));

/** Shift-clicks each structure in turn. */
const shiftClick = Effect.fnUntraced(function* (
  page: Page,
  ids: readonly string[]
) {
  for (const id of ids) {
    yield* Effect.promise(() =>
      page.locator(`[data-structure="${id}"]`).click({ modifiers: ["Shift"] })
    );
  }
});

/** The ids of the structures in the multi-selection, sorted. */
const multiSelectedIds = (page: Page) =>
  Effect.promise(() =>
    page.evaluate<string[]>(
      `[...document.querySelectorAll('[data-structure][data-multi-selected="true"]')].map((e) => e.dataset.structure).sort()`
    )
  );

interface Point {
  readonly x: number;
  readonly y: number;
}

/** Where a ground point is on the page, in window pixels, in `view`. */
const groundToPage = Effect.fnUntraced(function* (
  page: Page,
  view: View,
  ground: Point
) {
  const [left, top, tx, ty, scale] = yield* Effect.promise(() =>
    page.evaluate<number[]>(`(() => {
      const svg = document.querySelector("svg[data-scale]");
      const rect = svg.getBoundingClientRect();
      const [tx, ty, scale] = svg
        .querySelector("[data-viewport]")
        .getAttribute("transform")
        .match(/-?\\d+(?:\\.\\d+)?(?:e-?\\d+)?/g)
        .map(Number);

      return [rect.left, rect.top, tx, ty, scale];
    })()`)
  );

  const sx = view === "plan" ? ground.x * 60 : ((ground.x - ground.y) * 72) / 2;
  const sy = view === "plan" ? ground.y * 60 : ((ground.x + ground.y) * 36) / 2;

  return {
    x: (left ?? 0) + (tx ?? 0) + (scale ?? 1) * sx,
    y: (top ?? 0) + (ty ?? 0) + (scale ?? 1) * sy,
  };
});

/** One grid unit along x or y on screen, at the view's current zoom. */
const unitOnScreen = Effect.fnUntraced(function* (page: Page, view: View) {
  const scale = yield* attribute(page, "svg[data-scale]", "data-scale");

  return (view === "plan" ? 60 : Math.hypot(36, 18)) * Number(scale);
});

/** Holds Shift and drags a box between two ground points on empty canvas. */
const dragBox = Effect.fnUntraced(function* ({
  page,
  view,
  from,
  to,
  release = true,
}: {
  readonly page: Page;
  readonly view: View;
  readonly from: Point;
  readonly to: Point;
  /** Whether to let go at the end. */
  readonly release?: boolean;
}) {
  const start = yield* groundToPage(page, view, from);
  const end = yield* groundToPage(page, view, to);

  yield* Effect.promise(() => page.keyboard.down("Shift"));
  yield* Effect.promise(() => page.mouse.move(start.x, start.y));
  yield* Effect.promise(() => page.mouse.down());
  yield* Effect.promise(() => page.mouse.move(end.x, end.y, { steps: 12 }));

  if (release) {
    yield* Effect.promise(() => page.mouse.up());
    yield* Effect.promise(() => page.keyboard.up("Shift"));
  }
});

const centreOf = Effect.fnUntraced(function* (page: Page, selector: string) {
  const box = yield* Effect.promise(() =>
    page.locator(selector).first().boundingBox()
  );

  assert.isNotNull(box, `${selector} isn't on screen`);

  return box === null
    ? { x: 0, y: 0 }
    : { x: box.x + box.width / 2, y: box.y + box.height / 2 };
});

const dragBy = Effect.fnUntraced(function* (
  page: Page,
  from: Point,
  by: Point
) {
  yield* Effect.promise(() => page.mouse.move(from.x, from.y));
  yield* Effect.promise(() => page.mouse.down());
  yield* Effect.promise(() =>
    page.mouse.move(from.x + by.x, from.y + by.y, { steps: 12 })
  );
  yield* Effect.promise(() => page.mouse.up());
});

/** The changes without their random ids, for comparing what they do. */
const withoutIds = (layout: Proposals["layout"]) =>
  Arr.map(layout, ({ id: _id, ...rest }) => rest);

/** The moves a one-change list holds, as `id -> position`. */
const movesOf = (layout: Proposals["layout"]) => {
  const [change, ...rest] = layout;

  assert.strictEqual(rest.length, 0, "expected exactly one change");
  assert.strictEqual(change?.kind, "move");

  return change?.kind === "move"
    ? Rec.fromEntries(
        Arr.map(
          change.moves,
          ({ target, position }) => [target.id, position] as const
        )
      )
    : {};
};

const views: readonly View[] = ["iso", "plan"];

describe("selecting several structures", () => {
  for (const view of views) {
    it.live(
      `Shift-click adds a structure to the set and takes it out again, in ${view}`,
      () =>
        Effect.gen(function* () {
          const { page, errors } = yield* servedAll;

          yield* toView(page, view);
          yield* shiftClick(page, ["engineer", "page"]);
          assert.deepStrictEqual(yield* multiSelectedIds(page), [
            "engineer",
            "page",
          ]);
          assert.strictEqual(
            yield* count(page, "[data-multi-selection-marker]"),
            2
          );

          yield* shiftClick(page, ["engineer"]);
          assert.deepStrictEqual(yield* multiSelectedIds(page), ["page"]);

          yield* press(page, "Escape");
          assert.deepStrictEqual(yield* multiSelectedIds(page), []);
          assert.deepStrictEqual(errors, []);
        }),
      60_000
    );

    it.live(
      `Shift-dragging a box on empty canvas selects every structure it touches, in ${view}`,
      () =>
        Effect.gen(function* () {
          const { page, home } = yield* servedAll;

          yield* toView(page, view);

          // Ground x -0.3 to 9.5 and y -0.3 to 2.6 reaches engineer, page
          // and server along the top row, and nothing below it.
          yield* dragBox({
            page,
            view,
            from: { x: -0.3, y: 2.6 },
            to: { x: 9.5, y: -0.3 },
            release: false,
          });

          yield* waitFor(page, "[data-selection-box]");
          assert.deepStrictEqual(yield* multiSelectedIds(page), [
            "engineer",
            "page",
            "server",
          ]);

          yield* Effect.promise(() => page.mouse.up());
          yield* Effect.promise(() => page.keyboard.up("Shift"));
          yield* waitGone(page, "[data-selection-box]");

          assert.deepStrictEqual(yield* multiSelectedIds(page), [
            "engineer",
            "page",
            "server",
          ]);
          // Selecting writes nothing.
          assert.isTrue(Option.isNone(yield* proposalsIn(home)));
        }),
      60_000
    );
  }

  it.live("a plain drag on empty canvas still pans and selects nothing", () =>
    Effect.gen(function* () {
      const { page } = yield* servedAll;

      yield* toView(page, "plan");

      const start = yield* groundToPage(page, "plan", { x: -0.3, y: 2.6 });
      const before = yield* attribute(page, "[data-viewport]", "transform");

      yield* dragBy(page, start, { x: 30, y: 20 });

      assert.notStrictEqual(
        yield* attribute(page, "[data-viewport]", "transform"),
        before
      );
      assert.deepStrictEqual(yield* multiSelectedIds(page), []);
    })
  );
});

describe("moving a selection", () => {
  for (const view of views) {
    it.live(
      `dragging one of the set moves all of it as one change, in ${view}`,
      () =>
        Effect.gen(function* () {
          const { page, home } = yield* servedAll;

          yield* toView(page, view);
          yield* shiftClick(page, ["engineer", "page"]);

          const unit = yield* unitOnScreen(page, view);
          const from = yield* centreOf(page, '[data-structure="engineer"]');

          // Straight down the screen is along y in Plan view, and along x
          // and y at once in the Iso view; either way the pair keeps its
          // spacing.
          yield* dragBy(page, from, {
            x: 0,
            y: unit * (view === "plan" ? 4 : 2.5),
          });

          const saved = yield* waitForRevision(home, 1);
          const moves = movesOf(saved.layout);

          assert.hasAllKeys(moves, ["engineer", "page"]);
          assert.strictEqual(
            (moves.page?.x ?? 0) - (moves.engineer?.x ?? 0),
            4
          );
          assert.strictEqual(moves.page?.y, moves.engineer?.y);
          assert.isAbove(moves.engineer?.y ?? 0, 0);
          yield* waitFor(page, '[data-structure="page"][data-pending="true"]');
        }),
      60_000
    );
  }

  it.live(
    "refuses a group drop that puts any footprint on another, and writes nothing",
    () =>
      Effect.gen(function* () {
        const { page, home } = yield* servedAll;

        yield* toView(page, "plan");
        yield* shiftClick(page, ["engineer", "page"]);

        const unit = yield* unitOnScreen(page, "plan");
        const from = yield* centreOf(page, '[data-structure="engineer"]');

        // Eight units right puts engineer at 8,0, on server.
        yield* Effect.promise(() => page.mouse.move(from.x, from.y));
        yield* Effect.promise(() => page.mouse.down());
        yield* Effect.promise(() =>
          page.mouse.move(from.x + unit * 8, from.y, { steps: 12 })
        );

        assert.strictEqual(
          yield* attribute(page, "[data-drag-outline]", "data-refused"),
          "true"
        );
        assert.strictEqual(yield* count(page, "[data-drag-outline]"), 2);

        yield* Effect.promise(() => page.mouse.up());
        yield* waitGone(page, "[data-drag-outline]");
        yield* Effect.sleep("500 millis");

        assert.isTrue(Option.isNone(yield* proposalsIn(home)));
      }),
    60_000
  );
});

describe("nudging a selection", () => {
  for (const view of views) {
    it.live(
      `the arrow keys move the set half a unit along the ground and leave the chapter, in ${view}`,
      () =>
        Effect.gen(function* () {
          const { page, home } = yield* served;

          yield* toView(page, view);
          yield* shiftClick(page, ["engineer", "page"]);

          yield* press(page, "ArrowRight");

          const first = yield* waitForRevision(home, 1);

          assert.deepStrictEqual(movesOf(first.layout), {
            engineer: { x: 0.5, y: 0 },
            page: { x: 4.5, y: 0 },
          });

          // Each press is one change.
          yield* press(page, "ArrowDown");

          const second = yield* waitForRevision(home, 2);

          assert.strictEqual(second.layout.length, 2);
          assert.deepStrictEqual(withoutIds(second.layout)[1], {
            kind: "move",
            moves: [
              {
                target: { kind: "structure", id: "engineer" },
                position: { x: 0.5, y: 0.5 },
              },
              {
                target: { kind: "structure", id: "page" },
                position: { x: 4.5, y: 0.5 },
              },
            ],
          });
          assert.strictEqual(
            yield* attribute(page, "[data-walkthrough]", "data-chapter"),
            "c-page"
          );
        }),
      60_000
    );
  }

  it.live("without a set the arrow keys still change chapter", () =>
    Effect.gen(function* () {
      const { page, home } = yield* served;

      yield* press(page, "ArrowRight");
      yield* waitFor(page, '[data-walkthrough][data-chapter="c-save"]');

      // With a set, they stop doing that.
      yield* shiftClick(page, ["server"]);
      yield* press(page, "ArrowRight");
      yield* waitForRevision(home, 1);
      assert.strictEqual(
        yield* attribute(page, "[data-walkthrough]", "data-chapter"),
        "c-save"
      );

      // Escape empties the set, and the arrows change chapter again.
      yield* press(page, "Escape");
      yield* press(page, "ArrowLeft");
      yield* waitFor(page, '[data-walkthrough][data-chapter="c-page"]');
    })
  );

  it.live(
    "refuses a nudge onto another footprint and writes nothing",
    () =>
      Effect.gen(function* () {
        const { page, home } = yield* servedAll;

        // Engineer ends at x 2 and page starts at 4. Four presses take page
        // to 2, where it only touches engineer along an edge. The fifth
        // would overlap it.
        yield* shiftClick(page, ["page"]);

        for (let presses = 0; presses < 4; presses++) {
          yield* press(page, "ArrowLeft");
        }

        yield* waitForRevision(home, 4);
        yield* press(page, "ArrowLeft");
        yield* waitFor(page, "[data-edit-notice='refused']");
        yield* Effect.sleep("300 millis");

        const saved = yield* proposalsIn(home);

        assert.strictEqual(
          Option.map(saved, ({ revision }) => revision).pipe(Option.getOrNull),
          4
        );
      }),
    60_000
  );
});

describe("aligning and distributing", () => {
  const toolbar = "[data-arrange-toolbar]";

  it.live("shows the arrange toolbar for two or more structures only", () =>
    Effect.gen(function* () {
      const { page } = yield* servedAll;

      yield* shiftClick(page, ["engineer"]);
      assert.strictEqual(yield* count(page, toolbar), 0);

      yield* shiftClick(page, ["page"]);
      yield* waitFor(page, toolbar);

      // Distribute needs three.
      assert.isTrue(
        yield* Effect.promise(() =>
          page.locator("[data-distribute='x']").isDisabled()
        )
      );

      yield* shiftClick(page, ["server"]);
      assert.isFalse(
        yield* Effect.promise(() =>
          page.locator("[data-distribute='x']").isDisabled()
        )
      );
    })
  );

  const cases: readonly {
    readonly name: string;
    readonly view: View;
    readonly ids: readonly string[];
    readonly button: string;
    readonly expected: Readonly<Record<string, Point>>;
  }[] = [
    {
      name: "align top",
      view: "plan",
      ids: ["engineer", "page", "pull-request"],
      button: "[data-align='top']",
      expected: { "pull-request": { x: 12, y: 0 } },
    },
    {
      name: "align bottom",
      view: "iso",
      ids: ["engineer", "page", "pull-request"],
      button: "[data-align='bottom']",
      expected: { engineer: { x: 0, y: 5.5 }, page: { x: 4, y: 5.5 } },
    },
    {
      name: "align centres on y",
      view: "plan",
      ids: ["engineer", "page", "pull-request"],
      button: "[data-align='centre-y']",
      expected: {
        engineer: { x: 0, y: 3 },
        page: { x: 4, y: 3 },
        "pull-request": { x: 12, y: 3 },
      },
    },
    {
      name: "align left",
      view: "iso",
      ids: ["page", "pull-request"],
      button: "[data-align='left']",
      expected: { "pull-request": { x: 4, y: 6 } },
    },
    {
      name: "align right",
      view: "plan",
      ids: ["server", "pull-request"],
      button: "[data-align='right']",
      expected: { server: { x: 12, y: 0 } },
    },
    {
      name: "align centres on x",
      view: "iso",
      ids: ["engineer", "pull-request"],
      button: "[data-align='centre-x']",
      expected: { engineer: { x: 6, y: 0 }, "pull-request": { x: 6, y: 6 } },
    },
    {
      name: "distribute horizontally",
      view: "plan",
      ids: ["engineer", "proposals", "upstream"],
      button: "[data-distribute='x']",
      expected: { proposals: { x: 9, y: 6 } },
    },
    {
      name: "distribute vertically",
      view: "iso",
      ids: ["engineer", "page", "proposals"],
      button: "[data-distribute='y']",
      expected: { page: { x: 4, y: 3 } },
    },
  ];

  for (const { name, view, ids, button, expected } of cases) {
    it.live(
      `${name} is one change with the expected positions, in ${view}`,
      () =>
        Effect.gen(function* () {
          const { page, home } = yield* servedAll;

          yield* toView(page, view);
          yield* shiftClick(page, ids);
          yield* waitFor(page, button);
          yield* Effect.promise(() => page.locator(button).click());

          const saved = yield* waitForRevision(home, 1);

          assert.deepStrictEqual(movesOf(saved.layout), expected);
        }),
      60_000
    );
  }

  it.live(
    "refuses an alignment that lands two footprints on one spot, and says why",
    () =>
      Effect.gen(function* () {
        const { page, home } = yield* servedAll;

        // Left-aligning proposals and pull-request puts both at x 8, y 6.
        yield* shiftClick(page, ["proposals", "pull-request"]);
        yield* Effect.promise(() =>
          page.locator("[data-align='left']").click()
        );
        yield* waitFor(page, "[data-arrange-refused]");
        yield* Effect.sleep("300 millis");

        assert.isTrue(Option.isNone(yield* proposalsIn(home)));
      }),
    60_000
  );
});

describe("undo and redo", () => {
  /** Drags the engineer down in Plan view, which writes revision 1. */
  const dragEngineer = Effect.fnUntraced(function* (page: Page) {
    const unit = yield* unitOnScreen(page, "plan");
    const from = yield* centreOf(page, '[data-structure="engineer"]');

    yield* dragBy(page, from, { x: 0, y: unit * 3.5 });
  });

  const undoButton = "[data-control='undo']";
  const redoButton = "[data-control='redo']";

  it.live(
    "start disabled, and the buttons undo and redo what is on disk",
    () =>
      Effect.gen(function* () {
        const { page, home } = yield* servedAll;

        yield* toView(page, "plan");
        assert.isTrue(
          yield* Effect.promise(() => page.locator(undoButton).isDisabled())
        );

        yield* dragEngineer(page);
        const moved = yield* waitForRevision(home, 1);

        assert.strictEqual(moved.layout.length, 1);

        yield* Effect.promise(() => page.locator(undoButton).click());
        assert.deepStrictEqual((yield* waitForRevision(home, 2)).layout, []);
        yield* waitGone(page, "[data-structure][data-pending='true']");
        assert.isTrue(
          yield* Effect.promise(() => page.locator(undoButton).isDisabled())
        );

        yield* Effect.promise(() => page.locator(redoButton).click());
        assert.deepStrictEqual(
          (yield* waitForRevision(home, 3)).layout,
          moved.layout
        );
        yield* waitFor(page, "[data-structure][data-pending='true']");
        assert.isTrue(
          yield* Effect.promise(() => page.locator(redoButton).isDisabled())
        );
      }),
    60_000
  );

  it.live(
    "Ctrl+Z undoes, and Ctrl+Shift+Z and Ctrl+Y redo",
    () =>
      Effect.gen(function* () {
        const { page, home } = yield* servedAll;

        yield* toView(page, "plan");
        yield* dragEngineer(page);
        const moved = yield* waitForRevision(home, 1);

        yield* press(page, "Control+z");
        assert.deepStrictEqual((yield* waitForRevision(home, 2)).layout, []);

        yield* press(page, "Control+Shift+Z");
        assert.deepStrictEqual(
          (yield* waitForRevision(home, 3)).layout,
          moved.layout
        );

        yield* press(page, "Control+z");
        yield* waitForRevision(home, 4);
        yield* press(page, "Control+y");
        assert.deepStrictEqual(
          (yield* waitForRevision(home, 5)).layout,
          moved.layout
        );
      }),
    60_000
  );

  it.live(
    "undoes a whole align as one step",
    () =>
      Effect.gen(function* () {
        const { page, home } = yield* servedAll;

        yield* shiftClick(page, ["engineer", "page", "pull-request"]);
        yield* Effect.promise(() =>
          page.locator("[data-align='centre-y']").click()
        );
        yield* waitForRevision(home, 1);

        yield* press(page, "Control+z");
        assert.deepStrictEqual((yield* waitForRevision(home, 2)).layout, []);
      }),
    60_000
  );

  it.live(
    "a new edit clears what could be redone",
    () =>
      Effect.gen(function* () {
        const { page, home } = yield* servedAll;

        yield* toView(page, "plan");
        yield* dragEngineer(page);
        yield* waitForRevision(home, 1);
        yield* press(page, "Control+z");
        yield* waitForRevision(home, 2);

        yield* shiftClick(page, ["server"]);
        yield* press(page, "ArrowRight");
        yield* waitForRevision(home, 3);

        assert.isTrue(
          yield* Effect.promise(() => page.locator(redoButton).isDisabled())
        );
      }),
    60_000
  );

  it.live(
    "keeps the step and shows a conflict when the file changed underneath",
    () =>
      Effect.gen(function* () {
        const { page, home, serve } = yield* servedAll;

        yield* toView(page, "plan");
        yield* dragEngineer(page);
        yield* waitForRevision(home, 1);
        yield* waitFor(
          page,
          '[data-structure="engineer"][data-pending="true"]'
        );

        // Someone else writes on top of the page's change: revision 2.
        const mine = yield* proposalsIn(home);

        const written = yield* Effect.promise(() =>
          page.request.put(new URL("/api/proposals/layout", serve.url).href, {
            headers: { origin: serve.url, "content-type": "application/json" },
            data: {
              baseRevision: 1,
              layout: [
                ...Option.match(mine, {
                  onNone: () => [],
                  onSome: ({ layout }) => layout,
                }),
                {
                  id: "other-writer",
                  kind: "move",
                  moves: [
                    {
                      target: { kind: "structure", id: "upstream" },
                      position: { x: 18, y: 4 },
                    },
                  ],
                },
              ],
            },
          })
        );

        assert.strictEqual(written.status(), 200);
        yield* waitFor(
          page,
          '[data-structure="upstream"][data-pending="true"]'
        );

        yield* press(page, "Control+z");
        yield* waitFor(page, "[data-edit-notice='conflict']");
        yield* Effect.sleep("300 millis");

        const saved = yield* proposalsIn(home);

        // Nothing was written over the other writer's change, and the step
        // is kept.
        assert.deepStrictEqual(
          Option.map(saved, ({ revision, layout }) => [
            revision,
            Arr.map(layout, ({ id }) => id),
          ]).pipe(Option.getOrNull),
          [
            2,
            [
              ...(Option.isSome(mine)
                ? Arr.map(mine.value.layout, ({ id }) => id)
                : []),
              "other-writer",
            ],
          ]
        );
        assert.isFalse(
          yield* Effect.promise(() => page.locator(undoButton).isDisabled())
        );
      }),
    60_000
  );
});

/** What a structure looks like on screen: its outline, face, badge and ring. */
interface Look {
  readonly stroke: string;
  readonly face: string;
  readonly badge: boolean;
  readonly ring: string | null;
  readonly ringDash: string | null;
}

const LookJson = Schema.fromJsonString(
  Schema.Struct({
    stroke: Schema.String,
    face: Schema.String,
    badge: Schema.Boolean,
    ring: Schema.NullOr(Schema.String),
    ringDash: Schema.NullOr(Schema.String),
  })
);

const decodeLook = Schema.decodeUnknownEffect(LookJson);

/** A look as one line, for telling looks apart. */
const lookKey = (look: Look) =>
  Arr.join(
    [look.stroke, look.face, String(look.badge), look.ring ?? "none"],
    "|"
  );

const lookOf = (page: Page, id: string) =>
  Effect.promise(() =>
    page.evaluate<string>(`(() => {
      const box = document.querySelector('[data-structure="${id}"]');
      const face = box.querySelector("[data-face]");
      const badge = document.querySelector('[data-pending-badge="${id}"]');
      const ring = document.querySelector('[data-multi-selection-marker="${id}"]');

      return JSON.stringify({
        stroke: getComputedStyle(box).stroke,
        face: getComputedStyle(face).fill,
        badge: badge !== null,
        ring: ring === null ? null : getComputedStyle(ring).stroke,
        ringDash: ring === null ? null : getComputedStyle(ring).strokeDasharray,
      });
    })()`)
  ).pipe(Effect.flatMap(decodeLook));

describe("how the multi-selection looks", () => {
  for (const view of views) {
    it.live(
      `a multi-selected, a pending and a both structure look different from each other, in ${view}`,
      () =>
        Effect.gen(function* () {
          const { page, home } = yield* servedAll;

          yield* toView(page, view);

          // Upstream moves on its own, so it is pending.
          const unit = yield* unitOnScreen(page, view);
          const from = yield* centreOf(page, '[data-structure="upstream"]');

          yield* dragBy(page, from, {
            x: 0,
            y: unit * (view === "plan" ? 3 : 2),
          });
          yield* waitForRevision(home, 1);
          yield* waitFor(
            page,
            '[data-structure="upstream"][data-pending="true"]'
          );

          const pendingOnly = yield* lookOf(page, "upstream");
          const plain = yield* lookOf(page, "server");

          // Engineer and upstream are picked: engineer is multi-selected
          // only, and upstream is both.
          yield* shiftClick(page, ["engineer", "upstream"]);
          yield* waitFor(page, '[data-multi-selected="true"]');

          const multiOnly = yield* lookOf(page, "engineer");
          const both = yield* lookOf(page, "upstream");

          const keys = Arr.map([plain, pendingOnly, multiOnly, both], lookKey);

          assert.strictEqual(new Set(keys).size, 4, Arr.join(keys, "\n"));

          // The ring is solid, and not the pending blue.
          assert.notStrictEqual(multiOnly.ring, pendingOnly.stroke);
          assert.strictEqual(multiOnly.ringDash, "none");
          assert.notStrictEqual(multiOnly.stroke, pendingOnly.stroke);
        }),
      60_000
    );
  }
});

describe("the toolbar", () => {
  it.live(
    "shows a button's name as text on focus and hover, and says why Distribute is off",
    () =>
      Effect.gen(function* () {
        const { page } = yield* servedAll;

        yield* toView(page, "plan");
        yield* shiftClick(page, ["engineer", "page"]);
        yield* waitFor(page, "[data-arrange-toolbar]");

        const hint = () =>
          Effect.promise(() =>
            page.locator("[data-toolbar-hint]").first().textContent()
          );

        assert.strictEqual(yield* hint(), "Select three or more to distribute");

        yield* Effect.promise(() => page.locator("[data-align='top']").focus());
        assert.include(yield* hint(), "Align top edges");

        yield* Effect.promise(() => page.locator("[data-align='top']").blur());
        yield* Effect.promise(() =>
          page.locator("[data-align='left']").hover()
        );
        assert.include(yield* hint(), "Align left edges");

        yield* Effect.promise(() => page.mouse.move(5, 5));
        yield* Effect.promise(() =>
          page.locator("[data-align='left']").focus()
        );
        assert.include(yield* hint(), "Align left edges");

        // Undo and Redo are named without their arrows.
        assert.strictEqual(
          yield* attribute(page, "[data-control='undo']", "aria-label"),
          "Undo"
        );
        assert.strictEqual(
          yield* attribute(page, "[data-control='redo']", "aria-label"),
          "Redo"
        );
      }),
    60_000
  );

  it.live("names the Iso view's buttons by the ground edge they use", () =>
    Effect.gen(function* () {
      const { page } = yield* servedAll;

      yield* toView(page, "iso");
      yield* shiftClick(page, ["engineer", "page"]);
      yield* waitFor(page, "[data-arrange-toolbar]");

      assert.include(
        (yield* attribute(page, "[data-align='left']", "aria-label")) ?? "",
        "smallest x"
      );
      assert.include(
        (yield* attribute(page, "[data-align='top']", "aria-label")) ?? "",
        "smallest y"
      );

      yield* toView(page, "plan");
      assert.strictEqual(
        yield* attribute(page, "[data-align='left']", "aria-label"),
        "Align left edges"
      );
    })
  );
});

describe("older news from the server", () => {
  it.live(
    "a PendingUpdated event for an older file does not take the page back",
    () =>
      Effect.gen(function* () {
        const { page, home } = yield* servedAll;

        // Keep the page's event sources, so the test can deliver an event.
        yield* Effect.promise(() =>
          page.addInitScript(`(() => {
            const Real = globalThis.EventSource;
            globalThis.__sources = [];
            globalThis.EventSource = class extends Real {
              constructor(...args) {
                super(...args);
                globalThis.__sources.push(this);
              }
            };
          })()`)
        );
        yield* Effect.promise(() => page.reload());
        yield* waitFor(page, "[data-structure]");
        yield* Effect.promise(() =>
          page
            .locator('[data-chapter-rail] button[data-chapter="c-all"]')
            .click()
        );

        yield* shiftClick(page, ["engineer", "page"]);
        yield* press(page, "ArrowDown");
        yield* waitForRevision(home, 1);
        yield* waitFor(
          page,
          '[data-structure="engineer"][data-pending="true"]'
        );

        // The server said revision 0 with nothing pending, late.
        yield* Effect.promise(() =>
          page.evaluate(`(() => {
            const data = JSON.stringify({
              _tag: "PendingUpdated",
              proposals: { format: 1, revision: 0, layout: [] },
            });
            for (const source of globalThis.__sources) {
              source.dispatchEvent(new MessageEvent("message", { data }));
            }
          })()`)
        );
        yield* Effect.sleep("400 millis");

        assert.strictEqual(
          yield* count(page, '[data-structure][data-pending="true"]'),
          2
        );
      }),
    60_000
  );
});

describe("accepting a change", () => {
  it.live(
    "clears the undo history and says so, when the accepted layout moves on",
    () =>
      Effect.gen(function* () {
        const { page, home } = yield* servedAll;

        yield* shiftClick(page, ["engineer", "page"]);
        yield* press(page, "ArrowDown");
        yield* waitForRevision(home, 1);
        yield* waitFor(page, "[data-control='undo']:not([disabled])");

        // Accepting writes layout.json, which raises its revision. The
        // layout command does the same, so the page hears of it alike.
        const done = yield* runCli(home, [
          "layout",
          home,
          "upstream",
          "--x",
          "19",
        ]);

        assert.strictEqual(done.exitCode, 0, done.stderr);
        yield* waitFor(page, "[data-edit-notice='info']");
        assert.include(
          yield* Effect.promise(() =>
            page.locator("[data-edit-notice='info']").textContent()
          ),
          "can't be undone"
        );
        assert.isTrue(
          yield* Effect.promise(() =>
            page.locator("[data-control='undo']").isDisabled()
          )
        );
      }),
    60_000
  );
});

describe("editing off", () => {
  it.live(
    "hides the toolbar, the set and the nudge when the server is stopped",
    () =>
      Effect.gen(function* () {
        const { page, home, serve } = yield* servedAll;

        yield* shiftClick(page, ["engineer", "page"]);
        yield* waitFor(page, "[data-arrange-toolbar]");

        yield* serve.stop;
        yield* waitFor(page, "[data-server-stopped]");

        assert.strictEqual(yield* count(page, "[data-edit-toolbar]"), 0);
        assert.strictEqual(yield* count(page, "[data-arrange-toolbar]"), 0);

        // Undo does nothing while editing is off.
        yield* press(page, "Control+z");
        assert.isTrue(Option.isNone(yield* proposalsIn(home)));
      }),
    60_000
  );

  it.live(
    "the read-only file has no toolbar and Shift-click only pins",
    () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const { root, home, serve } = yield* servedAll;

        yield* serve.stop;

        const result = yield* runCli(home, ["build", home]);

        assert.strictEqual(result.exitCode, 0, result.stderr);

        const { page } = yield* openPage(
          path.join(root, "review", "review.html")
        );

        yield* Effect.promise(() =>
          page
            .locator('[data-chapter-rail] button[data-chapter="c-all"]')
            .click()
        );
        yield* shiftClick(page, ["engineer", "page"]);

        assert.strictEqual(yield* count(page, "[data-edit-toolbar]"), 0);
        assert.strictEqual(
          yield* count(page, "[data-multi-selection-marker]"),
          0
        );
        assert.deepStrictEqual(yield* multiSelectedIds(page), []);
        assert.strictEqual(
          yield* count(page, '[data-structure][data-selected="true"]'),
          1
        );
      }).pipe(Effect.provide(NodeServices.layer)),
    60_000
  );
});
