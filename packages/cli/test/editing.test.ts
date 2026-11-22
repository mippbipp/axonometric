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
  Schema,
  String as Str,
} from "effect";
import type { Page, Route } from "playwright";

import {
  assertAttribute,
  assertCount,
  attributesOf,
  attributeOf,
  boxesOf,
  centreOf,
  count,
  goToChapter,
  literal,
  openPage,
  press,
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
  mapIn,
  homeAt,
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
        const { errors, home, page } = yield* servedReview;

        yield* showView(page, "plan");

        const unit = yield* unitOnScreen(page, "plan");
        const from = yield* centreOf(page, '[data-structure="engineer"]');

        // 0.4 of a unit across and 3.3 down, which snaps to 0.5 and 3.5.
        yield* dragBy(page, from, { x: unit * 0.4, y: unit * 3.3 });

        const saved = yield* waitForRevision(home, 1);

        assert.deepStrictEqual(withoutIds(saved.layout), [
          {
            by: "engineer",
            kind: "move",
            moves: [
              {
                position: { x: 0.5, y: 3.5 },
                target: { id: "engineer", kind: "structure" },
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

        // PROBE
        const dump = (label: string) =>
          proposalsIn(home).pipe(
            Effect.map((now) =>
              process.stderr.write(
                `PROBE243 ${label} ${JSON.stringify(
                  Option.isSome(now)
                    ? {
                        kinds: Arr.map(now.value.layout, (c) => c.kind),
                        n: now.value.layout.length,
                        rev: now.value.revision,
                      }
                    : null
                )}\n`
              )
            )
          );
        for (let i = 0; i < 150; i++) {
          const now = yield* proposalsIn(home);
          if (Option.isSome(now) && now.value.revision >= 1) {
            break;
          }
          yield* Effect.sleep("100 millis");
        }
        yield* dump("first");
        yield* Effect.sleep("2 seconds");
        yield* dump("settled");
        // END PROBE
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
    "refuses a drop onto another footprint, outlined in red during the drag and said as a notice after, and writes nothing",
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

        yield* assertAttribute(
          page,
          { name: "data-refused", selector: "[data-drag-outline]" },
          "true"
        );

        // The dragged box is see-through and its start is outlined, so the
        // box it's over, and the place it left, still show.
        yield* assertCount(page, '[data-drag-origin="engineer"]', 1);

        const engineerOpacity = yield* opacityOf(
          page,
          '[data-structure="engineer"]'
        );

        assert.isBelow(Number(engineerOpacity), 1);

        const before = yield* attributeOf(
          page,
          '[data-structure="engineer"] [data-face]',
          "x"
        );

        yield* Effect.promise(() => page.mouse.up());
        yield* waitGone(page, "[data-drag-outline]");
        yield* waitFor(page, "[data-edit-notice='refused']");
        yield* Effect.sleep("500 millis");

        const savedProposals = yield* proposalsIn(home);
        assert.isTrue(Option.isNone(savedProposals));

        yield* assertCount(page, '[data-structure][data-pending="true"]', 0);

        const engineerFaceX = yield* attributeOf(
          page,
          '[data-structure="engineer"] [data-face]',
          "x"
        );

        assert.strictEqual(engineerFaceX, before);
      }),
    60_000
  );

  it.live(
    "puts a structure back on Escape during a drag, and writes nothing",
    () =>
      Effect.gen(function* () {
        const { home, page } = yield* servedReview;

        yield* showView(page, "plan");

        const unit = yield* unitOnScreen(page, "plan");
        const from = yield* centreOf(page, '[data-structure="engineer"]');

        yield* pressAndMove(page, from, { x: 0, y: unit * 2 });
        yield* waitFor(page, '[data-layout-editor][data-dragging="engineer"]');
        yield* waitFor(page, "[data-drag-outline]");
        yield* press(page, "Escape");
        yield* waitGone(page, "[data-dragging]");
        yield* waitGone(page, "[data-drag-outline]");
        yield* Effect.promise(() => page.mouse.up());
        yield* Effect.sleep("500 millis");

        const savedProposals = yield* proposalsIn(home);

        assert.isTrue(Option.isNone(savedProposals));
        yield* assertCount(page, "[data-drag-shifted]", 0);
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

        const savedProposals = yield* proposalsIn(home);
        assert.isTrue(Option.isNone(savedProposals));
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

          const pendingAttribute = yield* attributeOf(
            page,
            '[data-structure="engineer"]',
            "data-pending"
          );

          assert.strictEqual(pendingAttribute, "true", view);

          const acceptedOutlineCount = yield* count(
            page,
            '[data-accepted-outline="engineer"]'
          );

          assert.strictEqual(acceptedOutlineCount, 1, view);
          // The pending look is the outline and the face tint: no text sits
          // on the map, and a screen reader hears it in the structure's name.
          const pendingBadgeCount = yield* count(page, "[data-pending-badge]");

          assert.strictEqual(pendingBadgeCount, 0, view);

          const engineerLabel = yield* attributeOf(
            page,
            '[data-structure="engineer"]',
            "aria-label"
          );

          assert.include(engineerLabel, "pending change", view);

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
            by: "engineer",
            footprint: { d: 3, w: 2.5 },
            kind: "resize",
            target: { id: "engineer", kind: "structure" },
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

        yield* assertCount(page, "[data-resize-handle]", 4);

        const scaleText = yield* attributeOf(
          page,
          "svg[data-scale]",
          "data-scale"
        );

        // The engineer's footprint is 2 × 2. On the Iso view's ground a unit
        // along x is 36 right and 18 down, and along y 36 left and 18 down,
        // in drawing units, so from the back corner (nw) the others sit at
        // these offsets.
        const scale = Number(scaleText);

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

describe("resizing from the keyboard and cancelling a resize", () => {
  it.live(
    "an arrow on a focused corner handle moves that corner half a unit, as one change",
    () =>
      Effect.gen(function* () {
        const { home, page } = yield* servedReview;

        yield* showView(page, "plan");
        yield* Effect.promise(() =>
          page.locator('[data-structure="engineer"]').click()
        );

        const handle = page.getByRole("button", {
          name: "Resize Engineer from its south-east corner",
        });

        yield* Effect.promise(() => handle.focus());
        yield* press(page, "ArrowRight");

        const saved = yield* waitForRevision(home, 1);

        assert.deepStrictEqual(withoutIds(saved.layout), [
          {
            by: "engineer",
            footprint: { d: 2, w: 2.5 },
            kind: "resize",
            target: { id: "engineer", kind: "structure" },
          },
        ]);
        yield* assertAttribute(
          page,
          { name: "data-chapter", selector: "[data-walkthrough]" },
          "c-all"
        );
      }),
    60_000
  );

  it.live(
    "Escape during a corner drag in the Iso view puts the footprint back and writes nothing",
    () =>
      Effect.gen(function* () {
        const { home, page } = yield* servedReview;

        yield* Effect.promise(() =>
          page.locator('[data-structure="engineer"]').click()
        );
        yield* waitFor(page, '[data-resize-handle="se"]');

        const unit = yield* unitOnScreen(page, "iso");
        const corner = yield* centreOf(page, '[data-resize-handle="se"]');

        yield* pressAndMove(page, corner, { x: 0, y: unit * 1.5 });
        yield* waitFor(page, '[data-layout-editor][data-dragging="engineer"]');
        yield* press(page, "Escape");
        yield* waitGone(page, "[data-dragging]");
        yield* Effect.promise(() => page.mouse.up());
        yield* Effect.sleep("500 millis");

        const savedProposals = yield* proposalsIn(home);

        assert.isTrue(Option.isNone(savedProposals));
        yield* assertCount(page, '[data-resize-handle="se"]', 1);
      }),
    60_000
  );
});

describe("the side panel tabs", () => {
  it.live(
    "stay readable at 1280 wide, never overlap and stay inside the panel, with Flows, Pending and History listed",
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
        const [panel] = yield* boxesOf(page, "[data-side-panel]");

        assert.strictEqual(boxes.length, 5);
        assert.isDefined(panel);

        const sizes = yield* Effect.promise(() =>
          page.evaluate<Array<string>>(
            `[...document.querySelectorAll('[role="tab"]')].map((tab) => getComputedStyle(tab).fontSize)`
          )
        );

        // The same 12px as the panel's other controls, not the old 10px.
        assert.deepStrictEqual(sizes, ["12px", "12px", "12px", "12px", "12px"]);

        for (const [index, box] of boxes.entries()) {
          // Each label is one line, and every tab sits inside the panel.
          assert.isBelow(box.height, 30);
          assert.isAtLeast(box.x, panel?.x ?? 0);
          assert.isAtMost(
            box.x + box.width,
            (panel?.x ?? 0) + (panel?.width ?? 0)
          );

          for (const other of boxes.slice(index + 1)) {
            const apart =
              box.x + box.width <= other.x ||
              other.x + other.width <= box.x ||
              box.y + box.height <= other.y ||
              other.y + other.height <= box.y;

            assert.isTrue(apart);
          }
        }
      })
  );
});

describe("the side panel's tab list", () => {
  it.live(
    "moves between tabs with the arrow keys, is one Tab stop, and keeps the chosen tab until the selection changes",
    () =>
      Effect.gen(function* () {
        const { page } = yield* servedReview;
        const tabs = page.locator('[role="tab"]');
        const selectedTab = () =>
          attributeOf(page, '[role="tab"][aria-selected="true"]', "data-tab");

        yield* waitFor(page, '[role="tab"][data-tab="history"]');

        const stops = yield* attributesOf(page, '[role="tab"]', "tabindex");

        assert.strictEqual(
          Arr.filter(stops, (index) => index === "0").length,
          1,
          "one Tab stop in the list"
        );

        const chapter = () =>
          attributeOf(page, "[data-walkthrough]", "data-chapter");
        const chapterBefore = yield* chapter();

        yield* Effect.promise(() => tabs.first().focus());
        yield* press(page, "ArrowRight");
        yield* waitFor(
          page,
          '[role="tab"][data-tab="questions"][aria-selected="true"]'
        );

        const focused = yield* Effect.promise(() =>
          page.evaluate(
            "document.activeElement?.getAttribute('data-tab') ?? null"
          )
        );

        assert.strictEqual(focused, "questions");

        yield* press(page, "End");
        yield* waitFor(
          page,
          '[role="tab"][data-tab="history"][aria-selected="true"]'
        );
        yield* waitFor(page, "[data-history-list]");
        yield* press(page, "ArrowRight");
        yield* waitFor(
          page,
          '[role="tab"][data-tab="details"][aria-selected="true"]'
        );

        yield* press(page, "ArrowLeft");
        yield* waitFor(
          page,
          '[role="tab"][data-tab="history"][aria-selected="true"]'
        );

        // The chosen tab stays chosen after focus leaves the list.
        yield* press(page, "Tab");

        const chosen = yield* selectedTab();

        assert.strictEqual(chosen, "history");
        const chapterAfter = yield* chapter();

        assert.strictEqual(
          chapterAfter,
          chapterBefore,
          "the arrow keys moved tabs, not chapters"
        );
        yield* assertCount(page, '[role="tabpanel"]', 1);
      }),
    60_000
  );
});

/** Where focus is after Tab from the selected tab: the element's role, whether the tab panel holds it, and its tag. */
const afterTab = (page: Page) =>
  Effect.promise(() =>
    page.evaluate<{
      readonly inPanel: boolean;
      readonly role: string | null;
      readonly tag: string;
    }>(
      `(() => {
          const element = document.activeElement;
          return {
            inPanel: element?.closest('[role="tabpanel"]') !== null && element?.getAttribute("role") !== "tabpanel",
            role: element?.getAttribute("role") ?? null,
            tag: element?.tagName.toLowerCase() ?? "",
          };
        })()`
    )
  );

const chooseAndFocus = Effect.fnUntraced(function* (page: Page, tab: string) {
  const selector = `[role="tab"][data-tab="${tab}"]`;

  yield* waitFor(page, selector);
  yield* Effect.promise(() => page.locator(selector).click());
  yield* waitFor(page, `${selector}[aria-selected="true"]`);
  yield* Effect.promise(() => page.locator(selector).focus());
});

describe("the side panel's tab panel", () => {
  it.live(
    "is not a Tab stop when it holds no control, so Tab leaves the panel",
    () =>
      Effect.gen(function* () {
        const { page } = yield* servedReview;

        yield* chooseAndFocus(page, "pending");
        yield* waitFor(page, "[data-pending-empty]");
        yield* press(page, "Tab");

        const focus = yield* afterTab(page);

        assert.notStrictEqual(focus.role, "tabpanel");
        assert.isFalse(focus.inPanel);
      }),
    60_000
  );

  it.live(
    "sends Tab from the selected tab to the panel's first control, not the panel",
    () =>
      Effect.gen(function* () {
        const { page } = yield* servedReview;

        yield* chooseAndFocus(page, "questions");
        yield* waitFor(page, "[data-questions-tab] button");

        const first = yield* Effect.promise(() =>
          page.evaluate(
            `(() => {
              const panel = document.querySelector('[data-side-panel] [role="tabpanel"]');
              const control = panel?.querySelector("button, a[href], input, select, textarea");
              return control === null || control === undefined ? null : control.outerHTML.slice(0, 120);
            })()`
          )
        );

        assert.isNotNull(first);

        yield* press(page, "Tab");

        const focus = yield* afterTab(page);

        assert.notStrictEqual(focus.role, "tabpanel");
        assert.isTrue(focus.inPanel);

        const landed = yield* Effect.promise(() =>
          page.evaluate(
            "document.activeElement?.outerHTML.slice(0, 120) ?? null"
          )
        );

        assert.strictEqual(landed, first);
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
        const faceX = yield* attributeOf(page, face, "x");
        assert.strictEqual(faceX, accepted);
      }),
    60_000
  );
});

describe("editing off", () => {
  it.live(
    "hides the handles, stops dragging and hides Discard while the server is stopped",
    () =>
      Effect.gen(function* () {
        const { home, page, serve } = yield* servedReview;
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
        yield* assertCount(page, "[data-resize-handle]", 0);

        const before = yield* centreOf(page, '[data-structure="server"]');

        yield* dragBy(page, before, { x: 0, y: unit * 2 });

        yield* assertCount(page, "[data-drag-outline]", 0);

        yield* Effect.promise(() =>
          page.locator('[role="tab"][data-tab="pending"]').click()
        );
        yield* waitFor(page, "[data-pending-change]");

        // The drag also proposed a group change; its row keeps a Discard, but
        // disabled, as every review row does while the server is stopped.
        yield* assertCount(page, "[data-pending-list] button:enabled", 0);
      }),
    60_000
  );

  it.live(
    "build and the read-only file show the accepted layout, with no editing controls",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const { home, page, root, serve } = yield* servedReview;

        yield* showView(page, "plan");

        const unit = yield* unitOnScreen(page, "plan");
        const from = yield* centreOf(page, '[data-structure="engineer"]');

        yield* dragBy(page, from, { x: unit * 0.5, y: unit * 3.5 });
        yield* waitForRevision(home, 1);
        yield* serve.stop;

        const built = yield* runCli(home, ["build", home]);
        const layout = yield* fs.readFileString(homeAt(home).layoutFile);

        assert.strictEqual(built.exitCode, 0, built.stderr);
        assert.deepStrictEqual(
          (yield* decodeLayout(layout)).structures.engineer,
          { d: 2, w: 2, x: 0, y: 0 }
        );

        const file = mapIn(root, "review").pageFile;

        const opened = yield* openPage(file);

        yield* goToChapter(opened.page, "c-all");
        yield* showView(opened.page, "plan");
        yield* Effect.promise(() =>
          opened.page.locator('[data-structure="engineer"]').click()
        );

        yield* assertAttribute(
          opened.page,
          { name: "x", selector: '[data-structure="engineer"] [data-face]' },
          "0"
        );
        yield* assertCount(opened.page, '[data-pending="true"]', 0);
        yield* assertCount(opened.page, "[data-accepted-outline]", 0);
        yield* assertCount(opened.page, "[data-resize-handle]", 0);
        yield* assertCount(opened.page, '[data-layout-editor="on"]', 0);

        yield* assertCount(opened.page, '[role="tab"][data-tab="pending"]', 0);
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
    const { home, page, serve } = yield* servedReview;
    const held = yield* Latch.make();
    const reached = yield* Latch.make();
    const services = yield* Effect.context();
    // oxlint-disable-next-line eslint/no-restricted-properties -- Playwright calls this route handler from outside the Effect runtime, so it needs a Promise
    const run = Effect.runPromiseWith(services);

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
        data: {
          baseFileRevision: 0,
          layout: [moveOf("other-writer", other.id, other.to)],
        },
        headers: { "content-type": "application/json", origin: serve.url },
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
        yield* assertCount(page, '[data-edit-notice="conflict"]', 0);
      }),
    60_000
  );
});
