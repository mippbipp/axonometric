import { LayoutFile, Proposals, Revision } from "@axonometric/contracts";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect, FileSystem, Path, Schema } from "effect";
import type { Page } from "playwright";

import { openUrl } from "./browser.ts";
import { fullMap } from "./fixtures.ts";
import { makeHome, runCli, startServe } from "./harness.ts";

// Accepting pending layout changes in a page that a real serve serves: what
// the Pending tab shows, and what lands on disk.

const waitTimeout = { timeout: 15_000 };

const decodeLayout = Schema.decodeUnknownEffect(LayoutFile);

const decodeProposals = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Proposals)
);

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
  const path = yield* Path.Path;

  const root = yield* makeHome({
    ...(yield* fullMap),
    "review/map/proposals.json": pendingProposals,
  });

  const home = path.join(root, "review", "map");
  const serve = yield* startServe(home, ["--port", "0"]);
  const opened = yield* openUrl(serve.url);

  yield* Effect.promise(() =>
    opened.page.setViewportSize({ width: 1280, height: 800 })
  );
  yield* Effect.promise(() =>
    opened.page.locator('[role="tab"][data-tab="pending"]').click()
  );
  yield* Effect.promise(() =>
    opened.page.locator("[data-pending-list]").waitFor(waitTimeout)
  );

  return { root, home, serve, ...opened };
}).pipe(Effect.provide(NodeServices.layer));

const count = (page: Page, selector: string) =>
  Effect.promise(() => page.locator(selector).count());

const waitGone = (page: Page, selector: string) =>
  Effect.promise(() =>
    page
      .locator(selector)
      .first()
      .waitFor({ state: "detached", ...waitTimeout })
  );

const textOf = (page: Page, selector: string) =>
  Effect.promise(() => page.locator(selector).first().textContent());

const waitFor = (page: Page, selector: string) =>
  Effect.promise(() => page.locator(selector).first().waitFor(waitTimeout));

/** The text of `file` in `root`, relative to it. */
const readIn = Effect.fnUntraced(function* (root: string, file: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  return yield* fs.readFileString(path.join(root, file));
}, Effect.provide(NodeServices.layer));

describe("accepting layout changes in the page", () => {
  it.live(
    "accepts one change: layout.json, proposals.json and history/0001.json change together, and the pending look goes",
    () =>
      Effect.gen(function* () {
        const { root, page, errors } = yield* servedWithPending;

        assert.strictEqual(
          yield* count(page, '[data-structure][data-pending="true"]'),
          2
        );

        yield* Effect.promise(() =>
          page
            .getByRole("button", { name: "Accept the move of Engineer" })
            .click()
        );

        yield* waitFor(page, '[data-saved-revision="1"]');
        assert.include(
          yield* textOf(page, "[data-saved-revision]"),
          "Saved revision 1: Move Engineer"
        );

        yield* waitGone(
          page,
          '[data-structure="engineer"][data-pending="true"]'
        );
        yield* waitGone(page, '[data-accepted-outline="engineer"]');
        yield* waitGone(page, '[data-pending-change="move"]');

        // The other change is still pending.
        assert.strictEqual(
          yield* count(page, '[data-structure="page"][data-pending="true"]'),
          1
        );
        assert.strictEqual(yield* count(page, "[data-pending-change]"), 1);

        const layout = yield* decodeLayout(
          yield* readIn(root, "review/map/layout.json")
        );

        assert.deepStrictEqual(layout.structures.engineer, {
          x: 0,
          y: 4,
          w: 2,
          d: 2,
        });
        assert.deepStrictEqual(layout.structures.page, {
          x: 4,
          y: 0,
          w: 2,
          d: 2,
        });

        const proposals = yield* decodeProposals(
          yield* readIn(root, "review/map/proposals.json")
        );

        assert.strictEqual(proposals.revision, 2);
        assert.deepStrictEqual(
          Arr.map(proposals.layout, ({ id }) => id),
          ["resize-page"]
        );

        const revision = yield* decodeRevision(
          yield* readIn(root, "review/map/history/0001.json")
        );

        assert.strictEqual(revision.revision, 1);
        assert.strictEqual(revision.message, "Move Engineer");
        assert.deepStrictEqual(
          Arr.map(revision.accepted, ({ change }) => change.id),
          ["move-engineer"]
        );
        assert.deepStrictEqual(revision.rejected, []);
        assert.deepStrictEqual(revision.layout, layout);
        assert.strictEqual(revision.data.structures.length, 6);
        assert.deepStrictEqual(errors, []);
      }),
    60_000
  );

  it.live(
    "accepts all with the typed message, and rebuilds SYSTEM.md and the read-only page",
    () =>
      Effect.gen(function* () {
        const { root, page, errors } = yield* servedWithPending;

        const html = yield* readIn(root, "review/review.html");

        assert.notInclude(html, '"y":4');

        yield* Effect.promise(() =>
          page.getByLabel("Revision message (optional)").fill("Tidy the loop")
        );
        yield* Effect.promise(() =>
          page.getByRole("button", { name: "Accept all" }).click()
        );

        yield* waitFor(page, '[data-saved-revision="1"]');
        yield* waitGone(page, '[data-structure][data-pending="true"]');
        yield* waitGone(page, "[data-accepted-outline]");
        assert.strictEqual(yield* count(page, "[data-pending-change]"), 0);

        const revision = yield* decodeRevision(
          yield* readIn(root, "review/map/history/0001.json")
        );

        assert.strictEqual(revision.message, "Tidy the loop");
        assert.strictEqual(revision.accepted.length, 2);

        const proposals = yield* decodeProposals(
          yield* readIn(root, "review/map/proposals.json")
        );

        assert.deepStrictEqual(proposals.layout, []);

        // The read-only page now draws the accepted layout.
        assert.include(yield* readIn(root, "review/review.html"), '"y":4');

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
    "writes a message from the changes when the field is empty, and the Pending tab says what is left",
    () =>
      Effect.gen(function* () {
        const { root, page } = yield* servedWithPending;

        yield* Effect.promise(() =>
          page.getByRole("button", { name: "Accept all" }).click()
        );
        yield* waitFor(page, '[data-saved-revision="1"]');

        const revision = yield* decodeRevision(
          yield* readIn(root, "review/map/history/0001.json")
        );

        assert.strictEqual(revision.message, "Move Engineer; resize Map page");

        yield* waitFor(page, "[data-pending-list]");
        assert.include(
          yield* textOf(page, "[data-pending-list]"),
          "Nothing is pending"
        );
        assert.strictEqual(yield* count(page, "[data-accept-all]"), 0);
      }),
    60_000
  );

  it.live(
    "takes the page's own drag, then accepts it as revision 1 and a second drag as revision 2",
    () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const root = yield* makeHome(yield* fullMap);
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

        const first = yield* decodeRevision(
          yield* readIn(root, "review/map/history/0001.json")
        );

        const second = yield* decodeRevision(
          yield* readIn(root, "review/map/history/0002.json")
        );

        assert.strictEqual(first.revision, 1);
        assert.strictEqual(second.revision, 2);
        assert.notStrictEqual(first.layout.revision, second.layout.revision);
        assert.notDeepEqual(first.layout.structures, second.layout.structures);
        assert.deepStrictEqual(
          yield* decodeLayout(yield* readIn(root, "review/map/layout.json")),
          second.layout
        );
      }).pipe(Effect.provide(NodeServices.layer)),
    60_000
  );
});
