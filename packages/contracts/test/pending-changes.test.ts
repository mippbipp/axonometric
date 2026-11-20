import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect, Record as Rec } from "effect";

import { alignMoves, distributeMoves, nudgeMoves } from "../src/index.ts";
import type {
  Alignment,
  Axis,
  GridPoint,
  LayoutChange,
  PendingEdit,
} from "../src/index.ts";
import { fixture } from "./fixture-maps.ts";
import { idsOf, inMemoryPage } from "./in-memory-page.ts";

// The review map has engineer, page, server, proposals, pull-request and
// upstream at 0,0, 4,0, 8,0, 8,6, 12,6 and 18,0.

/** The review map, served with nothing pending. */
const servedReview = fixture("review").pipe(
  Effect.map(({ data, layout }) =>
    inMemoryPage({ data, layout, system: "review" })
  )
);

const align = (how: Alignment, ids: ReadonlyArray<string>): PendingEdit => ({
  _tag: "Arrange",
  plan: (placements) => alignMoves({ how, ids, placements }),
});

const distribute = (axis: Axis, ids: ReadonlyArray<string>): PendingEdit => ({
  _tag: "Arrange",
  plan: (placements) => distributeMoves({ axis, ids, placements }),
});

const nudge = (ids: ReadonlyArray<string>, delta: GridPoint): PendingEdit => ({
  _tag: "Arrange",
  plan: (placements) => nudgeMoves({ delta, ids, placements }),
});

const apply = (edit: PendingEdit) => ({ _tag: "Apply", edit }) as const;

/** The moves a one-change list holds, as `id -> position`. */
const movesOf = (layout: ReadonlyArray<LayoutChange>) => {
  const [change, ...rest] = layout;

  assert.strictEqual(rest.length, 0, "expected exactly one change");

  return change?.kind === "move"
    ? Rec.fromEntries(
        Arr.map(
          change.moves,
          ({ position, target }) => [target.id, position] as const
        )
      )
    : {};
};

const clearedHistory =
  "Accepted changes can't be undone. Edits before this point are cleared from undo.";

describe("pending changes on a served page", () => {
  it.effect(
    "each align and distribute is one change that one undo takes back",
    () =>
      Effect.gen(function* () {
        const page = yield* servedReview;

        const cases: ReadonlyArray<{
          readonly edit: PendingEdit;
          readonly expected: Readonly<Record<string, GridPoint>>;
        }> = [
          {
            edit: align("top", ["engineer", "page", "pull-request"]),
            expected: { "pull-request": { x: 12, y: 0 } },
          },
          {
            edit: align("bottom", ["engineer", "page", "pull-request"]),
            expected: { engineer: { x: 0, y: 5.5 }, page: { x: 4, y: 5.5 } },
          },
          {
            edit: align("centre-y", ["engineer", "page", "pull-request"]),
            expected: {
              engineer: { x: 0, y: 3 },
              page: { x: 4, y: 3 },
              "pull-request": { x: 12, y: 3 },
            },
          },
          {
            edit: align("left", ["page", "pull-request"]),
            expected: { "pull-request": { x: 4, y: 6 } },
          },
          {
            edit: align("right", ["server", "pull-request"]),
            expected: { server: { x: 12, y: 0 } },
          },
          {
            edit: align("centre-x", ["engineer", "pull-request"]),
            expected: {
              engineer: { x: 6, y: 0 },
              "pull-request": { x: 6, y: 6 },
            },
          },
          {
            edit: distribute("x", ["engineer", "proposals", "upstream"]),
            expected: { proposals: { x: 9, y: 6 } },
          },
          {
            edit: distribute("y", ["engineer", "page", "proposals"]),
            expected: { page: { x: 4, y: 3 } },
          },
        ];

        for (const [index, { edit, expected }] of cases.entries()) {
          assert.isUndefined(page.dispatch(apply(edit)));
          page.settle();

          const saved = page.server.state().proposals;

          assert.strictEqual(saved?.revision, 2 * index + 1);
          assert.deepStrictEqual(movesOf(saved?.layout ?? []), expected);
          assert.isTrue(page.view().canUndo);

          page.dispatch({ _tag: "Undo" });
          page.settle();

          assert.strictEqual(
            page.server.state().proposals?.revision,
            2 * index + 2
          );
          assert.deepStrictEqual(page.server.state().proposals?.layout, []);
          assert.deepStrictEqual(page.view().pending, []);
          assert.isFalse(page.view().canUndo);
          assert.isTrue(page.view().canRedo);
        }

        assert.strictEqual(page.server.sent().length, 2 * cases.length);
      })
  );

  it.effect(
    "an alignment that changes nothing is neither a write nor an undo step",
    () =>
      Effect.gen(function* () {
        const page = yield* servedReview;

        // Engineer and page already share their top edge.
        const refusal = page.dispatch(
          apply(align("top", ["engineer", "page"]))
        );

        assert.isUndefined(refusal);
        page.settle();

        assert.deepStrictEqual(page.server.sent(), []);
        assert.isFalse(page.view().canUndo);
      })
  );

  it.effect("redo puts back what undo took, and a new edit clears redo", () =>
    Effect.gen(function* () {
      const page = yield* servedReview;

      page.dispatch(apply(nudge(["engineer"], { x: 0, y: 3.5 })));
      page.settle();

      const moved = page.server.state().proposals?.layout ?? [];

      page.dispatch({ _tag: "Undo" });
      page.settle();
      page.dispatch({ _tag: "Redo" });
      page.settle();

      assert.deepStrictEqual(page.server.state().proposals?.layout, moved);
      assert.isFalse(page.view().canRedo);

      page.dispatch({ _tag: "Undo" });
      page.settle();
      assert.isTrue(page.view().canRedo);

      page.dispatch(apply(nudge(["server"], { x: 0.5, y: 0 })));
      page.settle();

      assert.strictEqual(page.server.state().proposals?.revision, 5);
      assert.isFalse(page.view().canRedo);
      assert.isTrue(page.view().canUndo);
    })
  );

  it.effect(
    "undo keeps the step and shows a conflict when the file changed underneath, and writes nothing",
    () =>
      Effect.gen(function* () {
        const page = yield* servedReview;

        page.dispatch(apply(nudge(["engineer"], { x: 0, y: 3.5 })));
        page.settle();

        const mine = page.server.state().proposals?.layout ?? [];
        const other: LayoutChange = {
          id: "other-writer",
          kind: "move",
          moves: [
            {
              position: { x: 18, y: 4 },
              target: { id: "upstream", kind: "structure" },
            },
          ],
        };

        page.server.writeLayout([...mine, other]);

        assert.deepStrictEqual(idsOf(page.view().pending), [
          ...idsOf(mine),
          "other-writer",
        ]);

        page.dispatch({ _tag: "Undo" });
        page.settle();

        assert.strictEqual(page.view().notice?.kind, "conflict");
        assert.strictEqual(page.server.sent().length, 1);
        assert.strictEqual(page.server.state().proposals?.revision, 2);
        const savedIds = idsOf(page.server.state().proposals?.layout ?? []);

        assert.deepStrictEqual(savedIds, [...idsOf(mine), "other-writer"]);
        assert.isTrue(page.view().canUndo);
      })
  );

  it.effect(
    "a stale write runs the edit again on the fresher file and keeps both writers' changes",
    () =>
      Effect.gen(function* () {
        const page = yield* servedReview;

        page.dispatch(apply(nudge(["upstream"], { x: 0, y: 4 })));

        // Another writer gets in before the page's write is sent.
        page.server.writeLayout([
          {
            id: "other-writer",
            kind: "move",
            moves: [
              {
                position: { x: 4, y: 3 },
                target: { id: "page", kind: "structure" },
              },
            ],
          },
        ]);
        page.settle();

        const bases = Arr.map(
          page.server.sent(),
          ({ baseFileRevision }) => baseFileRevision
        );

        assert.deepStrictEqual(bases, [0, 1]);
        assert.strictEqual(page.server.state().proposals?.revision, 2);
        assert.deepStrictEqual(idsOf(page.view().pending), [
          "other-writer",
          "c1",
        ]);
        assert.isNull(page.view().notice);
      })
  );

  it.effect(
    "a stale write whose edit no longer fits keeps the other writer's changes and says it conflicted",
    () =>
      Effect.gen(function* () {
        const page = yield* servedReview;

        page.dispatch(apply(nudge(["engineer"], { x: 0, y: 4 })));
        page.server.writeLayout([
          {
            id: "other-writer",
            kind: "move",
            moves: [
              {
                position: { x: 0, y: 4 },
                target: { id: "page", kind: "structure" },
              },
            ],
          },
        ]);
        page.settle();

        assert.strictEqual(page.server.sent().length, 1);
        assert.strictEqual(page.view().notice?.kind, "conflict");
        assert.deepStrictEqual(idsOf(page.view().pending), ["other-writer"]);
      })
  );

  it.effect(
    "an older proposals file the server sends while the map has an error does not take the page back",
    () =>
      Effect.gen(function* () {
        const page = yield* servedReview;

        page.dispatch(apply(nudge(["engineer", "page"], { x: 0, y: 0.5 })));
        page.settle();

        const saved = page.view().pending;

        assert.strictEqual(saved.length, 1);

        page.server.replaceProposals(
          { format: 1, layout: [], revision: 0 },
          { mapBroken: true }
        );

        assert.deepStrictEqual(page.view().pending, saved);
        assert.strictEqual(page.view().state.proposals?.revision, 1);
      })
  );

  it.effect(
    "clears the undo history and says so once the accepted layout moves on",
    () =>
      Effect.gen(function* () {
        const page = yield* servedReview;

        page.dispatch(apply(nudge(["engineer", "page"], { x: 0, y: 0.5 })));
        page.settle();
        assert.isTrue(page.view().canUndo);

        page.dispatch({ _tag: "Accept", ids: "all", message: "" });
        assert.isTrue(page.view().accepting);
        const meanwhile = page.dispatch(
          apply(nudge(["server"], { x: 0.5, y: 0 }))
        );

        assert.strictEqual(
          meanwhile,
          "Accepting the pending changes. Make this edit once that's saved."
        );

        page.settle();

        assert.isFalse(page.view().accepting);
        assert.isFalse(page.view().canUndo);
        assert.deepStrictEqual(page.view().notice, {
          kind: "info",
          message: clearedHistory,
        });
        assert.deepStrictEqual(page.view().pending, []);
        assert.strictEqual(page.view().state.layout.revision, 1);
      })
  );
});
