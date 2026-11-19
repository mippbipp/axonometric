import { LayoutFile, Revision } from "@axonometric/contracts";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Path, Schema } from "effect";

import { click, count, openUrl, textOf, waitFor, waitGone } from "./browser.ts";
import { fullMap } from "./fixtures.ts";
import {
  makeHome,
  openReviewMap,
  readIn,
  runCli,
  startServe,
} from "./harness.ts";

// Accepting pending layout changes in a page that a real serve serves: what
// the Pending tab shows, and what lands on disk.

const decodeLayout = Schema.decodeUnknownEffect(LayoutFile);

const decodeRevision = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Revision)
);

/** A proposals.json that moves the engineer and the page, at file revision 1. */
const pendingProposals = `${JSON.stringify(
  {
    format: 1,
    revision: 1,
    layout: [
      {
        id: "move-engineer",
        kind: "move",
        moves: [
          {
            target: { kind: "structure", id: "engineer" },
            position: { x: 0, y: 4 },
          },
        ],
      },
      {
        id: "resize-page",
        kind: "resize",
        target: { kind: "structure", id: "page" },
        footprint: { w: 3, d: 2 },
      },
    ],
  },
  null,
  2
)}\n`;

/** The review map with two pending changes, served on a free port and opened. */
const servedWithPending = Effect.gen(function* () {
  const opened = yield* openReviewMap({
    "review/map/proposals.json": pendingProposals,
  });

  yield* click(opened.page, '[role="tab"][data-tab="pending"]');
  yield* waitFor(opened.page, "[data-pending-list]");

  return opened;
});

/** Whether `file` is in `root`, relative to it. */
const exists = Effect.fnUntraced(function* (root: string, file: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  return yield* fs.exists(path.join(root, file));
}, Effect.provide(NodeServices.layer));

describe("accepting layout changes in the page", () => {
  it.live(
    "accepts one change from its button, and the pending look goes",
    () =>
      Effect.gen(function* () {
        const { root, page, errors } = yield* servedWithPending;

        const value = yield* count(
          page,
          '[data-structure][data-pending="true"]'
        );

        assert.strictEqual(value, 2);

        yield* Effect.promise(() =>
          page
            .getByRole("button", { name: "Accept the move of Engineer" })
            .click()
        );

        yield* waitFor(page, '[data-saved-revision="1"]');
        const value_1 = yield* textOf(page, "[data-saved-revision]");
        assert.include(value_1, "Saved revision 1: Move Engineer");

        yield* waitGone(
          page,
          '[data-structure="engineer"][data-pending="true"]'
        );
        yield* waitGone(page, '[data-accepted-outline="engineer"]');
        yield* waitGone(page, '[data-pending-change="move"]');

        const value_2 = yield* count(
          page,
          '[data-structure="page"][data-pending="true"]'
        );

        // The other change is still pending.
        assert.strictEqual(value_2, 1);
        const value_3 = yield* count(page, "[data-pending-change]");
        assert.strictEqual(value_3, 1);

        const value_4 = yield* exists(root, "review/map/history/0001.json");
        // What the accept writes is accept-writes.test.ts's to check. The
        // page's accept reaches the history.
        assert.isTrue(value_4, "history/0001.json");
        assert.deepStrictEqual(errors, []);
      }),
    60_000
  );

  it.live(
    "accepts all with the typed message, says nothing is left, and rebuilds what build writes",
    () =>
      Effect.gen(function* () {
        const { root, page, errors } = yield* servedWithPending;

        yield* Effect.promise(() =>
          page.getByLabel("Revision message (optional)").fill("Tidy the loop")
        );
        yield* Effect.promise(() =>
          page.getByRole("button", { name: "Accept all" }).click()
        );

        yield* waitFor(page, '[data-saved-revision="1"]');
        yield* waitGone(page, '[data-structure][data-pending="true"]');
        yield* waitGone(page, "[data-accepted-outline]");
        const value = yield* count(page, "[data-pending-change]");
        assert.strictEqual(value, 0);

        const value_5 = yield* readIn(root, "review/map/history/0001.json");
        const revision = yield* decodeRevision(value_5);

        assert.strictEqual(revision.message, "Tidy the loop");

        // The Pending tab says what is left: nothing, and no Accept all.
        yield* waitFor(page, "[data-pending-list]");
        const value_6 = yield* textOf(page, "[data-pending-list]");
        assert.include(value_6, "Nothing is pending");
        const value_7 = yield* count(page, "[data-accept-all]");
        assert.strictEqual(value_7, 0);

        // What accept rebuilt is what `build` writes for the same files.
        const systemMd = yield* readIn(root, "review/SYSTEM.md");
        const readOnly = yield* readIn(root, "review/review.html");

        const built = yield* runCli(root, ["build", `${root}/review/map`]);

        assert.strictEqual(built.exitCode, 0, built.stderr);
        assert.strictEqual(built.files["review/SYSTEM.md"], systemMd);
        assert.strictEqual(built.files["review/review.html"], readOnly);
        assert.deepStrictEqual(errors, []);
      }),
    60_000
  );

  it.live(
    "takes the page's own drag, then accepts it as revision 1 and a second drag as revision 2",
    () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const fullMap_1 = yield* fullMap;
        const root = yield* makeHome(fullMap_1);
        const home = path.join(root, "review", "map");
        const serve = yield* startServe(home, ["--port", "0"]);
        const { page } = yield* openUrl(serve.url);

        yield* Effect.promise(() =>
          page.setViewportSize({ width: 1280, height: 800 })
        );
        yield* Effect.promise(() =>
          page.locator('[role="tab"][data-tab="pending"]').click()
        );

        const drag = Effect.fnUntraced(function* (to: number) {
          const box = yield* Effect.promise(() =>
            page.locator('[data-structure="engineer"]').first().boundingBox()
          );

          assert.isNotNull(box);

          const from = {
            x: (box?.x ?? 0) + (box?.width ?? 0) / 2,
            y: (box?.y ?? 0) + (box?.height ?? 0) / 2,
          };

          yield* Effect.promise(() => page.mouse.move(from.x, from.y));
          yield* Effect.promise(() => page.mouse.down());
          yield* Effect.promise(() =>
            page.mouse.move(from.x, from.y + to, { steps: 12 })
          );
          yield* Effect.promise(() => page.mouse.up());
        });

        yield* drag(120);
        yield* waitFor(page, '[data-pending-change="move"]');
        yield* Effect.promise(() =>
          page.getByRole("button", { name: "Accept all" }).click()
        );
        yield* waitFor(page, '[data-saved-revision="1"]');

        yield* drag(-60);
        yield* waitFor(page, '[data-pending-change="move"]');
        yield* Effect.promise(() =>
          page.getByRole("button", { name: "Accept all" }).click()
        );
        yield* waitFor(page, '[data-saved-revision="2"]');

        const value = yield* readIn(root, "review/map/history/0001.json");
        const first = yield* decodeRevision(value);

        const value_8 = yield* readIn(root, "review/map/history/0002.json");
        const second = yield* decodeRevision(value_8);

        assert.strictEqual(first.revision, 1);
        assert.strictEqual(second.revision, 2);
        assert.notStrictEqual(first.layout.revision, second.layout.revision);
        assert.notDeepEqual(first.layout.structures, second.layout.structures);
        const value_9 = yield* readIn(root, "review/map/layout.json");
        const decodedLayout = yield* decodeLayout(value_9);
        assert.deepStrictEqual(decodedLayout, second.layout);
      }).pipe(Effect.provide(NodeServices.layer)),
    60_000
  );
});
