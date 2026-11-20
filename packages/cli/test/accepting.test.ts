import { LayoutFile, Revision } from "@axonometric/contracts";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Path, Schema } from "effect";

import {
  assertCount,
  assertTextIncludes,
  click,
  openUrl,
  waitFor,
  waitGone,
} from "./browser.ts";
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
    layout: [
      {
        id: "move-engineer",
        kind: "move",
        moves: [
          {
            position: { x: 0, y: 4 },
            target: { id: "engineer", kind: "structure" },
          },
        ],
      },
      {
        footprint: { d: 2, w: 3 },
        id: "resize-page",
        kind: "resize",
        target: { id: "page", kind: "structure" },
      },
    ],
    revision: 1,
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
        const { errors, page, root } = yield* servedWithPending;

        yield* assertCount(page, '[data-structure][data-pending="true"]', 2);

        yield* Effect.promise(() =>
          page
            .getByRole("button", { name: "Accept the move of Engineer" })
            .click()
        );

        yield* waitFor(page, '[data-saved-revision="1"]');
        yield* assertTextIncludes(
          page,
          "[data-saved-revision]",
          "Saved revision 1: Move Engineer"
        );

        yield* waitGone(
          page,
          '[data-structure="engineer"][data-pending="true"]'
        );
        yield* waitGone(page, '[data-accepted-outline="engineer"]');
        yield* waitGone(page, '[data-pending-change="move"]');

        // The other change is still pending.
        yield* assertCount(
          page,
          '[data-structure="page"][data-pending="true"]',
          1
        );
        yield* assertCount(page, "[data-pending-change]", 1);

        const historyFileExists = yield* exists(
          root,
          "review/map/history/0001.json"
        );

        // What the accept writes is accept-writes.test.ts's to check. The
        // page's accept reaches the history.
        assert.isTrue(historyFileExists, "history/0001.json");
        assert.deepStrictEqual(errors, []);
      }),
    60_000
  );

  it.live(
    "accepts all with the typed message, says nothing is left, and rebuilds what build writes",
    () =>
      Effect.gen(function* () {
        const { errors, page, root } = yield* servedWithPending;

        yield* Effect.promise(() =>
          page.getByLabel("Revision message (optional)").fill("Tidy the loop")
        );
        yield* Effect.promise(() =>
          page.getByRole("button", { name: "Accept all" }).click()
        );

        yield* waitFor(page, '[data-saved-revision="1"]');
        yield* waitGone(page, '[data-structure][data-pending="true"]');
        yield* waitGone(page, "[data-accepted-outline]");
        yield* assertCount(page, "[data-pending-change]", 0);

        const firstRevisionText = yield* readIn(
          root,
          "review/map/history/0001.json"
        );

        const revision = yield* decodeRevision(firstRevisionText);

        assert.strictEqual(revision.message, "Tidy the loop");

        // The Pending tab says what is left: nothing, and no Accept all.
        yield* waitFor(page, "[data-pending-list]");
        yield* assertTextIncludes(
          page,
          "[data-pending-list]",
          "Nothing is pending"
        );
        yield* assertCount(page, "[data-accept-all]", 0);

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
        const fullMapFiles = yield* fullMap;
        const root = yield* makeHome(fullMapFiles);
        const home = path.join(root, "review", "map");
        const serve = yield* startServe(home, ["--port", "0"]);
        const { page } = yield* openUrl(serve.url);

        yield* Effect.promise(() =>
          page.setViewportSize({ height: 800, width: 1280 })
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

        const firstRevisionText = yield* readIn(
          root,
          "review/map/history/0001.json"
        );

        const first = yield* decodeRevision(firstRevisionText);

        const secondRevisionText = yield* readIn(
          root,
          "review/map/history/0002.json"
        );

        const second = yield* decodeRevision(secondRevisionText);

        assert.strictEqual(first.revision, 1);
        assert.strictEqual(second.revision, 2);
        assert.notStrictEqual(first.layout.revision, second.layout.revision);
        assert.notDeepEqual(first.layout.structures, second.layout.structures);
        const layoutText = yield* readIn(root, "review/map/layout.json");
        const decodedLayout = yield* decodeLayout(layoutText);
        assert.deepStrictEqual(decodedLayout, second.layout);
      }).pipe(Effect.provide(NodeServices.layer)),
    60_000
  );
});
