import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Match, Option, Result } from "effect";

import {
  authorChangeRefusal,
  pendingRows,
  proposeAgentChange,
} from "../src/index.ts";
import type { AgentProposal, Layout, LayoutChange } from "../src/index.ts";

const base: Layout = {
  format: 1,
  revision: 2,
  structures: {
    a: { d: 2, w: 2, x: 0, y: 0 },
    b: { d: 2, w: 2, x: 4, y: 0 },
  },
};

const move = (
  id: string,
  structure: string,
  [x, y]: readonly [number, number]
): LayoutChange => ({
  by: "engineer",
  id,
  kind: "move",
  moves: [{ position: { x, y }, target: { id: structure, kind: "structure" } }],
});

/** A move of `structure` to `at`, as the agent's, with `reason` when given. */
const agentMove = (
  id: string,
  structure: string,
  {
    at,
    reason,
  }: { readonly at: readonly [number, number]; readonly reason?: string }
): LayoutChange => {
  const change: LayoutChange = { ...move(id, structure, at), by: "agent" };

  return reason === undefined ? change : { ...change, reason };
};

const propose = (
  changes: ReadonlyArray<LayoutChange>,
  proposal: AgentProposal,
  reason = "Tidy"
) =>
  proposeAgentChange({
    base,
    changes,
    frozen: [],
    newId: () => "fresh",
    proposal,
    reason,
  });

const placeAt = (
  structure: string,
  next: {
    readonly d?: number;
    readonly w?: number;
    readonly x: number;
    readonly y: number;
  }
): AgentProposal => ({
  _tag: "Place",
  next: { d: 2, w: 2, ...next },
  structure,
});

const idsIn = (changes: ReadonlyArray<LayoutChange>) =>
  Arr.join(
    Arr.map(changes, ({ id }) => id),
    " "
  );

/** Each row as its change's id, or a group as `reason: ids`. */
const rowsOf = (changes: ReadonlyArray<LayoutChange>) =>
  Arr.map(
    pendingRows(changes),
    Match.valueTags({
      AgentGroup: ({ changes: grouped, reason }) =>
        `${reason ?? "(none)"}: ${idsIn(grouped)}`,
      Change: ({ change }) => change.id,
    })
  );

describe("the agent proposing a layout change", () => {
  it("lays a move and a resize as the agent's, with the reason", () => {
    const proposed = propose([], placeAt("a", { w: 3, x: 0, y: 6 }));

    assert.deepStrictEqual(
      proposed,
      Result.succeed([
        agentMove("fresh", "a", { at: [0, 6], reason: "Tidy" }),
        {
          by: "agent",
          footprint: { d: 2, w: 3 },
          id: "fresh",
          kind: "resize",
          reason: "Tidy",
          target: { id: "a", kind: "structure" },
        },
      ])
    );
  });

  it("gives back the list as it is when it already shows the proposal, for the same reason", () => {
    const changes = [agentMove("m1", "a", { at: [0, 6], reason: "Tidy" })];
    const again = propose(changes, placeAt("a", { x: 0, y: 6 }), "Tidy");

    assert.deepStrictEqual(again, Result.succeed(changes));
  });

  it("replaces the reason when the same proposal comes with another", () => {
    const changes = [agentMove("m1", "a", { at: [0, 6], reason: "Tidy" })];
    const again = propose(changes, placeAt("a", { x: 0, y: 6 }), "Other");

    assert.deepStrictEqual(
      again,
      Result.succeed([agentMove("fresh", "a", { at: [0, 6], reason: "Other" })])
    );
  });

  it("takes only the proposed structure out of an agent move of several", () => {
    const stays = {
      position: { x: 4, y: 6 },
      target: { id: "b", kind: "structure" },
    } as const;

    const pair: LayoutChange = {
      by: "agent",
      id: "pair",
      kind: "move",
      moves: [
        { position: { x: 0, y: 6 }, target: { id: "a", kind: "structure" } },
        stays,
      ],
      reason: "Drop the row",
    };

    const proposed = propose([pair], placeAt("a", { x: 0, y: 9 }));

    assert.deepStrictEqual(
      proposed,
      Result.succeed([
        { ...pair, moves: [stays] },
        agentMove("fresh", "a", { at: [0, 9], reason: "Tidy" }),
      ])
    );
  });

  it("refuses a structure with no position", () => {
    const proposed = propose([], placeAt("ghost", { x: 0, y: 9 }));

    assert.isTrue(Result.isFailure(proposed));
  });

  it("refuses a structure whose move waits in a batch, naming that change", () => {
    const refused = proposeAgentChange({
      base,
      changes: [],
      frozen: [move("frozen-1", "a", [0, 6])],
      newId: () => "fresh",
      proposal: placeAt("a", { x: 0, y: 9 }),
      reason: "Tidy",
    });

    assert.deepStrictEqual(
      refused,
      Result.fail(
        'The engineer has a pending move of "a" (change frozen-1). Propose changes to other structures, or wait until they accept or discard change frozen-1.'
      )
    );
  });
});

describe("the Pending tab's rows", () => {
  it("groups consecutive agent changes with the same reason, and lists the engineer's on their own", () => {
    const changes = [
      move("e1", "a", [0, 6]),
      agentMove("a1", "a", { at: [0, 6], reason: "Tidy" }),
      agentMove("a2", "b", { at: [4, 6], reason: "Tidy" }),
      agentMove("a3", "b", { at: [4, 6], reason: "Make room" }),
      move("e2", "b", [4, 9]),
      agentMove("a4", "a", { at: [0, 9], reason: "Make room" }),
    ];

    assert.deepStrictEqual(rowsOf(changes), [
      "e1",
      "Tidy: a1 a2",
      "Make room: a3",
      "e2",
      "Make room: a4",
    ]);
  });

  it("groups agent changes with no reason together", () => {
    const changes = [
      agentMove("a1", "a", { at: [0, 6] }),
      agentMove("a2", "b", { at: [4, 6] }),
      agentMove("a3", "b", { at: [4, 6], reason: "Tidy" }),
    ];

    assert.deepStrictEqual(rowsOf(changes), ["(none): a1 a2", "Tidy: a3"]);
  });
});

describe("the page changing who made a change", () => {
  const before = [
    agentMove("a1", "a", { at: [0, 6] }),
    move("e1", "b", [4, 6]),
  ];

  it("refuses an agent change sent back as the engineer's, and the reverse", () => {
    const asEngineer = authorChangeRefusal({
      after: [move("a1", "a", [0, 6])],
      before,
    });
    const asAgent = authorChangeRefusal({
      after: [agentMove("e1", "b", { at: [4, 6] })],
      before,
    });

    assert.isTrue(Option.isSome(asEngineer));
    assert.include(Option.getOrThrow(asEngineer), "a1");
    assert.include(Option.getOrThrow(asEngineer), "agent's");
    assert.include(Option.getOrThrow(asAgent), "engineer's");
  });

  it("allows the list as it stands, a new change and a takeover under a new id", () => {
    const takenOver = [move("fresh", "a", [0, 8]), move("e1", "b", [4, 6])];
    const added = [...before, move("e2", "a", [8, 8])];

    assert.isTrue(
      Option.isNone(authorChangeRefusal({ after: before, before }))
    );
    assert.isTrue(
      Option.isNone(
        authorChangeRefusal({
          after: added,
          before,
        })
      )
    );
    assert.isTrue(
      Option.isNone(authorChangeRefusal({ after: takenOver, before }))
    );
  });
});
