import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect, Record as Rec } from "effect";

import {
  alignMoves,
  applyLayoutChanges,
  distributeMoves,
  nudgeMoves,
} from "../src/index.ts";
import type {
  Alignment,
  Axis,
  GridPoint,
  Layout,
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
          by: "engineer",
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
            by: "engineer",
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
            by: "engineer",
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

const moveOf = (
  id: string,
  structure: string,
  position: GridPoint
): LayoutChange => ({
  by: "engineer",
  id,
  kind: "move",
  moves: [{ position, target: { id: structure, kind: "structure" } }],
});

describe("who made the pending changes", () => {
  it.effect(
    "the page's edits are the engineer's, and an agent change already pending stays the agent's",
    () =>
      Effect.gen(function* () {
        const page = yield* servedReview;

        page.server.writeLayout([
          {
            by: "agent",
            id: "agent-1",
            kind: "move",
            moves: [
              {
                position: { x: 18, y: 6 },
                target: { id: "upstream", kind: "structure" },
              },
            ],
          },
        ]);

        const nudged = nudge(["engineer", "page"], { x: 0, y: 0.5 });

        assert.isUndefined(page.dispatch(apply(nudged)));
        page.settle();

        const saved = page.server.state().proposals?.layout ?? [];

        assert.deepStrictEqual(
          Arr.map(saved, ({ by, id }) => `${id} ${by}`),
          ["agent-1 agent", "c1 engineer"]
        );
        assert.deepStrictEqual(
          Arr.map(page.view().pending, ({ by }) => by),
          ["agent", "engineer"]
        );
      })
  );
});

describe("pending changes with writes in flight", () => {
  it.effect(
    "a restore issued while a layout write is in flight is written after it and wins",
    () =>
      Effect.gen(function* () {
        const { data, layout } = yield* fixture("review");
        const page = inMemoryPage({ data, layout, system: "review" });

        page.dispatch(apply(nudge(["engineer"], { x: 0, y: 3 })));

        const refusal = page.dispatch(
          apply({ _tag: "Restore", revision: { data, layout } })
        );

        assert.isUndefined(refusal);
        assert.deepStrictEqual(page.server.sent(), []);
        page.settle();

        assert.deepStrictEqual(
          Arr.map(page.server.sent(), ({ baseFileRevision, layout: sent }) => [
            baseFileRevision,
            idsOf(sent),
          ]),
          [
            [0, ["c1"]],
            [1, []],
          ]
        );
        assert.deepStrictEqual(page.server.state().proposals?.layout, []);
        assert.deepStrictEqual(page.view().pending, []);
        assert.isNull(page.view().notice);
      })
  );

  it.effect(
    "discarding a change a carried reroute was added for is refused and writes nothing",
    () =>
      Effect.gen(function* () {
        const { data, layout: saved } = yield* fixture("review");

        // h-store takes a detour right of the server and the proposals.
        const layout: Layout = {
          ...saved,
          routes: {
            "h-store": [
              { x: 9, y: 2 },
              { x: 9, y: 4 },
              { x: 13, y: 4 },
              { x: 13, y: 7 },
              { x: 10, y: 7 },
            ],
          },
        };

        const page = inMemoryPage({ data, layout, system: "review" });

        page.dispatch(apply(nudge(["server", "proposals"], { x: 0, y: 2 })));
        page.settle();

        const [move, reroute] = page.view().pending;

        assert.strictEqual(move?.kind, "move");
        assert.strictEqual(reroute?.kind, "reroute");

        const refusal = page.dispatch(
          apply({ _tag: "Discard", changes: [move?.id ?? ""] })
        );

        page.settle();

        assert.include(refusal ?? "", 'Reset the route of hop "h-store" first');
        assert.strictEqual(page.server.sent().length, 1);
        assert.deepStrictEqual(idsOf(page.view().pending), [
          move?.id,
          reroute?.id,
        ]);
      })
  );

  it.effect(
    "two edits in flight when another writer gets in are both kept, and one undo takes back the later",
    () =>
      Effect.gen(function* () {
        const page = yield* servedReview;

        page.dispatch(apply(nudge(["engineer"], { x: 0, y: 3 })));
        page.dispatch(apply(nudge(["server"], { x: 0, y: 3 })));
        page.server.writeLayout([moveOf("other", "upstream", { x: 18, y: 4 })]);
        page.settle();

        assert.deepStrictEqual(idsOf(page.view().pending), [
          "other",
          "c1",
          "c2",
        ]);
        assert.deepStrictEqual(
          idsOf(page.server.state().proposals?.layout ?? []),
          ["other", "c1", "c2"]
        );

        page.dispatch({ _tag: "Undo" });
        page.settle();

        assert.deepStrictEqual(idsOf(page.view().pending), ["other", "c1"]);
        assert.isTrue(page.view().canRedo);
        assert.isNull(page.view().notice);
      })
  );

  it.effect(
    "a review that arrives while a write is in flight leaves the page's changes showing until the write lands",
    () =>
      Effect.gen(function* () {
        const page = yield* servedReview;

        page.dispatch(apply(nudge(["engineer"], { x: 0, y: 3 })));
        page.dispatch({
          _tag: "Reviewed",
          endsUndo: false,
          proposals: { format: 1, layout: [], notes: [], revision: 1 },
        });

        assert.deepStrictEqual(idsOf(page.view().pending), ["c1"]);

        page.settle();

        assert.deepStrictEqual(idsOf(page.view().pending), ["c1"]);
        assert.deepStrictEqual(
          idsOf(page.server.state().proposals?.layout ?? []),
          ["c1"]
        );
      })
  );
});

/** A placement in the review map, as `{ x, y, w, d }` with a 2 by 2 footprint. */
const square = (x: number, y: number) => ({ d: 2, w: 2, x, y });

/** The saved list as `kind by structure-or-hop`, for comparing who holds what. */
const holders = (changes: ReadonlyArray<LayoutChange>) =>
  Arr.map(
    changes,
    (change) =>
      `${change.kind} ${change.by} ${Arr.join(
        change.kind === "move"
          ? Arr.map(change.moves, ({ target }) => target.id)
          : [change.target.id],
        ","
      )}`
  );

const savedOf = (page: ReturnType<typeof inMemoryPage>) =>
  page.server.state().proposals?.layout ?? [];

const shownAt = (page: ReturnType<typeof inMemoryPage>, id: string) =>
  applyLayoutChanges(page.view().state.layout, page.view().pending).structures[
    id
  ];

describe("the agent's proposals beside the engineer's edits", () => {
  it.effect("a second proposal for the same structure replaces the first", () =>
    Effect.gen(function* () {
      const page = yield* servedReview;

      assert.isUndefined(
        page.server.propose(
          { _tag: "Place", next: square(18, 4), structure: "upstream" },
          "Line up the outside"
        )
      );
      assert.isUndefined(
        page.server.propose(
          { _tag: "Place", next: square(18, 6), structure: "upstream" },
          "Line up with the pull request"
        )
      );

      const saved = savedOf(page);

      assert.deepStrictEqual(holders(saved), ["move agent upstream"]);
      assert.strictEqual(saved[0]?.reason, "Line up with the pull request");
      assert.strictEqual(page.server.state().proposals?.revision, 2);
      assert.deepStrictEqual(shownAt(page, "upstream"), square(18, 6));
    })
  );

  it.effect(
    "is refused on a structure the engineer has pending, naming their change, and writes nothing",
    () =>
      Effect.gen(function* () {
        const page = yield* servedReview;

        page.dispatch(apply(nudge(["page"], { x: 0, y: 3 })));
        page.settle();

        const before = page.server.state().proposals;
        const [mine] = before?.layout ?? [];

        const refusal = page.server.propose(
          { _tag: "Place", next: square(4, 9), structure: "page" },
          "Tidy"
        );

        assert.strictEqual(
          refusal,
          `The engineer has a pending move of "page" (change ${mine?.id}). Propose changes to other structures, or wait until they accept or discard change ${mine?.id}.`
        );
        assert.deepStrictEqual(page.server.state().proposals, before);
      })
  );

  it.effect(
    "is refused on a hop whose reroute waits in a batch, and writes nothing",
    () =>
      Effect.gen(function* () {
        const page = yield* servedReview;

        const frozen: LayoutChange = {
          by: "engineer",
          id: "frozen-route",
          kind: "reroute",
          points: null,
          target: { id: "h-pr", kind: "hop" },
        };

        page.server.replaceProposals(
          {
            batches: [
              {
                frozenAt: "2026-11-01T09:00:00.000Z",
                items: [{ change: frozen, id: frozen.id, kind: "layout" }],
                number: 1,
                verdicts: {},
              },
            ],
            format: 1,
            layout: [],
            revision: 3,
          },
          { mapBroken: false }
        );

        const before = page.server.state().proposals;

        const refusal = page.server.propose(
          {
            _tag: "Reroute",
            hop: "h-pr",
            points: [
              { x: 10, y: 7 },
              { x: 12, y: 7 },
            ],
          },
          "Straighten"
        );

        assert.include(
          refusal ?? "",
          'The engineer has a pending reroute of hop "h-pr" (change frozen-route).'
        );
        assert.deepStrictEqual(page.server.state().proposals, before);
      })
  );

  it.effect(
    "the engineer's drag of a structure the agent moved replaces the agent's change",
    () =>
      Effect.gen(function* () {
        const page = yield* servedReview;

        page.server.propose(
          { _tag: "Place", next: square(18, 4), structure: "upstream" },
          "Tidy"
        );
        const [agents] = savedOf(page);
        const drag = apply({
          _tag: "Place",
          next: square(18, 9),
          structure: "upstream",
        });

        assert.isUndefined(page.dispatch(drag));
        page.settle();

        const saved = savedOf(page);

        assert.deepStrictEqual(holders(saved), ["move engineer upstream"]);
        assert.notStrictEqual(saved[0]?.id, agents?.id);
        assert.deepStrictEqual(shownAt(page, "upstream"), square(18, 9));
        assert.isNull(page.view().notice);
      })
  );

  it.effect(
    "the engineer's resize of a structure the agent moved keeps it where the agent put it, as the engineer's move",
    () =>
      Effect.gen(function* () {
        const page = yield* servedReview;

        page.server.propose(
          { _tag: "Place", next: square(18, 4), structure: "upstream" },
          "Tidy"
        );
        const [agents] = savedOf(page);

        page.dispatch(
          apply({
            _tag: "Place",
            next: { d: 2, w: 3, x: 18, y: 4 },
            structure: "upstream",
          })
        );
        page.settle();

        const saved = savedOf(page);

        assert.sameMembers(holders(saved), [
          "move engineer upstream",
          "resize engineer upstream",
        ]);
        assert.notInclude(idsOf(saved), agents?.id);
        assert.deepStrictEqual(shownAt(page, "upstream"), {
          d: 2,
          w: 3,
          x: 18,
          y: 4,
        });
      })
  );

  it.effect(
    "arranging a set that holds a structure the agent moved takes it over, and leaves the agent's other changes",
    () =>
      Effect.gen(function* () {
        const page = yield* servedReview;

        page.server.propose(
          { _tag: "Place", next: square(18, 4), structure: "upstream" },
          "Tidy"
        );
        page.server.propose(
          { _tag: "Place", next: square(0, 9), structure: "engineer" },
          "Tidy"
        );

        page.dispatch(apply(nudge(["server", "upstream"], { x: 0, y: 0.5 })));
        page.settle();

        assert.deepStrictEqual(holders(savedOf(page)), [
          "move agent engineer",
          "move engineer server,upstream",
        ]);
        assert.deepStrictEqual(shownAt(page, "upstream"), square(18, 4.5));
        assert.deepStrictEqual(shownAt(page, "engineer"), square(0, 9));
      })
  );

  it.effect(
    "dragging one member of an agent's move of several takes over that member only",
    () =>
      Effect.gen(function* () {
        const page = yield* servedReview;

        page.server.writeLayout([
          {
            by: "agent",
            id: "agent-pair",
            kind: "move",
            moves: [
              {
                position: { x: 18, y: 4 },
                target: { id: "upstream", kind: "structure" },
              },
              {
                position: { x: 0, y: 9 },
                target: { id: "engineer", kind: "structure" },
              },
            ],
            reason: "Tidy",
          },
        ]);

        page.dispatch(
          apply({ _tag: "Place", next: square(18, 9), structure: "upstream" })
        );
        page.settle();

        assert.isNull(page.view().notice);
        assert.deepStrictEqual(holders(savedOf(page)), [
          "move agent engineer",
          "move engineer upstream",
        ]);
        assert.strictEqual(savedOf(page)[0]?.id, "agent-pair");
        assert.deepStrictEqual(shownAt(page, "engineer"), square(0, 9));
        assert.deepStrictEqual(shownAt(page, "upstream"), square(18, 9));
      })
  );

  it.effect(
    "the engineer's reroute of a hop the agent rerouted replaces the agent's change",
    () =>
      Effect.gen(function* () {
        const page = yield* servedReview;
        const engineers = [
          { x: 10, y: 7 },
          { x: 12, y: 7 },
        ];

        page.server.propose(
          {
            _tag: "Reroute",
            hop: "h-pr",
            points: [
              { x: 10, y: 6.5 },
              { x: 12, y: 6.5 },
            ],
          },
          "Straighten"
        );

        page.dispatch(
          apply({ _tag: "Reroute", hop: "h-pr", points: engineers })
        );
        page.settle();

        const saved = savedOf(page);

        assert.deepStrictEqual(holders(saved), ["reroute engineer h-pr"]);
        assert.deepStrictEqual(
          applyLayoutChanges(page.view().state.layout, saved).routes,
          { "h-pr": engineers }
        );
      })
  );

  it.effect(
    "Reset route on a hop only the agent rerouted leaves nothing pending",
    () =>
      Effect.gen(function* () {
        const page = yield* servedReview;

        page.server.propose(
          {
            _tag: "Reroute",
            hop: "h-pr",
            points: [
              { x: 10, y: 6.5 },
              { x: 12, y: 6.5 },
            ],
          },
          "Straighten"
        );

        page.dispatch(apply({ _tag: "Reroute", hop: "h-pr", points: null }));
        page.settle();

        assert.deepStrictEqual(savedOf(page), []);
        assert.deepStrictEqual(page.view().pending, []);
      })
  );

  it.effect(
    "the engineer's edit still wins when the agent proposed while it was on its way",
    () =>
      Effect.gen(function* () {
        const page = yield* servedReview;

        page.dispatch(
          apply({ _tag: "Place", next: square(18, 9), structure: "upstream" })
        );
        page.server.propose(
          { _tag: "Place", next: square(18, 4), structure: "upstream" },
          "Tidy"
        );
        page.settle();

        assert.deepStrictEqual(
          Arr.map(
            page.server.sent(),
            ({ baseFileRevision }) => baseFileRevision
          ),
          [0, 1]
        );
        assert.deepStrictEqual(holders(savedOf(page)), [
          "move engineer upstream",
        ]);
        assert.deepStrictEqual(shownAt(page, "upstream"), square(18, 9));
        assert.isNull(page.view().notice);
      })
  );

  it.effect(
    "discarding an agent group is one write and one undo step, and undoing it is refused with a notice",
    () =>
      Effect.gen(function* () {
        const page = yield* servedReview;

        page.server.propose(
          { _tag: "Place", next: square(18, 4), structure: "upstream" },
          "Tidy"
        );
        page.server.propose(
          { _tag: "Place", next: square(0, 9), structure: "engineer" },
          "Tidy"
        );

        const [first, second] = idsOf(savedOf(page));

        page.dispatch(
          apply({ _tag: "Discard", changes: [first ?? "", second ?? ""] })
        );
        page.settle();

        assert.strictEqual(page.server.sent().length, 1);
        assert.deepStrictEqual(savedOf(page), []);
        assert.isTrue(page.view().canUndo);

        page.dispatch({ _tag: "Undo" });
        page.settle();

        assert.strictEqual(page.server.sent().length, 1);
        assert.deepStrictEqual(savedOf(page), []);
        assert.deepStrictEqual(page.view().notice, {
          kind: "refused",
          message: `This step would bring back the agent's change ${first}, which only the agent can propose. Nothing was undone or redone.`,
        });
      })
  );
});
