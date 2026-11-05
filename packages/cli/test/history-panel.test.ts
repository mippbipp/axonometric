import { LayoutFile, Proposals } from "@axonometric/contracts";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import {
  Array as Arr,
  Effect,
  FileSystem,
  Path,
  pipe,
  Schema,
  String as Str,
} from "effect";
import type { Page } from "playwright";

import {
  attributeOf,
  attributesOf,
  boxesOf,
  click,
  count,
  literal,
  openUrl,
  textOf,
  waitFor,
  waitGone,
  waitTimeout,
} from "./browser.ts";
import { drawingReport, textClashes } from "./drawing-report.ts";
import type { DrawingReport } from "./drawing-report.ts";
import { fullMap } from "./fixtures.ts";
import { makeHome, readIn, serveReviewMap, startServe } from "./harness.ts";
import { acceptChanges, moveOf, resizeOf } from "./revisions.ts";

// The History panel in a page that a real serve serves: two revisions made
// through the API, then opened, compared and restored in Chromium.

const decodeLayout = Schema.decodeUnknownEffect(LayoutFile);

const decodeProposals = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Proposals)
);

/** Where the page's drawing puts structure `id`: its centre on screen. */
const centreOf = Effect.fnUntraced(function* (page: Page, id: string) {
  const box = yield* Effect.promise(() =>
    page.locator(`[data-structure="${id}"]`).first().boundingBox()
  );

  assert.isNotNull(box);

  return {
    x: (box?.x ?? 0) + (box?.width ?? 0) / 2,
    y: (box?.y ?? 0) + (box?.height ?? 0) / 2,
  };
});

/**
 * The review map, served on a free port with two revisions saved:
 *
 * - revision 1 "Drop the page" moves the page to (4, 4).
 * - revision 2 "Spread out" moves the engineer to (0, 4), resizes the page
 *   to 3 × 2 and moves the server to (8, 4).
 *
 * The current map is revision 2's. Revision 1 has the engineer at (0, 0),
 * the page 2 × 2, and the server at (8, 0).
 */
const servedWithTwo = Effect.gen(function* () {
  const { root, home, serve } = yield* serveReviewMap({}, []);

  yield* acceptChanges(serve, {
    base: 0,
    changes: [moveOf("drop-page", "page", { x: 4, y: 4 })],
    message: "Drop the page",
  });
  yield* acceptChanges(serve, {
    base: 2,
    changes: [
      moveOf("engineer-down", "engineer", { x: 0, y: 4 }),
      resizeOf("page-wide", "page", { w: 3, d: 2 }),
      moveOf("server-down", "server", { x: 8, y: 4 }),
    ],
    message: "Spread out",
  });

  const opened = yield* openUrl(serve.url);

  yield* Effect.promise(() =>
    opened.page.setViewportSize({ width: 1280, height: 800 })
  );
  // The last chapter reveals every structure.
  yield* click(opened.page, '[data-chapter-rail] button[data-chapter="c-all"]');
  yield* waitFor(opened.page, '[data-walkthrough][data-chapter="c-all"]');

  return { root, home, serve, ...opened };
}).pipe(Effect.provide(NodeServices.layer));

/**
 * Every piece of text drawn on the map, other than the code chips that sit
 * on their boxes by design, as the page draws it. A compare must add none.
 */
const strayText = `[...document.querySelectorAll("svg[data-scale] text")]
  .filter((text) => getComputedStyle(text).visibility !== "hidden")
  .filter((text) => text.closest("[data-name-tag], [data-code-chip], [data-zone-title]") === null && text.dataset.hopLabel === undefined)
  .map((text) => text.textContent)`;

/**
 * Asserts the overlap rule on the map as drawn now: no text over text or a
 * box, name tags at least 10 px, hop labels at least 9 px, and no text on
 * the map that the rule doesn't measure.
 */
const assertReadable = Effect.fnUntraced(function* (page: Page, where: string) {
  const report = yield* Effect.promise((): Promise<DrawingReport> =>
    page.evaluate(drawingReport)
  );

  const clashes = textClashes(report);

  const sizes = yield* Effect.promise(() =>
    page.evaluate<
      readonly number[]
    >(`[...document.querySelectorAll("[data-name-tag] text")]
      .map((text) => parseFloat(getComputedStyle(text).fontSize) * Math.hypot(text.getScreenCTM().a, text.getScreenCTM().b))`)
  );

  const labelSizes = yield* Effect.promise(() =>
    page.evaluate<
      readonly number[]
    >(`[...document.querySelectorAll("[data-hop-label]")]
      .filter((text) => getComputedStyle(text).visibility !== "hidden")
      .map((text) => parseFloat(getComputedStyle(text).fontSize) * Math.hypot(text.getScreenCTM().a, text.getScreenCTM().b))`)
  );

  const stray = yield* Effect.promise(() =>
    page.evaluate<readonly string[]>(strayText)
  );

  assert.isNotEmpty(report.text, where);
  assert.deepStrictEqual(clashes, [], `text over text or a box in ${where}`);
  assert.deepStrictEqual(
    stray,
    [],
    `text outside the overlap model in ${where}`
  );

  for (const size of sizes) {
    assert.isAtLeast(size, 9.95, `name tag size in ${where}`);
  }

  for (const size of labelSizes) {
    assert.isAtLeast(size, 8.95, `hop label size in ${where}`);
  }
});

/** Where each tab sits, rounded to whole pixels. */
const tabBoxes = Effect.fnUntraced(function* (page: Page) {
  const boxes = yield* boxesOf(page, '[role="tab"]');

  return Arr.map(boxes, ({ x, y, width }) => [
    Math.round(x),
    Math.round(y),
    Math.round(width),
  ]);
});

const dashOf = (page: Page, kind: string, id: string) =>
  attributeOf(page, ringOf(kind, id), "stroke-dasharray");

const strokeOfSelector = (page: Page, selector: string) =>
  Effect.promise(() =>
    page.evaluate<string>(
      `getComputedStyle(document.querySelector(${literal(selector)})).stroke`
    )
  );

const hopAccepted =
  '{ id: "h-pr", from: "proposals", to: "pull-request", label: "accepted" },';

const hopReads =
  '{ id: "h-read", from: "page", to: "proposals", label: "reads" },';

const ringOf = (kind: string, id: string) =>
  `[data-compare-ring="${kind}"][data-compare-structure="${id}"]`;

const openHistory = Effect.fnUntraced(function* (page: Page) {
  yield* click(page, '[role="tab"][data-tab="history"]');
  yield* waitFor(page, "[data-history-list] [data-revision]");
});

const openRevision = Effect.fnUntraced(function* (page: Page, n: number) {
  yield* click(page, `[data-history-list] [data-revision="${n}"]`);
  yield* waitFor(page, `[data-past-revision="${n}"]`);
});

/** Waits until proposals.json in `root` holds `wanted` pending layout changes. */
const waitForPendingCount = Effect.fnUntraced(function* (
  root: string,
  wanted: number
) {
  for (let tries = 0; tries < 150; tries += 1) {
    const proposals = yield* decodeProposals(
      yield* readIn(root, "review/map/proposals.json")
    );

    if (proposals.layout.length === wanted) {
      return proposals;
    }

    yield* Effect.sleep("100 millis");
  }

  return assert.fail(`proposals.json never held ${wanted} layout changes`);
});

describe("the History panel", () => {
  it.live(
    "lists revisions newest first with number, message, date and item count",
    () =>
      Effect.gen(function* () {
        const { page, errors } = yield* servedWithTwo;

        yield* openHistory(page);

        const numbers = yield* attributesOf(
          page,
          "[data-history-list] [data-revision]",
          "data-revision"
        );

        assert.deepStrictEqual(numbers, ["2", "1"]);

        const first = page
          .locator('[data-history-list] [data-revision="2"]')
          .first();

        const text = yield* Effect.promise(() => first.textContent());

        assert.include(text, "#2");
        assert.include(text, "Spread out");
        assert.include(text, "3 items");
        assert.include(
          yield* textOf(page, '[data-revision="1"] [data-revision-items]'),
          "1 item"
        );
        assert.match(
          (yield* attributeOf(page, '[data-revision="2"] time', "datetime")) ??
            "",
          /^\d{4}-\d{2}-\d{2}T/u
        );
        assert.deepStrictEqual(errors, []);
      }),
    60_000
  );

  it.live(
    "adds a line when a revision is saved, without a reload",
    () =>
      Effect.gen(function* () {
        const { page, serve } = yield* servedWithTwo;

        yield* openHistory(page);
        assert.strictEqual(
          yield* count(page, "[data-history-list] [data-revision]"),
          2
        );

        yield* acceptChanges(serve, {
          base: 4,
          changes: [moveOf("engineer-back", "engineer", { x: 0, y: 0 })],
          message: "Engineer home",
        });

        yield* waitFor(page, '[data-history-list] [data-revision="3"]');

        const first = yield* attributeOf(
          page,
          "[data-history-list] [data-revision]",
          "data-revision"
        );

        assert.strictEqual(first, "3");
      }).pipe(Effect.scoped),
    60_000
  );

  it.live(
    "opens an old revision read-only at its old positions, with a banner, and goes back",
    () =>
      Effect.gen(function* () {
        const { page, errors } = yield* servedWithTwo;

        const nowEngineer = yield* centreOf(page, "engineer");

        yield* openHistory(page);

        const tabsBefore = yield* tabBoxes(page);

        yield* openRevision(page, 1);

        const banner = yield* textOf(page, "[data-past-revision]");

        assert.include(banner, "Past revision 1");
        assert.include(banner, "Drop the page");
        assert.include(banner, "read-only");
        assert.strictEqual(
          yield* count(
            page,
            '[data-past-revision] [data-control="back-to-current"]'
          ),
          1
        );

        // Revision 1 has the engineer at (0, 0), above where revision 2 put it.
        const thenEngineer = yield* centreOf(page, "engineer");

        assert.isBelow(thenEngineer.y, nowEngineer.y - 20);

        // The same chapter, and the engineer can't be edited: no handles, no
        // toolbar, and a drag moves nothing. The Pending tab stays, switched
        // off with its count, so the tab strip doesn't move.
        assert.strictEqual(
          yield* attributeOf(page, "[data-walkthrough]", "data-chapter"),
          "c-all"
        );
        assert.strictEqual(yield* count(page, '[data-tab="pending"]'), 1);
        assert.strictEqual(
          yield* attributeOf(page, '[data-tab="pending"]', "disabled"),
          ""
        );
        assert.include(
          yield* textOf(page, '[data-tab="pending"]'),
          "Pending · 0"
        );
        assert.deepStrictEqual(
          yield* tabBoxes(page),
          tabsBefore,
          "the tab strip didn't move"
        );
        assert.strictEqual(yield* count(page, "[data-edit-toolbar]"), 0);
        assert.strictEqual(
          yield* count(page, '[data-structure][data-pending="true"]'),
          0
        );

        yield* click(page, '[data-structure="engineer"]');
        assert.strictEqual(yield* count(page, "[data-resize-handle]"), 0);

        const before = yield* centreOf(page, "engineer");

        yield* Effect.promise(() => page.mouse.move(before.x, before.y));
        yield* Effect.promise(() => page.mouse.down());
        yield* Effect.promise(() =>
          page.mouse.move(before.x, before.y + 80, { steps: 10 })
        );
        yield* Effect.promise(() => page.mouse.up());
        assert.strictEqual(yield* count(page, "[data-drag-outline]"), 0);

        // Switching the view keeps the revision open.
        yield* click(page, '[data-view-toggle] button[data-view="plan"]');
        yield* waitFor(page, '[data-walkthrough][data-view="plan"]');
        assert.strictEqual(yield* count(page, "[data-past-revision]"), 1);

        // Back to current: the banner goes, and the engineer is back.
        yield* click(page, '[data-control="back-to-current"]');
        yield* waitGone(page, "[data-past-revision]");
        yield* click(page, '[data-view-toggle] button[data-view="iso"]');
        yield* waitFor(page, '[data-walkthrough][data-view="iso"]');
        assert.strictEqual(
          yield* attributeOf(page, '[data-tab="pending"]', "disabled"),
          null
        );

        const back = yield* centreOf(page, "engineer");

        assert.closeTo(back.y, nowEngineer.y, 2);
        assert.deepStrictEqual(errors, []);
      }),
    60_000
  );

  it.live(
    "compares with the accepted map: each kind of difference is an outline with its own dash, a legend entry and a spoken label, and no text lands on the map",
    () =>
      Effect.gen(function* () {
        const { page, errors } = yield* servedWithTwo;

        yield* openHistory(page);
        yield* openRevision(page, 1);

        // Compare is off until asked for.
        assert.strictEqual(yield* count(page, "[data-compare-ring]"), 0);
        assert.strictEqual(yield* count(page, "[data-compare-legend]"), 0);

        yield* click(page, '[data-control="compare"]');
        yield* waitFor(page, "[data-compare-legend]");

        // Revision 1 against the accepted map: the engineer and the server
        // moved, and the page is 2 × 2 where the accepted map has it 3 × 2.
        assert.strictEqual(yield* count(page, ringOf("moved", "engineer")), 1);
        assert.strictEqual(yield* count(page, ringOf("moved", "server")), 1);
        assert.strictEqual(yield* count(page, ringOf("resized", "page")), 1);
        assert.strictEqual(yield* count(page, ringOf("moved", "page")), 0);
        assert.strictEqual(yield* count(page, ringOf("moved", "proposals")), 0);

        // The moved structure is outlined where the accepted map has it, in
        // ink and dotted, which the pink dashed ghost is not.
        assert.strictEqual(
          yield* count(page, '[data-compare-origin="engineer"]'),
          1
        );
        assert.notStrictEqual(
          yield* attributeOf(
            page,
            '[data-compare-origin="engineer"]',
            "stroke-dasharray"
          ),
          yield* dashOf(page, "moved", "engineer")
        );
        assert.notStrictEqual(
          yield* strokeOfSelector(page, '[data-compare-origin="engineer"]'),
          yield* strokeOfSelector(page, ringOf("moved", "engineer"))
        );

        // The kinds differ in dash, so no look rests on colour alone.
        assert.notStrictEqual(
          yield* dashOf(page, "moved", "engineer"),
          yield* dashOf(page, "resized", "page")
        );

        // Outlines only: there are no text badges, and nothing on the map
        // overlaps text, in either view.
        assert.strictEqual(yield* count(page, "[data-compare-badge]"), 0);

        for (const view of ["iso", "plan"] as const) {
          yield* click(page, `[data-view-toggle] button[data-view="${view}"]`);
          yield* waitFor(page, `[data-walkthrough][data-view="${view}"]`);
          yield* Effect.promise(() => page.keyboard.press("0"));
          yield* assertReadable(page, `compare in ${view}`);
        }

        // A screen reader hears the kind after the name.
        assert.include(
          (yield* attributeOf(
            page,
            '[data-structure="engineer"]',
            "aria-label"
          )) ?? "",
          "moved"
        );
        assert.include(
          (yield* attributeOf(page, '[data-structure="page"]', "aria-label")) ??
            "",
          "resized"
        );
        assert.strictEqual(
          (yield* attributeOf(
            page,
            '[data-structure="proposals"]',
            "aria-label"
          )) ?? "",
          "Proposals"
        );

        // The legend names every kind.
        const legend = yield* textOf(page, "[data-compare-legend]");

        for (const word of [
          "Moved",
          "Resized",
          "Text changed",
          "Only in this revision",
          "Only in the accepted map",
          "Where it is in the accepted map",
        ]) {
          assert.include(legend, word);
        }

        // The side panel lists each difference as text, and choosing one
        // selects the structure.
        yield* click(page, '[role="tab"][data-tab="history"]');
        yield* waitFor(page, "[data-difference-list]");
        assert.include(
          yield* textOf(page, "[data-difference-list]"),
          "Engineer moved from 0, 4 to 0, 0"
        );
        yield* click(page, '[data-difference="moved:engineer"] button');
        yield* waitFor(page, '[data-structure-panel="engineer"]');
        assert.include(
          yield* textOf(page, "[data-past-revision]"),
          "Against the accepted map"
        );

        // Compare off again clears the highlights.
        yield* click(page, '[data-control="compare"]');
        yield* waitGone(page, "[data-compare-legend]");
        assert.strictEqual(yield* count(page, "[data-compare-ring]"), 0);
        assert.deepStrictEqual(errors, []);
      }),
    60_000
  );

  it.live(
    "compares changed text, added and removed structures and hops, with ghosts, in both views",
    () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const fs = yield* FileSystem.FileSystem;
        const files = yield* fullMap;
        const root = yield* makeHome(files);
        const home = path.join(root, "review", "map");
        const serve = yield* startServe(home, ["--port", "0"]);

        yield* acceptChanges(serve, {
          base: 0,
          changes: [moveOf("drop-page", "page", { x: 4, y: 4 })],
          message: "Before the rewrite",
        });

        // The agent edits data.mjs: renames the server, rewords a hop, drops
        // the upstream structure and its chapter reveal, drops a hop and adds one.
        const dataFile = path.join(home, "data.mjs");
        const data = yield* fs.readFileString(dataFile);

        yield* fs.writeFileString(
          dataFile,
          pipe(
            data,
            Str.replace('name: "Save server"', 'name: "Save service"'),
            Str.replace('label: "write batch"', 'label: "writes a batch"'),
            Str.replace(hopAccepted, hopReads)
          )
        );

        const opened = yield* openUrl(serve.url);
        const { page, errors } = opened;

        yield* Effect.promise(() =>
          page.setViewportSize({ width: 1280, height: 800 })
        );
        yield* click(page, '[data-chapter-rail] button[data-chapter="c-all"]');
        yield* waitFor(page, '[data-walkthrough][data-chapter="c-all"]');
        // The page has the renamed server.
        yield* waitFor(
          page,
          '[data-structure="server"][aria-label="Save service"]'
        );

        yield* openHistory(page);
        yield* openRevision(page, 1);
        yield* click(page, '[data-control="compare"]');
        yield* waitFor(page, "[data-compare-legend]");

        for (const view of ["iso", "plan"] as const) {
          yield* click(page, `[data-view-toggle] button[data-view="${view}"]`);
          yield* waitFor(page, `[data-walkthrough][data-view="${view}"]`);

          // The revision names the server "Save server"; the accepted map "Save service".
          assert.include(
            (yield* attributeOf(
              page,
              '[data-structure="server"]',
              "aria-label"
            )) ?? "",
            "text changed"
          );

          // The hop only the revision has, the hop only the accepted map has
          // (a ghost), and the reworded hop each get a halo of their kind.
          const kindOfHop = (id: string) =>
            attributeOf(
              page,
              `[data-compare-hop="${id}"]`,
              "data-compare-kind"
            );

          assert.strictEqual(yield* kindOfHop("h-pr"), "added");
          assert.strictEqual(yield* kindOfHop("h-read"), "removed");
          assert.strictEqual(yield* kindOfHop("h-store"), "changed");
          assert.strictEqual(
            yield* count(page, '[data-compare-hop="h-note"]'),
            0
          );
          assert.include(
            (yield* attributeOf(
              page,
              '[data-compare-hop="h-pr"]',
              "aria-label"
            )) ?? "",
            "only in this revision"
          );

          yield* assertReadable(page, `compare with hops in ${view}`);
        }

        assert.deepStrictEqual(errors, []);
      }).pipe(Effect.provide(NodeServices.layer)),
    90_000
  );

  it.live(
    "restores a layout difference as pending changes the Pending tab lists, and writes proposals.json",
    () =>
      Effect.gen(function* () {
        const { root, serve, page, errors } = yield* servedWithTwo;

        yield* openHistory(page);
        yield* openRevision(page, 1);
        yield* click(page, '[data-control="restore"]');
        yield* waitFor(page, "[data-restore-dialog]");

        // Layout alone differs here, so the dialog reports what it did and
        // lists nothing as lost.
        const dialog = yield* textOf(page, "[data-restore-dialog]");

        assert.include(dialog, "Restore revision 1");
        assert.include(
          dialog,
          "3 layout differences are now pending changes. Review them in the Pending tab, or undo them."
        );
        assert.include(dialog, "Engineer moved from 0, 4 to 0, 0");
        assert.include(dialog, "Map page resized from 3 × 2 to 2 × 2");
        assert.strictEqual(yield* count(page, "[data-restore-meaning]"), 0);

        yield* click(page, '[data-control="close-restore"]');
        yield* waitGone(page, "[data-restore-dialog]");

        // The page is back on the current map, with the restore pending.
        assert.strictEqual(yield* count(page, "[data-past-revision]"), 0);
        yield* click(page, '[role="tab"][data-tab="pending"]');
        yield* waitFor(page, "[data-pending-change]");
        assert.strictEqual(
          yield* count(page, '[data-structure][data-pending="true"]'),
          3
        );

        // proposals.json holds the pending changes the dialog listed.
        yield* Effect.promise(() =>
          page
            .locator("[data-pending-change]")
            .first()
            .waitFor({ state: "visible", ...waitTimeout })
        );

        const proposals = yield* decodeProposals(
          yield* readIn(root, "review/map/proposals.json")
        );

        const moves = Arr.flatMap(proposals.layout, (change) =>
          change.kind === "move"
            ? Arr.map(change.moves, ({ target, position }) => ({
                kind: "move",
                id: target.id,
                x: position.x,
                y: position.y,
              }))
            : []
        );

        const resizes = Arr.flatMap(proposals.layout, (change) =>
          change.kind === "resize"
            ? [
                {
                  kind: "resize",
                  id: change.target.id,
                  x: change.footprint.w,
                  y: change.footprint.d,
                },
              ]
            : []
        );

        const summary = [...moves, ...resizes];

        assert.sameDeepMembers(summary, [
          { kind: "move", id: "engineer", x: 0, y: 0 },
          { kind: "move", id: "server", x: 8, y: 0 },
          { kind: "resize", id: "page", x: 2, y: 2 },
        ]);

        // Nothing is accepted: layout.json still has revision 2's positions,
        // and no third revision exists.
        const layout = yield* decodeLayout(
          yield* readIn(root, "review/map/layout.json")
        );

        assert.strictEqual(layout.structures.engineer?.y, 4);
        assert.strictEqual(layout.structures.page?.w, 3);

        // The restore is one undo step like any other edit.
        yield* click(page, '[data-control="undo"]');
        yield* waitGone(page, "[data-pending-change]");

        // A third revision moves the engineer back to where revision 2 has it
        // not, so restoring revision 2 differs in that one place, and the
        // dialog says so in the singular.
        const { revision: base } = yield* waitForPendingCount(root, 0);

        yield* acceptChanges(serve, {
          base,
          changes: [moveOf("engineer-home", "engineer", { x: 0, y: 0 })],
          message: "Engineer home",
        });
        yield* openHistory(page);
        yield* waitFor(page, '[data-history-list] [data-revision="3"]');
        yield* openRevision(page, 2);
        yield* click(page, '[data-control="restore"]');
        yield* waitFor(page, "[data-restore-dialog]");
        assert.include(
          yield* textOf(page, "[data-restore-done]"),
          "1 layout difference is now a pending change. Review it in the Pending tab, or undo it."
        );
        assert.deepStrictEqual(errors, []);
      }).pipe(Effect.scoped),
    90_000
  );

  it.live(
    "lists the meaning differences in the restore dialog instead of dropping them",
    () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const fs = yield* FileSystem.FileSystem;
        const root = yield* makeHome(yield* fullMap);
        const home = path.join(root, "review", "map");
        const serve = yield* startServe(home, ["--port", "0"]);

        yield* acceptChanges(serve, {
          base: 0,
          changes: [moveOf("drop-page", "page", { x: 4, y: 4 })],
          message: "Before the rewrite",
        });

        const dataFile = path.join(home, "data.mjs");
        const data = yield* fs.readFileString(dataFile);

        yield* fs.writeFileString(
          dataFile,
          pipe(
            data,
            Str.replace('name: "Save server"', 'name: "Save service"'),
            Str.replace(hopAccepted, "")
          )
        );

        const { page, errors } = yield* openUrl(serve.url);

        yield* Effect.promise(() =>
          page.setViewportSize({ width: 1280, height: 800 })
        );
        yield* click(page, '[data-chapter-rail] button[data-chapter="c-all"]');
        yield* waitFor(
          page,
          '[data-structure="server"][aria-label="Save service"]'
        );
        yield* openHistory(page);
        yield* openRevision(page, 1);
        yield* click(page, '[data-control="restore"]');
        yield* waitFor(page, "[data-restore-dialog]");

        const dialog = yield* textOf(page, "[data-restore-dialog]");

        assert.include(
          dialog,
          "These differences change the map's meaning and can't be restored as layout changes"
        );

        const lines = yield* Effect.promise(() =>
          page.locator('[data-restore-list="meaning"] li').allTextContents()
        );

        assert.deepStrictEqual(lines, [
          "Save service: name differs",
          'Hop "accepted" (Proposals → Pull request) is in revision 1, not in the accepted map',
        ]);

        // The layout is the same, so nothing became pending.
        assert.include(dialog, "same layout as the accepted map");
        yield* click(page, '[data-control="close-restore"]');
        yield* waitGone(page, "[data-restore-dialog]");
        assert.strictEqual(
          yield* count(page, '[data-structure][data-pending="true"]'),
          0
        );
        assert.deepStrictEqual(errors, []);
      }).pipe(Effect.provide(NodeServices.layer)),
    90_000
  );
});
