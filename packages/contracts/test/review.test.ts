import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Option, Result, Schema, String as Str } from "effect";
import { vi } from "vitest";

import {
  AcceptedItem,
  RejectedItem,
  commitBatch,
  dismissItem,
  freezeOpen,
  frozenLayoutChanges,
  frozenRefusal,
  oldestOpenBatch,
  Proposals,
  recordVerdict,
  reviewEntries,
  reviewPrompt,
} from "../src/index.ts";
import type {
  Batch,
  Layout,
  LayoutChange,
  Proposals as P,
  Verdict,
} from "../src/index.ts";

vi.setConfig({ testTimeout: 5000 });

const layout: Layout = {
  format: 1,
  revision: 2,
  structures: {
    a: { x: 0, y: 0, w: 2, d: 2 },
    b: { x: 4, y: 0, w: 2, d: 2 },
  },
};

const move = (id: string, to: readonly [number, number]): LayoutChange => ({
  id,
  kind: "move",
  moves: [
    {
      target: { kind: "structure", id: "a" },
      position: { x: to[0], y: to[1] },
    },
  ],
});

const note = (id: string, text: string) => ({
  id,
  target: { kind: "structure" as const, id: "b" },
  text,
});

const at = "2026-11-01T09:00:00.000Z";

const open: P = {
  format: 1,
  revision: 4,
  layout: [move("m1", [0, 6])],
  notes: [note("n1", "Why is this a tall box?")],
};

const decode = Schema.decodeUnknownResult(Proposals, {
  errors: "all",
  onExcessProperty: "error",
});

const encode = Schema.encodeResult(Proposals);

const unwrap = <A, E>(result: Result.Result<A, E>): A => {
  assert.isTrue(Result.isSuccess(result), JSON.stringify(result));

  return Result.getOrThrow(result);
};

const firstBatch = (proposals: P): Batch =>
  Option.getOrThrow(Arr.head(proposals.batches ?? []));

const frozen = () => unwrap(freezeOpen({ proposals: open, at })).proposals;

const withBatch = (batch: Partial<Batch>): P => ({
  ...frozen(),
  batches: [{ ...firstBatch(frozen()), ...batch }],
});

describe("proposals.json with batches", () => {
  it("still reads a file written before notes and batches existed", () => {
    const old = { format: 1, revision: 3, layout: [] };

    assert.deepStrictEqual(unwrap(decode(old)), old);
  });

  it("round-trips a frozen batch with verdicts and a commit", () => {
    const proposals = withBatch({
      verdicts: {
        m1: { verdict: "accepted" },
        n1: { verdict: "rejected", reason: "It is tall for a reason." },
      },
      committed: { revision: 1, at },
    });

    const encoded = Result.getOrThrow(encode(proposals));

    assert.deepStrictEqual(unwrap(decode(encoded)), proposals);
  });

  it("refuses a rejected verdict with no reason", () => {
    const result = decode({
      ...frozen(),
      batches: [
        { ...firstBatch(frozen()), verdicts: { n1: { verdict: "rejected" } } },
      ],
    });

    assert.isTrue(Result.isFailure(result));
    assert.include(
      Result.match(result, { onSuccess: () => "", onFailure: String }),
      "Say why"
    );
  });

  it("refuses an id used twice", () => {
    const result = decode({
      ...open,
      notes: [note("m1", "same id as a change")],
    });

    assert.isTrue(Result.isFailure(result));
    assert.include(
      Result.match(result, { onSuccess: () => "", onFailure: String }),
      "its own id"
    );
  });
});

describe("freezing", () => {
  it("moves open changes and notes into batch 1, keeping their ids", () => {
    const { proposals, batch } = unwrap(freezeOpen({ proposals: open, at }));

    assert.strictEqual(batch.number, 1);
    assert.deepStrictEqual(
      Arr.map(batch.items, ({ id, kind }) => [id, kind]),
      [
        ["m1", "layout"],
        ["n1", "note"],
      ]
    );
    assert.deepStrictEqual(proposals.layout, []);
    assert.deepStrictEqual(proposals.notes, []);
    assert.strictEqual(proposals.revision, 5);
  });

  it("numbers the next batch after the last, committed or not", () => {
    const first = frozen();

    const second = unwrap(
      freezeOpen({
        proposals: { ...first, layout: [move("m2", [8, 8])] },
        at,
      })
    );

    assert.strictEqual(second.batch.number, 2);
    assert.strictEqual(second.proposals.batches?.length, 2);
  });

  it("refuses when nothing is open", () => {
    const result = freezeOpen({
      proposals: { format: 1, revision: 0, layout: [] },
      at,
    });

    assert.isTrue(Result.isFailure(result));
  });

  it("keeps frozen layout changes drawn as pending until the commit", () => {
    const changes = frozenLayoutChanges(frozen());

    assert.deepStrictEqual(
      Arr.map(changes, ({ id }) => id),
      ["m1"]
    );
  });

  it("refuses to edit an item in a batch that has no commit", () => {
    const inBatch = frozenRefusal(frozen(), "n1");
    const elsewhere = frozenRefusal(frozen(), "other");

    assert.isTrue(Option.isSome(inBatch));
    assert.isTrue(Option.isNone(elsewhere));
  });
});

describe("verdicts", () => {
  it("records a verdict on an item in the oldest open batch", () => {
    const next = unwrap(
      recordVerdict({
        proposals: frozen(),
        id: "n1",
        verdict: { verdict: "changed", reason: "Folded into the overview." },
      })
    );

    assert.deepStrictEqual(next.batches?.[0]?.verdicts.n1, {
      verdict: "changed",
      reason: "Folded into the overview.",
    });
  });

  it("fails on an unknown item and names the ones that exist", () => {
    const result = recordVerdict({
      proposals: frozen(),
      id: "nope",
      verdict: { verdict: "accepted" },
    });

    assert.isTrue(Result.isFailure(result));
    assert.include(Result.merge(result), "m1, n1");
  });

  it("fails when no batch is waiting", () => {
    const result = recordVerdict({
      proposals: open,
      id: "n1",
      verdict: { verdict: "accepted" },
    });

    assert.isTrue(Result.isFailure(result));
  });
});

const decided = (verdicts: Record<string, Verdict>): P =>
  withBatch({ verdicts });

describe("applying a batch with its verdicts to a map state", () => {
  it("refuses while an item has no verdict", () => {
    const result = commitBatch({
      proposals: decided({ m1: { verdict: "accepted" } }),
      layout,
      revision: 1,
      at,
    });

    assert.isTrue(Result.isFailure(result));
    assert.include(Result.merge(result), "n1");
  });

  it("applies accepted layout changes and sorts items by verdict", () => {
    const committing = unwrap(
      commitBatch({
        proposals: decided({
          m1: { verdict: "accepted" },
          n1: { verdict: "rejected", reason: "No." },
        }),
        layout,
        revision: 1,
        at,
      })
    );

    assert.deepStrictEqual(committing.layout.structures.a, {
      x: 0,
      y: 6,
      w: 2,
      d: 2,
    });
    assert.strictEqual(committing.layout.revision, 3);
    assert.deepStrictEqual(
      Arr.map(committing.accepted, ({ kind }) => kind),
      ["layout"]
    );
    assert.deepStrictEqual(committing.rejected, [
      {
        kind: "note",
        id: "n1",
        target: { kind: "structure", id: "b" },
        text: "Why is this a tall box?",
        reason: "No.",
      },
    ]);
    assert.deepStrictEqual(committing.proposals.batches?.[0]?.committed, {
      revision: 1,
      at,
    });
  });

  it("leaves a rejected layout change out of the layout", () => {
    const committing = unwrap(
      commitBatch({
        proposals: decided({
          m1: { verdict: "rejected", reason: "Too close." },
          n1: { verdict: "accepted" },
        }),
        layout,
        revision: 1,
        at,
      })
    );

    assert.deepStrictEqual(committing.layout, layout);
  });

  it("takes a changed item as accepted and keeps the reason", () => {
    const committing = unwrap(
      commitBatch({
        proposals: decided({
          m1: { verdict: "changed", reason: "Moved to y 6 as asked." },
          n1: { verdict: "accepted" },
        }),
        layout,
        revision: 1,
        at,
      })
    );

    assert.strictEqual(
      committing.accepted[0]?.reason,
      "Moved to y 6 as asked."
    );
    assert.strictEqual(committing.accepted[0]?.changed, true);
  });

  it("makes accepted and rejected lists that a revision file takes", () => {
    const committing = unwrap(
      commitBatch({
        proposals: decided({
          m1: { verdict: "changed", reason: "Moved as asked." },
          n1: { verdict: "rejected", reason: "No." },
        }),
        layout,
        revision: 1,
        at,
      })
    );

    const lists = Schema.Struct({
      accepted: Schema.Array(AcceptedItem),
      rejected: Schema.Array(RejectedItem),
    });

    const { accepted, rejected } = committing;

    const decodedLists = Schema.decodeResult(lists)({
      accepted,
      rejected,
    });

    assert.deepStrictEqual(unwrap(decodedLists), { accepted, rejected });
  });

  it("makes the next open batch the oldest once the first is committed", () => {
    const committing = unwrap(
      commitBatch({
        proposals: decided({
          m1: { verdict: "accepted" },
          n1: { verdict: "accepted" },
        }),
        layout,
        revision: 1,
        at,
      })
    );

    const second = unwrap(
      freezeOpen({
        proposals: {
          ...committing.proposals,
          layout: [move("m2", [8, 8])],
        },
        at,
      })
    );

    const oldest = Option.getOrThrow(oldestOpenBatch(second.proposals));

    assert.strictEqual(oldest.number, 2);
  });
});

describe("what the page lists", () => {
  it("gives each item an open, frozen or reviewed status", () => {
    const committed = unwrap(
      commitBatch({
        proposals: decided({
          m1: { verdict: "accepted" },
          n1: { verdict: "rejected", reason: "No." },
        }),
        layout,
        revision: 1,
        at,
      })
    ).proposals;

    const entries = reviewEntries({
      ...committed,
      notes: [note("n2", "A new one")],
    });

    const states = Arr.map(entries, ({ item, status }) => [
      item.id,
      status.state,
    ]);

    assert.deepStrictEqual(states, [
      ["n2", "open"],
      ["m1", "reviewed"],
      ["n1", "reviewed"],
    ]);
  });

  it("dismisses a reviewed item, and refuses one still waiting", () => {
    const result = dismissItem({ proposals: frozen(), id: "n1" });

    assert.isTrue(Result.isFailure(result));
  });
});

describe("the prompt", () => {
  const { batch } = unwrap(freezeOpen({ proposals: open, at }));

  const prompt = reviewPrompt({
    home: "/work/flake/map",
    batch,
    nameOf: (id) => (id === "a" ? "Alpha" : "Beta"),
  });

  it("names the skill, the home folder and the batch", () => {
    assert.include(prompt, "axonometric skill");
    assert.include(prompt, "/work/flake/map");
    assert.include(prompt, "batch 1");
  });

  it("says the list is a summary and points at proposals.json", () => {
    assert.include(prompt, "summary");
    assert.include(prompt, "/work/flake/map/proposals.json");
  });

  it("gives one line per item", () => {
    const lines = Arr.filter(Str.split("\n")(prompt), Str.startsWith("- "));

    assert.deepStrictEqual(lines, [
      "- move m1: Alpha",
      '- note n1 on Beta: "Why is this a tall box?"',
    ]);
  });
});
