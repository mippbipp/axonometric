import { LayoutFile, Proposals, structuresOf } from "@axonometric/contracts";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import {
  Array as Arr,
  Effect,
  FileSystem,
  Latch,
  Order,
  Option,
  Path,
  Schema,
} from "effect";
import type { Page, Route } from "playwright";

import { literal, openPage, openUrl } from "./browser.ts";
import { fullMap } from "./fixtures.ts";
import { makeHome, runCli, startServe } from "./harness.ts";

// Editing the layout in a page that a real serve serves: dragging and
// resizing structures, and what lands in proposals.json.

const waitTimeout = { timeout: 15_000 };

const decodeProposals = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Proposals)
);

const decodeLayout = Schema.decodeUnknownEffect(LayoutFile);

/** The review map served on a free port, open in the last chapter. */
const servedReview = Effect.gen(function* () {
  const path = yield* Path.Path;
  const root = yield* makeHome(yield* fullMap);
  const home = path.join(root, "review", "map");
  const serve = yield* startServe(home, ["--port", "0"]);
  const opened = yield* openUrl(serve.url);

  yield* Effect.promise(() =>
    opened.page.setViewportSize({ width: 1280, height: 800 })
  );
  yield* lastChapter(opened.page);

  return { root, home, serve, ...opened };
}).pipe(Effect.provide(NodeServices.layer));

const lastChapter = Effect.fnUntraced(function* (page: Page) {
  yield* Effect.promise(() =>
    page.locator('[data-chapter-rail] button[data-chapter="c-all"]').click()
  );
  yield* Effect.promise(() =>
    page
      .locator('[data-walkthrough][data-chapter="c-all"]')
      .waitFor(waitTimeout)
  );
});

const toPlan = Effect.fnUntraced(function* (page: Page) {
  yield* Effect.promise(() =>
    page.locator('[data-view-toggle] [data-view="plan"]').click()
  );
  yield* Effect.promise(() =>
    page.locator('[data-walkthrough][data-view="plan"]').waitFor()
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

/** Waits until proposals.json in `home` is at `revision`. */
const waitForRevision = Effect.fnUntraced(function* (
  home: string,
  revision: number
) {
  for (let tries = 0; tries < 150; tries++) {
    const now = yield* proposalsIn(home);

    if (Option.isSome(now) && now.value.revision >= revision) {
      return now.value;
    }

    yield* Effect.sleep("100 millis");
  }

  return assert.fail(`proposals.json never reached revision ${revision}`);
});

const attribute = (page: Page, selector: string, name: string) =>
  Effect.promise(() => page.locator(selector).first().getAttribute(name));

interface Point {
  readonly x: number;
  readonly y: number;
}

/** The middle of the element matching `selector`, in window pixels. */
const centreOf = Effect.fnUntraced(function* (page: Page, selector: string) {
  const box = yield* Effect.promise(() =>
    page.locator(selector).first().boundingBox()
  );

  assert.isNotNull(box, `${selector} isn't on screen`);

  return box === null
    ? { x: 0, y: 0 }
    : { x: box.x + box.width / 2, y: box.y + box.height / 2 };
});

/** Presses at `from` and moves by `by` in small steps, still pressed. */
const pressAndMove = Effect.fnUntraced(function* (
  page: Page,
  from: Point,
  by: Point
) {
  yield* Effect.promise(() => page.mouse.move(from.x, from.y));
  yield* Effect.promise(() => page.mouse.down());
  yield* Effect.promise(() =>
    page.mouse.move(from.x + by.x, from.y + by.y, { steps: 12 })
  );
});

/** Presses at `from`, moves by `by` in small steps, and releases. */
const dragBy = (page: Page, from: Point, by: Point) =>
  pressAndMove(page, from, by).pipe(
    Effect.andThen(Effect.promise(() => page.mouse.up()))
  );

/** One grid unit along x or y on screen, at the view's current zoom. */
const unitOnScreen = Effect.fnUntraced(function* (
  page: Page,
  view: "iso" | "plan"
) {
  const scale = yield* attribute(page, "svg[data-scale]", "data-scale");

  return (view === "plan" ? 60 : Math.hypot(36, 18)) * Number(scale);
});

/** The computed stroke colour of the element matching `selector`. */
const strokeOf = (page: Page, selector: string) =>
  Effect.promise(() =>
    page.evaluate<string>(
      `getComputedStyle(document.querySelector(${literal(selector)})).stroke`
    )
  );

const count = (page: Page, selector: string) =>
  Effect.promise(() => page.locator(selector).count());

const waitFor = (page: Page, selector: string) =>
  Effect.promise(() => page.locator(selector).first().waitFor(waitTimeout));

const waitGone = (page: Page, selector: string) =>
  Effect.promise(() =>
    page
      .locator(selector)
      .first()
      .waitFor({ state: "detached", ...waitTimeout })
  );

/** The changes without their random ids, for comparing what they do. */
const withoutIds = (layout: Proposals["layout"]) =>
  Arr.map(layout, ({ id: _id, ...rest }) => rest);

/** A move of structure `id` to a spot well clear of the others. */
const moveOf = (
  changeId: string,
  id: string,
  to: { readonly x: number; readonly y: number }
) => ({
  id: changeId,
  kind: "move",
  moves: [{ target: { kind: "structure", id }, position: to }],
});

const onHalfUnit = (value: number) => Number.isInteger(value * 2);

describe("moving structures", () => {
  it.live(
    "drags a structure in Plan view, snapped to half units, and saves it to proposals.json",
    () =>
      Effect.gen(function* () {
        const { home, page, errors } = yield* servedReview;

        yield* toPlan(page);

        const unit = yield* unitOnScreen(page, "plan");
        const from = yield* centreOf(page, '[data-structure="engineer"]');

        // 0.4 of a unit across and 3.3 down, which snaps to 0.5 and 3.5.
        yield* dragBy(page, from, { x: unit * 0.4, y: unit * 3.3 });

        const saved = yield* waitForRevision(home, 1);

        assert.deepStrictEqual(withoutIds(saved.layout), [
          {
            kind: "move",
            moves: [
              {
                target: { kind: "structure", id: "engineer" },
                position: { x: 0.5, y: 3.5 },
              },
            ],
          },
        ]);
        assert.match(saved.layout[0]?.id ?? "", /^[0-9a-f]{12}$/u);
        yield* waitFor(
          page,
          '[data-structure="engineer"][data-pending="true"]'
        );
        assert.deepStrictEqual(errors, []);
      }),
    60_000
  );

  it.live(
    "drags a structure in the Iso view, along the ground, snapped to half units",
    () =>
      Effect.gen(function* () {
        const { home, page } = yield* servedReview;
        const unit = yield* unitOnScreen(page, "iso");
        const from = yield* centreOf(page, '[data-structure="engineer"]');

        // Straight down the screen in the Iso view is along x and y at once.
        yield* dragBy(page, from, { x: 0, y: unit * 2.2 });

        const saved = yield* waitForRevision(home, 1);
        const [change] = saved.layout;

        assert.strictEqual(saved.layout.length, 1);
        assert.isDefined(change);

        if (change?.kind === "move") {
          const position = change.moves[0]?.position ?? { x: 0, y: 0 };

          assert.isTrue(onHalfUnit(position.x));
          assert.isTrue(onHalfUnit(position.y));
          assert.isAbove(position.x, 0);
          assert.isAbove(position.y, 0);
        } else {
          assert.fail("expected a move");
        }
      }),
    60_000
  );

  it.live(
    "refuses a drop onto another footprint, outlined in red during the drag, and writes nothing",
    () =>
      Effect.gen(function* () {
        const { home, page } = yield* servedReview;

        yield* toPlan(page);

        const from = yield* centreOf(page, '[data-structure="engineer"]');
        const onto = yield* centreOf(page, '[data-structure="page"]');

        yield* pressAndMove(page, from, {
          x: onto.x - from.x,
          y: onto.y - from.y,
        });

        assert.strictEqual(
          yield* attribute(page, "[data-drag-outline]", "data-refused"),
          "true"
        );

        const before = yield* attribute(
          page,
          '[data-structure="engineer"] [data-face]',
          "x"
        );

        yield* Effect.promise(() => page.mouse.up());
        yield* waitGone(page, "[data-drag-outline]");
        yield* Effect.sleep("500 millis");

        assert.isTrue(Option.isNone(yield* proposalsIn(home)));
        assert.strictEqual(
          yield* count(page, '[data-structure][data-pending="true"]'),
          0
        );
        assert.strictEqual(
          yield* attribute(
            page,
            '[data-structure="engineer"] [data-face]',
            "x"
          ),
          before
        );
      }),
    60_000
  );

  it.live(
    "a click still pins a structure, and a double-click still goes inside",
    () =>
      Effect.gen(function* () {
        const { home, page } = yield* servedReview;

        yield* Effect.promise(() =>
          page.locator('[data-structure="server"]').click()
        );
        yield* waitFor(page, '[data-structure-panel="server"][data-pinned]');
        yield* Effect.promise(() =>
          page.locator('[data-structure="page"]').dblclick()
        );
        yield* waitFor(page, '[data-inside-view="page"]');

        assert.isTrue(Option.isNone(yield* proposalsIn(home)));
      }),
    60_000
  );
});

describe("the pending look", () => {
  it.live(
    "draws a moved structure in the accent with a badge, and a faint outline where it was accepted, in both views",
    () =>
      Effect.gen(function* () {
        const { home, page } = yield* servedReview;
        const unit = yield* unitOnScreen(page, "iso");
        const from = yield* centreOf(page, '[data-structure="engineer"]');

        yield* dragBy(page, from, { x: 0, y: unit * 2.2 });
        yield* waitForRevision(home, 1);
        yield* waitFor(page, '[data-pending-badge="engineer"]');

        for (const view of ["iso", "plan"] as const) {
          if (view === "plan") {
            yield* toPlan(page);
          }

          assert.strictEqual(
            yield* attribute(
              page,
              '[data-structure="engineer"]',
              "data-pending"
            ),
            "true",
            view
          );
          assert.strictEqual(
            yield* count(page, '[data-accepted-outline="engineer"]'),
            1,
            view
          );
          assert.strictEqual(
            yield* count(page, "[data-pending-badge]"),
            1,
            view
          );

          const stroke = yield* strokeOf(page, '[data-structure="engineer"]');
          const ink = yield* strokeOf(page, '[data-structure="page"]');

          assert.notStrictEqual(stroke, ink, view);
        }
      }),
    60_000
  );
});

describe("resizing structures", () => {
  it.live(
    "drags a corner handle of the selected structure in Plan view, snapped to half units",
    () =>
      Effect.gen(function* () {
        const { home, page } = yield* servedReview;

        yield* toPlan(page);
        yield* Effect.promise(() =>
          page.locator('[data-structure="engineer"]').click()
        );
        yield* waitFor(page, '[data-resize-handle="se"]');

        const unit = yield* unitOnScreen(page, "plan");
        const corner = yield* centreOf(page, '[data-resize-handle="se"]');

        yield* dragBy(page, corner, { x: unit * 0.6, y: unit * 1.1 });

        const saved = yield* waitForRevision(home, 1);

        assert.deepStrictEqual(withoutIds(saved.layout), [
          {
            kind: "resize",
            target: { kind: "structure", id: "engineer" },
            footprint: { w: 2.5, d: 3 },
          },
        ]);
      }),
    60_000
  );

  it.live(
    "puts the handles on the footprint's ground corners in the Iso view",
    () =>
      Effect.gen(function* () {
        const { home, page } = yield* servedReview;

        yield* Effect.promise(() =>
          page.locator('[data-structure="engineer"]').click()
        );
        yield* waitFor(page, '[data-resize-handle="se"]');

        assert.strictEqual(yield* count(page, "[data-resize-handle]"), 4);

        const unit = yield* unitOnScreen(page, "iso");
        const corner = yield* centreOf(page, '[data-resize-handle="se"]');

        // Straight down from the front corner grows w and d by the same.
        yield* dragBy(page, corner, { x: 0, y: unit * 1.45 });

        const saved = yield* waitForRevision(home, 1);
        const [change] = saved.layout;

        if (change?.kind === "resize") {
          assert.strictEqual(change.footprint.w, change.footprint.d);
          assert.isAbove(change.footprint.w, 2);
          assert.isTrue(onHalfUnit(change.footprint.w));
        } else {
          assert.fail("expected a resize");
        }
      }),
    60_000
  );
});

describe("the pending list", () => {
  it.live(
    "keeps pending changes across a reload, lists them, and discards one back to the accepted position",
    () =>
      Effect.gen(function* () {
        const { home, page } = yield* servedReview;

        yield* toPlan(page);

        const unit = yield* unitOnScreen(page, "plan");
        const from = yield* centreOf(page, '[data-structure="engineer"]');
        const face = '[data-structure="engineer"] [data-face]';
        const accepted = yield* attribute(page, face, "x");

        yield* dragBy(page, from, { x: unit * 0.5, y: unit * 3.5 });
        yield* waitForRevision(home, 1);

        yield* Effect.promise(() => page.reload());
        yield* lastChapter(page);
        yield* toPlan(page);
        yield* waitFor(
          page,
          '[data-structure="engineer"][data-pending="true"]'
        );
        yield* waitFor(page, '[data-accepted-outline="engineer"]');

        yield* Effect.promise(() =>
          page.locator('[role="tab"][data-tab="pending"]').click()
        );
        yield* waitFor(
          page,
          '[data-pending-change="move"][data-pending-structure="engineer"]'
        );
        yield* Effect.promise(() =>
          page
            .getByRole("button", { name: "Discard the move of Engineer" })
            .click()
        );

        const after = yield* waitForRevision(home, 2);

        assert.deepStrictEqual(after.layout, []);
        yield* waitGone(page, '[data-structure][data-pending="true"]');
        yield* waitGone(page, "[data-accepted-outline]");
        assert.strictEqual(yield* attribute(page, face, "x"), accepted);
      }),
    60_000
  );
});

describe("editing off", () => {
  it.live(
    "hides the handles, stops dragging and hides Discard while the server is stopped",
    () =>
      Effect.gen(function* () {
        const { home, serve, page } = yield* servedReview;
        const unit = yield* unitOnScreen(page, "iso");
        const from = yield* centreOf(page, '[data-structure="engineer"]');

        yield* dragBy(page, from, { x: 0, y: unit * 2.2 });
        yield* waitForRevision(home, 1);

        yield* serve.stop;
        yield* waitFor(page, "[data-server-stopped]");
        yield* waitFor(page, '[data-layout-editor="off"]');

        yield* Effect.promise(() =>
          page.locator('[data-structure="page"]').click()
        );
        assert.strictEqual(yield* count(page, "[data-resize-handle]"), 0);

        const before = yield* centreOf(page, '[data-structure="server"]');

        yield* dragBy(page, before, { x: 0, y: unit * 2 });

        assert.strictEqual(yield* count(page, "[data-drag-outline]"), 0);

        yield* Effect.promise(() =>
          page.locator('[role="tab"][data-tab="pending"]').click()
        );
        yield* waitFor(page, "[data-pending-change]");
        assert.strictEqual(yield* count(page, "[data-pending-list] button"), 0);
      }),
    60_000
  );

  it.live(
    "build and the read-only file show the accepted layout, with no editing controls",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const { root, home, serve, page } = yield* servedReview;

        yield* toPlan(page);

        const unit = yield* unitOnScreen(page, "plan");
        const from = yield* centreOf(page, '[data-structure="engineer"]');

        yield* dragBy(page, from, { x: unit * 0.5, y: unit * 3.5 });
        yield* waitForRevision(home, 1);
        yield* serve.stop;

        const built = yield* runCli(home, ["build", home]);
        const layout = yield* fs.readFileString(path.join(home, "layout.json"));

        assert.strictEqual(built.exitCode, 0, built.stderr);
        assert.deepStrictEqual(
          (yield* decodeLayout(layout)).structures.engineer,
          { x: 0, y: 0, w: 2, d: 2 }
        );

        const file = path.join(root, "review", "review.html");

        const opened = yield* openPage(file);

        yield* lastChapter(opened.page);
        yield* toPlan(opened.page);
        yield* Effect.promise(() =>
          opened.page.locator('[data-structure="engineer"]').click()
        );

        assert.strictEqual(
          yield* attribute(
            opened.page,
            '[data-structure="engineer"] [data-face]',
            "x"
          ),
          "0"
        );
        assert.strictEqual(
          yield* count(opened.page, '[data-pending="true"]'),
          0
        );
        assert.strictEqual(
          yield* count(opened.page, "[data-accepted-outline]"),
          0
        );
        assert.strictEqual(
          yield* count(opened.page, "[data-resize-handle]"),
          0
        );
        assert.strictEqual(
          yield* count(opened.page, '[data-layout-editor="on"]'),
          0
        );
        assert.strictEqual(
          yield* count(opened.page, '[role="tab"][data-tab="pending"]'),
          0
        );
      }).pipe(Effect.provide(NodeServices.layer)),
    60_000
  );

  /**
   * Drags `structure` down in Plan view with the page's write held on its
   * way to the server, and writes `other` from outside the page in the
   * meantime, so the held write is based on a stale revision. Resolves once
   * the page has had its answer.
   */
  const dragWhileAnotherWrites = Effect.fnUntraced(function* (
    structure: string,
    other: { readonly id: string; readonly to: { x: number; y: number } }
  ) {
    const { home, serve, page } = yield* servedReview;
    const held = yield* Latch.make();
    const reached = yield* Latch.make();
    const run = Effect.runPromiseWith(yield* Effect.context());

    yield* toPlan(page);

    const holdOnce = (route: Route) =>
      run(
        Effect.gen(function* () {
          yield* reached.open;
          yield* held.await;
          yield* Effect.promise(() => route.continue());
        })
      );

    yield* Effect.promise(() =>
      page.route("**/api/proposals/layout", holdOnce, { times: 1 })
    );

    const unit = yield* unitOnScreen(page, "plan");
    const from = yield* centreOf(page, `[data-structure="${structure}"]`);

    yield* dragBy(page, from, { x: 0, y: unit * 4 });
    yield* reached.await;

    const written = yield* Effect.promise(() =>
      page.request.put(new URL("/api/proposals/layout", serve.url).href, {
        headers: { origin: serve.url, "content-type": "application/json" },
        data: {
          baseRevision: 0,
          layout: [moveOf("other-writer", other.id, other.to)],
        },
      })
    );

    assert.strictEqual(written.status(), 200);
    yield* held.open;

    return { home, page };
  });

  it.live(
    "a stale write reloads the file and sends the edit again on top of it, keeping both writers' changes",
    () =>
      Effect.gen(function* () {
        const { home, page } = yield* dragWhileAnotherWrites("upstream", {
          id: "page",
          to: { x: 4, y: 3 },
        });

        yield* waitFor(
          page,
          '[data-structure="upstream"][data-pending="true"]'
        );
        yield* waitFor(page, '[data-structure="page"][data-pending="true"]');

        const saved = yield* waitForRevision(home, 2);
        const ids = Arr.flatMap(saved.layout, structuresOf);

        assert.deepStrictEqual(Arr.sort(ids, Order.String), [
          "page",
          "upstream",
        ]);
        assert.strictEqual(
          yield* count(page, '[data-edit-notice="conflict"]'),
          0
        );
      }),
    60_000
  );

  it.live(
    "a stale write whose edit no longer fits keeps the other writer's changes and says it conflicted",
    () =>
      Effect.gen(function* () {
        // The other writer moves page onto where engineer is dragged to.
        const { home, page } = yield* dragWhileAnotherWrites("engineer", {
          id: "page",
          to: { x: 0, y: 4 },
        });

        yield* waitFor(page, '[data-edit-notice="conflict"]');
        yield* waitFor(page, '[data-structure="page"][data-pending="true"]');
        yield* waitGone(
          page,
          '[data-structure="engineer"][data-pending="true"]'
        );

        const saved = yield* proposalsIn(home);

        assert.deepStrictEqual(
          Option.map(saved, ({ layout }) =>
            Arr.map(layout, (change) => structuresOf(change)[0])
          ),
          Option.some(["page"])
        );
      }),
    60_000
  );
});
