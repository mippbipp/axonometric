import { LayoutFile } from "@axonometric/contracts";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect, FileSystem, Path, Schema } from "effect";
import type { Page } from "playwright";

import {
  assertAttribute,
  assertCount,
  assertTextIncludes,
  attributesOf,
  click,
  waitFor,
  waitGone,
} from "./browser.ts";
import {
  mapKeys,
  openReviewMap,
  readIn,
  readProposals,
  runCli,
} from "./harness.ts";

// The agent's layout changes in a page that a real serve serves: how the
// Pending tab and the map mark them, and what accepting, discarding and
// freezing do with them. Writing them is layout.test.ts's to check.

const decodeLayout = Schema.decodeUnknownEffect(LayoutFile);

const agentMove = (
  id: string,
  structure: string,
  at: { readonly reason: string; readonly x: number; readonly y: number }
) => ({
  by: "agent",
  id,
  kind: "move",
  moves: [
    {
      position: { x: at.x, y: at.y },
      target: { id: structure, kind: "structure" },
    },
  ],
  reason: at.reason,
});

const engineerMove = {
  by: "engineer",
  id: "engineer-move",
  kind: "move",
  moves: [
    {
      position: { x: 0, y: 4 },
      target: { id: "engineer", kind: "structure" },
    },
  ],
};

/** A proposals.json at file revision 1 that holds `layout`. */
const proposalsOf = (layout: ReadonlyArray<object>) => ({
  [mapKeys("review").proposalsFile]:
    `${JSON.stringify({ format: 1, layout, revision: 1 }, null, 2)}\n`,
});

/** Two agent moves with one reason: the page down, the server down. */
const tidyPage = agentMove("tidy-page", "page", {
  reason: "Tidy the loop",
  x: 4,
  y: 3,
});

const tidyRow = [
  tidyPage,
  agentMove("tidy-server", "server", {
    reason: "Tidy the loop",
    x: 8,
    y: 3,
  }),
];

const openPending = Effect.fnUntraced(function* (
  files: ReturnType<typeof proposalsOf>,
  options?: { readonly edit?: boolean }
) {
  const opened = yield* openReviewMap(files, options);

  yield* click(opened.page, '[role="tab"][data-tab="pending"]');
  yield* waitFor(opened.page, "[data-pending-list]");

  return opened;
});

const pressButton = (page: Page, name: string) =>
  Effect.promise(() => page.getByRole("button", { name }).click());

const exists = Effect.fnUntraced(function* (root: string, file: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  return yield* fs.exists(path.join(root, file));
}, Effect.provide(NodeServices.layer));

describe("the agent's layout changes in the page", () => {
  it.live(
    "marks each change by its author and groups consecutive ones under their reason",
    () =>
      Effect.gen(function* () {
        const { errors, home, page, root } = yield* openPending(
          proposalsOf([engineerMove])
        );

        // The agent proposes through the CLI while the page is open.
        for (const [structure, flag, value, reason] of [
          ["page", "--y", "3", "Tidy the loop"],
          ["server", "--w", "3", "Tidy the loop"],
          ["proposals", "--y", "4", "Make room"],
        ] as const) {
          const proposed = yield* runCli(root, [
            "layout",
            home,
            structure,
            flag,
            value,
            "--propose",
            "--reason",
            reason,
          ]);

          assert.strictEqual(proposed.exitCode, 0, proposed.stderr);
        }

        yield* Effect.promise(() =>
          page.locator("[data-pending-group]").nth(1).waitFor()
        );

        const rowAuthors = yield* attributesOf(
          page,
          "[data-pending-id]",
          "data-pending-by"
        );
        const reasons = yield* attributesOf(
          page,
          "[data-pending-group]",
          "data-pending-reason"
        );

        assert.deepStrictEqual(rowAuthors, [
          "engineer",
          "agent",
          "agent",
          "agent",
        ]);
        assert.deepStrictEqual(reasons, ["Tidy the loop", "Make room"]);
        yield* assertTextIncludes(
          page,
          '[data-pending-reason="Tidy the loop"]',
          "Proposed by the agent: Tidy the loop"
        );
        yield* assertCount(
          page,
          '[data-pending-reason="Tidy the loop"] [data-pending-id]',
          2
        );
        yield* assertCount(
          page,
          '[data-pending-reason="Make room"] [data-pending-id]',
          1
        );
        // A group of one has its change's own buttons only.
        yield* assertCount(page, "[data-accept-group]", 1);
        yield* assertCount(page, "[data-discard-group]", 1);

        // The first chapter draws these two structures.
        for (const [structure, by] of [
          ["engineer", "engineer"],
          ["page", "agent"],
        ] as const) {
          yield* assertAttribute(
            page,
            {
              name: "data-pending-by",
              selector: `[data-structure="${structure}"]`,
            },
            by
          );
        }

        assert.deepStrictEqual(errors, []);
      }),
    90_000
  );

  it.live(
    "accepts a group into one revision",
    () =>
      Effect.gen(function* () {
        const { errors, home, page, root } = yield* openPending(
          proposalsOf([engineerMove, ...tidyRow])
        );

        yield* pressButton(
          page,
          "Accept the agent's changes for Tidy the loop"
        );
        yield* waitFor(page, '[data-saved-revision="1"]');
        yield* waitGone(page, "[data-pending-group]");

        // The engineer's change stays pending.
        yield* assertCount(page, "[data-pending-id]", 1);

        const layoutText = yield* readIn(root, mapKeys("review").layoutFile);
        const layout = yield* decodeLayout(layoutText);
        const hasFirst = yield* exists(root, mapKeys("review").revisionFile(1));
        const hasSecond = yield* exists(
          root,
          mapKeys("review").revisionFile(2)
        );

        assert.deepStrictEqual(
          [layout.structures.page, layout.structures.server],
          [
            { d: 2, w: 2, x: 4, y: 3 },
            { d: 2, w: 2, x: 8, y: 3 },
          ]
        );
        assert.isTrue(hasFirst, "history/0001.json");
        assert.isFalse(hasSecond, "one revision for the group");

        const proposals = yield* readProposals(home);

        assert.deepStrictEqual(
          Arr.map(proposals.layout, ({ id }) => id),
          ["engineer-move"]
        );
        assert.deepStrictEqual(errors, []);
      }),
    60_000
  );

  it.live(
    "discards a group, leaving layout.json as it was",
    () =>
      Effect.gen(function* () {
        const { errors, home, page, root } = yield* openPending(
          proposalsOf(tidyRow)
        );

        yield* pressButton(
          page,
          "Discard the agent's changes for Tidy the loop"
        );
        yield* waitGone(page, "[data-pending-group]");
        yield* waitGone(page, '[data-structure][data-pending="true"]');

        const proposals = yield* readProposals(home);

        assert.deepStrictEqual(proposals.layout, []);

        const layoutText = yield* readIn(root, mapKeys("review").layoutFile);
        const layout = yield* decodeLayout(layoutText);

        assert.strictEqual(layout.revision, 0);
        assert.deepStrictEqual(layout.structures.page, {
          d: 2,
          w: 2,
          x: 4,
          y: 0,
        });
        assert.deepStrictEqual(errors, []);
      }),
    60_000
  );

  it.live(
    "shows no Accept or Discard while Edit is off",
    () =>
      Effect.gen(function* () {
        const { page } = yield* openPending(proposalsOf(tidyRow), {
          edit: false,
        });

        const buttons = [
          "[data-accept-group]",
          "[data-discard-group]",
          "[data-accept-change]",
          '[data-pending-id] button:has-text("Discard")',
        ];

        yield* assertCount(page, "[data-pending-group]", 1);
        yield* assertCount(page, "[data-pending-id]", 2);

        for (const selector of buttons) {
          yield* assertCount(page, selector, 0);
        }

        yield* click(page, "[data-edit-toggle]");

        for (const selector of buttons) {
          yield* waitFor(page, selector);
        }
      }),
    60_000
  );

  it.live(
    "keeps the agent's changes open when the engineer presses Ready for review",
    () =>
      Effect.gen(function* () {
        const { errors, home, page } = yield* openPending(
          proposalsOf([engineerMove, tidyPage])
        );

        yield* click(page, "[data-ready-for-review]");
        yield* waitFor(page, "[data-review-dialog][open]");
        yield* click(page, "[data-review-close]");
        yield* waitGone(page, "[data-review-dialog][open]");

        const proposals = yield* readProposals(home);

        const frozen = Arr.flatMap(proposals.batches ?? [], ({ items }) =>
          Arr.map(items, ({ id }) => id)
        );

        assert.deepStrictEqual(
          Arr.map(proposals.layout, ({ id }) => id),
          ["tidy-page"]
        );
        assert.deepStrictEqual(frozen, ["engineer-move"]);

        // The engineer's move waits for the agent, and the agent's change
        // is still the engineer's to accept or discard.
        yield* assertCount(page, "[data-pending-id]", 1);
        yield* assertAttribute(
          page,
          { name: "data-pending-by", selector: "[data-pending-id]" },
          "agent"
        );
        yield* waitFor(page, "[data-accept-change]");
        assert.deepStrictEqual(errors, []);
      }),
    60_000
  );
});
