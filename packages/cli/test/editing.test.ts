import { LayoutFile, structuresOf } from "@axonometric/contracts";
import type { Proposals } from "@axonometric/contracts";
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
  String as Str,
} from "effect";
import type { Page, Route } from "playwright";

import {
  attributeOf,
  boxesOf,
  centreOf,
  count,
  goToChapter,
  literal,
  openPage,
  showView,
  strokeOf,
  unitOnScreen,
  waitFor,
  waitGone,
} from "./browser.ts";
import {
  openReviewMap,
  proposalsIn,
  runCli,
  waitForRevision,
} from "./harness.ts";
import { moveOf } from "./revisions.ts";

// Editing the layout in a page that a real serve serves: dragging and
// resizing structures, and what lands in proposals.json.

const decodeLayout = Schema.decodeUnknownEffect(LayoutFile);

/** The review map served on a free port, open in the last chapter. */
const servedReview = Effect.gen(function* () {
  const opened = yield* openReviewMap({});

  yield* goToChapter(opened.page, "c-all");

  return opened;
});

interface Point {
  readonly x: number;
  readonly y: number;
}

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

/** The computed opacity of the element matching `selector`. */
const opacityOf = (page: Page, selector: string) =>
  Effect.promise(() =>
    page.evaluate<string>(
      `getComputedStyle(document.querySelector(${literal(selector)})).opacity`
    )
  );

/** The changes without their random ids, for comparing what they do. */
const withoutIds = (layout: Proposals["layout"]) =>
  Arr.map(layout, ({ id: _id, ...rest }) => rest);

const onHalfUnit = (value: number) => Number.isInteger(value * 2);

describe("moving structures", () => {
  it.live(
    "drags a structure in Plan view, snapped to half units, and saves it to proposals.json",
    () =>
      Effect.gen(function* () {
        const { home, page, errors } = yield* servedReview;

        yield* showView(page, "plan");

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

        yield* showView(page, "plan");

        const from = yield* centreOf(page, '[data-structure="engineer"]');
        const onto = yield* centreOf(page, '[data-structure="page"]');

        yield* pressAndMove(page, from, {
          x: onto.x - from.x,
          y: onto.y - from.y,
        });

        assert.strictEqual(
          yield* attributeOf(page, "[data-drag-outline]", "data-refused"),
          "true"
        );

        // The dragged box is see-through and its start is outlined, so the
        // box it's over, and the place it left, still show.
        assert.strictEqual(
          yield* count(page, '[data-drag-origin="engineer"]'),
          1
        );
        assert.isBelow(
          Number(yield* opacityOf(page, '[data-structure="engineer"]')),
          1
        );

        const before = yield* attributeOf(
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
          yield* attributeOf(
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
    "draws a moved structure in the accent with no badge, and a faint outline where it was accepted, in both views",
    () =>
      Effect.gen(function* () {
        const { home, page } = yield* servedReview;
        const unit = yield* unitOnScreen(page, "iso");
        const from = yield* centreOf(page, '[data-structure="engineer"]');

        yield* dragBy(page, from, { x: 0, y: unit * 2.2 });
        yield* waitForRevision(home, 1);
        yield* waitFor(
          page,
          '[data-structure="engineer"][data-pending="true"]'
        );

        for (const view of ["iso", "plan"] as const) {
          if (view === "plan") {
            yield* showView(page, "plan");
          }

          assert.strictEqual(
            yield* attributeOf(
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
          // The pending look is the outline and the face tint: no text sits
          // on the map, and a screen reader hears it in the structure's name.
          assert.strictEqual(
            yield* count(page, "[data-pending-badge]"),
            0,
            view
          );
          assert.include(
            yield* attributeOf(
              page,
              '[data-structure="engineer"]',
              "aria-label"
            ),
            "pending change",
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

        yield* showView(page, "plan");
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

        // The engineer's footprint is 2 × 2. On the Iso view's ground a unit
        // along x is 36 right and 18 down, and along y 36 left and 18 down,
        // in drawing units, so from the back corner (nw) the others sit at
        // these offsets.
        const scale = Number(
          yield* attributeOf(page, "svg[data-scale]", "data-scale")
        );

        const back = yield* centreOf(page, '[data-resize-handle="nw"]');

        for (const [corner, x, y] of [
          ["ne", 72, 36],
          ["se", 0, 72],
          ["sw", -72, 36],
        ] as const) {
          const at = yield* centreOf(page, `[data-resize-handle="${corner}"]`);

          assert.closeTo(at.x - back.x, x * scale, 1, `${corner} x`);
          assert.closeTo(at.y - back.y, y * scale, 1, `${corner} y`);
        }

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

describe("the side panel tabs", () => {
  it.live(
    "fit on one line each at 1280 wide, with Flows, Pending and History listed",
    () =>
      Effect.gen(function* () {
        const { page } = yield* servedReview;

        yield* Effect.promise(() =>
          page.locator('[role="tab"][data-tab="pending"]').waitFor()
        );

        const names = yield* Effect.promise(() =>
          page.locator('[role="tab"]').allTextContents()
        );

        assert.deepStrictEqual(Arr.map(names, Str.replace(/ · \d+$/u, "")), [
          "Details",
          "Questions",
          "Flows",
          "Pending",
          "History",
        ]);

        const boxes = yield* boxesOf(page, '[role="tab"]');
        const [first] = boxes;

        assert.strictEqual(boxes.length, 5);
        assert.isDefined(first);

        for (const box of boxes) {
          // One line of 12px text, with padding, is well under two lines.
          assert.isBelow(box.height, 30);
          assert.strictEqual(box.y, first?.y);
        }
      })
  );
});

describe("the pending list", () => {
  it.live(
    "keeps pending changes across a reload, lists them, and discards one back to the accepted position",
    () =>
      Effect.gen(function* () {
        const { home, page } = yield* servedReview;

        yield* showView(page, "plan");

        const unit = yield* unitOnScreen(page, "plan");
        const from = yield* centreOf(page, '[data-structure="engineer"]');
        const face = '[data-structure="engineer"] [data-face]';
        const accepted = yield* attributeOf(page, face, "x");

        yield* dragBy(page, from, { x: unit * 0.5, y: unit * 3.5 });
        yield* waitForRevision(home, 1);

        yield* Effect.promise(() => page.reload());
        yield* goToChapter(page, "c-all");
        yield* showView(page, "plan");
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
        assert.strictEqual(yield* attributeOf(page, face, "x"), accepted);
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
        // The drag also proposed a group change; its row keeps a Discard, but
        // disabled, as every review row does while the server is stopped.
        assert.strictEqual(
          yield* count(page, "[data-pending-list] button:enabled"),
          0
        );
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

        yield* showView(page, "plan");

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

        yield* goToChapter(opened.page, "c-all");
        yield* showView(opened.page, "plan");
        yield* Effect.promise(() =>
          opened.page.locator('[data-structure="engineer"]').click()
        );

        assert.strictEqual(
          yield* attributeOf(
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

    yield* showView(page, "plan");

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
          baseFileRevision: 0,
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
