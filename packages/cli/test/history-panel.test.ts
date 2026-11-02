import { LayoutFile, Proposals } from "@axonometric/contracts";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect, FileSystem, Path, Schema } from "effect";
import type { Page } from "playwright";

import { openUrl } from "./browser.ts";
import { fullMap } from "./fixtures.ts";
import { makeHome, startServe } from "./harness.ts";
import { acceptChanges, moveOf, resizeOf } from "./revisions.ts";

// The History panel in a page that a real serve serves: two revisions made
// through the API, then opened, compared and restored in Chromium.

const waitTimeout = { timeout: 15_000 };

const decodeLayout = Schema.decodeUnknownEffect(LayoutFile);

const decodeProposals = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Proposals)
);

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

const textOf = (page: Page, selector: string) =>
  Effect.promise(() =>
    page
      .locator(selector)
      .first()
      .textContent()
      .then((text) => text ?? "")
  );

const attributeOf = (page: Page, selector: string, name: string) =>
  Effect.promise(() => page.locator(selector).first().getAttribute(name));

const click = (page: Page, selector: string) =>
  Effect.promise(() => page.locator(selector).first().click());

/** Where the page's drawing puts structure `id`: its centre on screen. */
const centreOf = Effect.fnUntraced(function* (page: Page, id: string) {
  const box = yield* Effect.promise(() =>
    page.locator(`[data-structure="${id}"]`).first().boundingBox()
  );

  assert.isNotNull(box);

  return { x: (box?.x ?? 0) + (box?.width ?? 0) / 2, y: (box?.y ?? 0) + (box?.height ?? 0) / 2 };
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
  const path = yield* Path.Path;
  const root = yield* makeHome(yield* fullMap);
  const home = path.join(root, "review", "map");
  const serve = yield* startServe(home, ["--port", "0"]);

  yield* acceptChanges(
    serve.url,
    0,
    [moveOf("drop-page", "page", 4, 4)],
    "Drop the page"
  );
  yield* acceptChanges(
    serve.url,
    2,
    [
      moveOf("engineer-down", "engineer", 0, 4),
      resizeOf("page-wide", "page", 3, 2),
      moveOf("server-down", "server", 8, 4),
    ],
    "Spread out"
  );

  const opened = yield* openUrl(serve.url);

  yield* Effect.promise(() =>
    opened.page.setViewportSize({ width: 1280, height: 800 })
  );
  // The last chapter reveals every structure.
  yield* click(opened.page, '[data-chapter-rail] button[data-chapter="c-all"]');
  yield* waitFor(opened.page, '[data-walkthrough][data-chapter="c-all"]');

  return { root, home, serve, ...opened };
}).pipe(Effect.provide(NodeServices.layer));

const openHistory = Effect.fnUntraced(function* (page: Page) {
  yield* click(page, '[role="tab"][data-tab="history"]');
  yield* waitFor(page, "[data-history-list] [data-revision]");
});

const openRevision = Effect.fnUntraced(function* (page: Page, n: number) {
  yield* click(page, `[data-history-list] [data-revision="${n}"]`);
  yield* waitFor(page, `[data-past-revision="${n}"]`);
});

const readIn = Effect.fnUntraced(function* (root: string, file: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  return yield* fs.readFileString(path.join(root, file));
}, Effect.provide(NodeServices.layer));

describe("the History panel", () => {
  it.live(
    "lists revisions newest first with number, message, date and item count",
    () =>
      Effect.gen(function* () {
        const { page, errors } = yield* servedWithTwo;

        yield* openHistory(page);

        const numbers = yield* Effect.promise(() =>
          page.locator("[data-history-list] [data-revision]").evaluateAll(
            (rows) => rows.map((row) => row.getAttribute("data-revision"))
          )
        );

        assert.deepStrictEqual(numbers, ["2", "1"]);

        const first = page
          .locator('[data-history-list] [data-revision="2"]')
          .first();

        const text = yield* Effect.promise(() => first.innerText());

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

  it.live("adds a line when a revision is saved, without a reload", () =>
    Effect.gen(function* () {
      const { page, serve } = yield* servedWithTwo;

      yield* openHistory(page);
      assert.strictEqual(
        yield* count(page, "[data-history-list] [data-revision]"),
        2
      );

      yield* acceptChanges(
        serve.url,
        4,
        [moveOf("engineer-back", "engineer", 0, 0)],
        "Engineer home"
      );

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
        yield* openRevision(page, 1);

        const banner = yield* textOf(page, "[data-past-revision]");

        assert.include(banner, "Past revision 1");
        assert.include(banner, "Drop the page");
        assert.include(banner, "read-only");
        assert.strictEqual(
          yield* count(page, '[data-past-revision] [data-control="back-to-current"]'),
          1
        );

        // Revision 1 has the engineer at (0, 0), above where revision 2 put it.
        const thenEngineer = yield* centreOf(page, "engineer");

        assert.isBelow(thenEngineer.y, nowEngineer.y - 20);

        // The same chapter, and the engineer can't be edited: no handles, no
        // toolbar, no Pending tab, and a drag moves nothing.
        assert.strictEqual(
          yield* attributeOf(page, "[data-walkthrough]", "data-chapter"),
          "c-all"
        );
        assert.strictEqual(yield* count(page, '[data-tab="pending"]'), 0);
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
        assert.strictEqual(yield* count(page, '[data-tab="pending"]'), 1);

        const back = yield* centreOf(page, "engineer");

        assert.closeTo(back.y, nowEngineer.y, 2);
        assert.deepStrictEqual(errors, []);
      }),
    60_000
  );

  it.live(
    "compares with the current map: each kind of difference has its own look, legend and spoken label",
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

        // Revision 1 against the current map: the engineer and the server
        // moved, and the page is 2 × 2 where the current map has it 3 × 2.
        const ringOf = (kind: string, id: string) =>
          `[data-compare-ring="${kind}"][data-compare-structure="${id}"]`;

        assert.strictEqual(yield* count(page, ringOf("moved", "engineer")), 1);
        assert.strictEqual(yield* count(page, ringOf("moved", "server")), 1);
        assert.strictEqual(yield* count(page, ringOf("resized", "page")), 1);
        assert.strictEqual(yield* count(page, ringOf("moved", "page")), 0);
        assert.strictEqual(yield* count(page, ringOf("moved", "proposals")), 0);

        // The moved structure keeps a faint outline where the current map has it.
        assert.strictEqual(
          yield* count(page, '[data-compare-origin="engineer"]'),
          1
        );

        // The kinds differ in dash, so no look rests on colour alone.
        const dashOf = (kind: string, id: string) =>
          attributeOf(page, ringOf(kind, id), "stroke-dasharray");

        assert.notStrictEqual(
          yield* dashOf("moved", "engineer"),
          yield* dashOf("resized", "page")
        );

        assert.include(
          yield* textOf(page, '[data-compare-badge="engineer"]'),
          "moved"
        );

        // A screen reader hears the kind after the name.
        assert.include(
          (yield* attributeOf(page, '[data-structure="engineer"]', "aria-label")) ??
            "",
          "moved"
        );
        assert.include(
          (yield* attributeOf(page, '[data-structure="page"]', "aria-label")) ??
            "",
          "resized"
        );
        assert.strictEqual(
          (yield* attributeOf(page, '[data-structure="proposals"]', "aria-label")) ??
            "",
          "Proposals"
        );

        // The legend names every kind.
        const legend = yield* textOf(page, "[data-compare-legend]");

        for (const word of [
          "Moved",
          "Resized",
          "Text changed",
          "Only in this revision",
          "Only in the current map",
        ]) {
          assert.include(legend, word);
        }

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

        yield* acceptChanges(
          serve.url,
          0,
          [moveOf("drop-page", "page", 4, 4)],
          "Before the rewrite"
        );

        // The agent edits data.mjs: renames the server, rewords a hop, drops
        // the upstream structure and its chapter reveal, drops a hop and adds one.
        const dataFile = path.join(home, "data.mjs");
        const data = yield* fs.readFileString(dataFile);

        yield* fs.writeFileString(
          dataFile,
          data
            .replace('name: "Save server"', 'name: "Save service"')
            .replace('label: "write batch"', 'label: "writes a batch"')
            .replace(
              '{ id: "h-pr", from: "proposals", to: "pull-request", label: "accepted" },',
              '{ id: "h-read", from: "page", to: "proposals", label: "reads" },'
            )
        );

        const opened = yield* openUrl(serve.url);
        const { page, errors } = opened;

        yield* Effect.promise(() => page.setViewportSize({ width: 1280, height: 800 }));
        yield* click(page, '[data-chapter-rail] button[data-chapter="c-all"]');
        yield* waitFor(page, '[data-walkthrough][data-chapter="c-all"]');
        // The page has the renamed server.
        yield* waitFor(page, '[data-structure="server"][aria-label="Save service"]');

        yield* openHistory(page);
        yield* openRevision(page, 1);
        yield* click(page, '[data-control="compare"]');
        yield* waitFor(page, "[data-compare-legend]");

        for (const view of ["iso", "plan"] as const) {
          yield* click(page, `[data-view-toggle] button[data-view="${view}"]`);
          yield* waitFor(page, `[data-walkthrough][data-view="${view}"]`);

          // The revision names the server "Save server"; the current map "Save service".
          assert.include(
            (yield* attributeOf(page, '[data-structure="server"]', "aria-label")) ??
              "",
            "text changed"
          );

          // The hop only the revision has, and the hop only the current map
          // has (drawn as a ghost), each in their own look.
          assert.strictEqual(
            yield* attributeOf(page, '[data-hop="h-pr"]', "data-compare"),
            "added"
          );
          assert.strictEqual(
            yield* attributeOf(page, '[data-hop="h-read"]', "data-compare"),
            "removed"
          );
          assert.strictEqual(
            yield* attributeOf(page, '[data-hop="h-store"]', "data-compare"),
            "changed"
          );
          assert.strictEqual(
            yield* attributeOf(page, '[data-hop="h-note"]', "data-compare"),
            null
          );
        }

        assert.deepStrictEqual(errors, []);
      }).pipe(Effect.provide(NodeServices.layer)),
    90_000
  );

  it.live(
    "restores a layout difference as pending changes the Pending tab lists, and writes proposals.json",
    () =>
      Effect.gen(function* () {
        const { root, page, errors } = yield* servedWithTwo;

        yield* openHistory(page);
        yield* openRevision(page, 1);
        yield* click(page, '[data-control="restore"]');
        yield* waitFor(page, "[data-restore-dialog]");

        // Layout alone differs here, so the dialog reports what it did and
        // lists nothing as lost.
        const dialog = yield* textOf(page, "[data-restore-dialog]");

        assert.include(dialog, "Restore revision 1");
        assert.include(dialog, "pending change");
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

        const summary = Arr.flatMap(proposals.layout, (change) =>
          change.kind === "move"
            ? Arr.map(change.moves, ({ target, position }) => ({
                kind: "move",
                id: target.id,
                x: position.x,
                y: position.y,
              }))
            : [
                {
                  kind: "resize",
                  id: change.target.id,
                  x: change.footprint.w,
                  y: change.footprint.d,
                },
              ]
        );

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
        assert.deepStrictEqual(errors, []);
      }),
    60_000
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

        yield* acceptChanges(
          serve.url,
          0,
          [moveOf("drop-page", "page", 4, 4)],
          "Before the rewrite"
        );

        const dataFile = path.join(home, "data.mjs");
        const data = yield* fs.readFileString(dataFile);

        yield* fs.writeFileString(
          dataFile,
          data
            .replace('name: "Save server"', 'name: "Save service"')
            .replace(
              '{ id: "h-pr", from: "proposals", to: "pull-request", label: "accepted" },',
              ""
            )
        );

        const { page, errors } = yield* openUrl(serve.url);

        yield* Effect.promise(() => page.setViewportSize({ width: 1280, height: 800 }));
        yield* click(page, '[data-chapter-rail] button[data-chapter="c-all"]');
        yield* waitFor(page, '[data-structure="server"][aria-label="Save service"]');
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
          page
            .locator('[data-restore-list="meaning"] li')
            .evaluateAll((items) => items.map((item) => item.textContent))
        );

        assert.deepStrictEqual(lines, [
          "Save service: name differs",
          'Hop "accepted" (Proposals → Pull request) is in revision 1, not in the current map',
        ]);

        // The layout is the same, so nothing became pending.
        assert.include(dialog, "same layout");
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
