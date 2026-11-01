import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect, Option, Result, Schema } from "effect";
import { vi } from "vitest";

import {
  acceptanceMessage,
  acceptLayoutChanges,
  parseRevisionFileName,
  Revision,
  revisionFileName,
} from "../src/index.ts";
import type { Layout, LayoutChange } from "../src/index.ts";
import { fixture } from "./fixture-maps.ts";

vi.setConfig({ testTimeout: 5000 });

const layout: Layout = {
  format: 1,
  revision: 3,
  structures: {
    a: { x: 0, y: 0, w: 2, d: 2 },
    b: { x: 4, y: 0, w: 2, d: 2 },
    c: { x: 8, y: 0, w: 2, d: 2 },
    d: { x: 12, y: 0, w: 2, d: 2 },
    e: { x: 16, y: 0, w: 2, d: 2 },
  },
};

const move = (
  id: string,
  structureId: string,
  to: readonly [number, number]
): LayoutChange => ({
  id,
  kind: "move",
  moves: [
    {
      target: { kind: "structure", id: structureId },
      position: { x: to[0], y: to[1] },
    },
  ],
});

const resize = (
  id: string,
  structureId: string,
  size: readonly [number, number]
): LayoutChange => ({
  id,
  kind: "resize",
  target: { kind: "structure", id: structureId },
  footprint: { w: size[0], d: size[1] },
});

const groupMove = (id: string): LayoutChange => ({
  id,
  kind: "move",
  moves: [
    { target: { kind: "structure", id: "a" }, position: { x: 0, y: 10 } },
    { target: { kind: "structure", id: "b" }, position: { x: 4, y: 10 } },
  ],
});

const accept = (pending: readonly LayoutChange[], ids: "all" | string[]) =>
  acceptLayoutChanges({ layout, pending, ids });

/** The acceptance, or a failed assertion carrying the refusal. */
const accepted = (pending: readonly LayoutChange[], ids: "all" | string[]) => {
  const result = accept(pending, ids);

  if (Result.isFailure(result)) {
    return assert.fail(result.failure);
  }

  return result.success;
};

/** The refusal, or a failed assertion when the acceptance went ahead. */
const refusal = (pending: readonly LayoutChange[], ids: "all" | string[]) => {
  const result = accept(pending, ids);

  if (Result.isSuccess(result)) {
    return assert.fail("expected the acceptance to be refused");
  }

  return result.failure;
};

describe("accepting layout changes", () => {
  it("writes the chosen change into the layout and leaves the others pending", () => {
    const first = move("m1", "a", [0, 6]);
    const second = resize("r1", "c", [3, 3]);
    const result = accepted([first, second], ["m1"]);

    assert.deepStrictEqual(result.accepted, [first]);
    assert.deepStrictEqual(result.remaining, [second]);
    assert.deepStrictEqual(result.layout.structures.a, {
      x: 0,
      y: 6,
      w: 2,
      d: 2,
    });
    assert.deepStrictEqual(result.layout.structures.c, layout.structures.c);
  });

  it("takes every pending change for all, and leaves nothing pending", () => {
    const pending = [move("m1", "a", [0, 6]), resize("r1", "c", [3, 3])];
    const result = accepted(pending, "all");

    assert.deepStrictEqual(result.accepted, pending);
    assert.deepStrictEqual(result.remaining, []);
    assert.deepStrictEqual(result.layout.structures.c, {
      x: 8,
      y: 0,
      w: 3,
      d: 3,
    });
  });

  it("goes up one file revision on the layout", () => {
    assert.strictEqual(
      accepted([move("m1", "a", [0, 6])], "all").layout.revision,
      4
    );
  });

  it("keeps the order of the pending list in what it accepts", () => {
    const pending = [
      move("m1", "a", [0, 6]),
      move("m2", "c", [8, 6]),
      move("m3", "e", [16, 6]),
    ];

    const result = accepted(pending, ["m3", "m1"]);

    assert.deepStrictEqual(
      Arr.map(result.accepted, ({ id }) => id),
      ["m1", "m3"]
    );
    assert.deepStrictEqual(
      Arr.map(result.remaining, ({ id }) => id),
      ["m2"]
    );
  });

  it("takes a change named twice once", () => {
    const result = accepted([move("m1", "a", [0, 6])], ["m1", "m1"]);

    assert.strictEqual(result.accepted.length, 1);
  });

  it("refuses an id that no pending layout change has", () => {
    assert.include(refusal([move("m1", "a", [0, 6])], ["nope"]), '"nope"');
  });

  it("refuses when nothing is pending", () => {
    assert.include(refusal([], "all"), "Nothing is pending");
  });

  it("refuses a change for a structure the layout doesn't place", () => {
    assert.include(refusal([move("m1", "gone", [0, 6])], ["m1"]), '"gone"');
  });

  it("refuses a set that would overlap once applied", () => {
    // m1 moves a away from where m2 puts c's neighbour b.
    const pending = [move("m1", "a", [0, 6]), move("m2", "b", [0, 0])];

    assert.include(refusal(pending, ["m2"]), "overlap");
    assert.strictEqual(accepted(pending, ["m1", "m2"]).remaining.length, 0);
    assert.strictEqual(accepted(pending, "all").layout.structures.b?.x, 0);
  });

  it("doesn't count overlaps that were already in the layout", () => {
    const crowded: Layout = {
      ...layout,
      structures: {
        ...layout.structures,
        b: { x: 1, y: 0, w: 2, d: 2 },
      },
    };

    const result = acceptLayoutChanges({
      layout: crowded,
      pending: [move("m1", "e", [16, 6])],
      ids: ["m1"],
    });

    assert.isTrue(Result.isSuccess(result));
  });

  it("refuses a change that an earlier pending change on the same thing would overwrite", () => {
    const pending = [groupMove("g1"), move("m1", "a", [0, 20])];
    const early = refusal(pending, ["m1"]);

    assert.include(early, "g1");
    assert.include(early, "m1");
  });

  it("takes an earlier change when a later one on the same thing stays pending", () => {
    const pending = [groupMove("g1"), move("m1", "a", [0, 20])];
    const result = accepted(pending, ["g1"]);

    assert.deepStrictEqual(
      Arr.map(result.remaining, ({ id }) => id),
      ["m1"]
    );
  });

  it("lets a resize be accepted past a pending move of the same structure", () => {
    const pending = [move("m1", "a", [0, 6]), resize("r1", "a", [3, 3])];
    const result = accepted(pending, ["r1"]);

    assert.deepStrictEqual(result.layout.structures.a, {
      x: 0,
      y: 0,
      w: 3,
      d: 3,
    });
  });
});

const names = new Map([
  ["a", "Save server"],
  ["b", "Map page"],
  ["c", "Proposals"],
  ["d", "Engineer"],
  ["e", "Upstream"],
]);

const nameOf = (id: string) => names.get(id) ?? id;

describe("the message for an acceptance", () => {
  it("names a move", () => {
    assert.strictEqual(
      acceptanceMessage([move("m1", "a", [0, 6])], nameOf),
      "Move Save server"
    );
  });

  it("joins the kinds with a semicolon", () => {
    assert.strictEqual(
      acceptanceMessage(
        [move("m1", "a", [0, 6]), resize("r1", "b", [3, 3])],
        nameOf
      ),
      "Move Save server; resize Map page"
    );
  });

  it("groups the structures that share a kind, whichever change moved them", () => {
    assert.strictEqual(
      acceptanceMessage(
        [
          move("m1", "a", [0, 6]),
          resize("r1", "b", [3, 3]),
          move("m2", "c", [8, 6]),
        ],
        nameOf
      ),
      "Move Save server and Proposals; resize Map page"
    );
  });

  it("names each structure once", () => {
    assert.strictEqual(
      acceptanceMessage(
        [move("m1", "a", [0, 6]), move("m2", "a", [0, 8])],
        nameOf
      ),
      "Move Save server"
    );
  });

  it("lists all four structures before it starts counting", () => {
    assert.strictEqual(
      acceptanceMessage(
        [
          move("m1", "a", [0, 6]),
          move("m2", "b", [4, 6]),
          move("m3", "c", [8, 6]),
          move("m4", "d", [12, 6]),
        ],
        nameOf
      ),
      "Move Save server, Map page, Proposals and Engineer"
    );
  });

  it("lists a group move's structures", () => {
    assert.strictEqual(
      acceptanceMessage([groupMove("g1")], nameOf),
      "Move Save server and Map page"
    );
  });

  it("counts the structures past the third", () => {
    assert.strictEqual(
      acceptanceMessage(
        [
          move("m1", "a", [0, 6]),
          move("m2", "b", [4, 6]),
          move("m3", "c", [8, 6]),
          move("m4", "d", [12, 6]),
          move("m5", "e", [16, 6]),
        ],
        nameOf
      ),
      "Move Save server, Map page, Proposals and 2 more"
    );
  });

  it("falls back to the id of a structure it can't name", () => {
    assert.strictEqual(
      acceptanceMessage([move("m1", "x", [0, 6])], (id) => id),
      "Move x"
    );
  });
});

const decodeRevision = Schema.decodeUnknownResult(Revision, {
  onExcessProperty: "error",
});

describe("the revision file", () => {
  const revisionOf = Effect.gen(function* () {
    const { data, layout: snapshot } = yield* fixture("review");

    return {
      format: 1,
      revision: 1,
      savedAt: "2026-11-01T09:00:00.000Z",
      message: "Move Save server",
      accepted: [{ kind: "layout", change: move("m1", "a", [0, 6]) }],
      rejected: [],
      data,
      layout: snapshot,
    };
  });

  it.effect("names files by revision, zero-padded so they sort", () =>
    Effect.sync(() => {
      assert.strictEqual(revisionFileName(1), "0001.json");
      assert.strictEqual(revisionFileName(42), "0042.json");
      assert.strictEqual(revisionFileName(12_345), "12345.json");
      assert.isTrue(revisionFileName(9) < revisionFileName(10));
    })
  );

  it.effect("reads a revision number back from a file name", () =>
    Effect.sync(() => {
      assert.deepStrictEqual(
        parseRevisionFileName("0042.json"),
        Option.some(42)
      );
      assert.deepStrictEqual(
        parseRevisionFileName("12345.json"),
        Option.some(12_345)
      );
      assert.isTrue(Option.isNone(parseRevisionFileName("0042.json.12.tmp")));
      assert.isTrue(Option.isNone(parseRevisionFileName("notes.json")));
      assert.isTrue(Option.isNone(parseRevisionFileName("0000.json")));
      assert.isTrue(Option.isNone(parseRevisionFileName("00042.json")));
    })
  );

  it.effect(
    "holds the data, the layout, the message and the accepted items",
    () =>
      Effect.gen(function* () {
        const revision = yield* revisionOf;

        assert.isTrue(Result.isSuccess(decodeRevision(revision)));
      })
  );

  it.effect(
    "holds a rejected item with its reason, and an accepted one with a reason",
    () =>
      Effect.gen(function* () {
        const revision = yield* revisionOf;

        const withReasons = {
          ...revision,
          accepted: [
            {
              kind: "layout",
              change: move("m1", "a", [0, 6]),
              reason: "Looks right.",
            },
          ],
          rejected: [
            {
              kind: "layout",
              change: move("m2", "b", [4, 6]),
              reason: "Too close.",
            },
          ],
        };

        assert.isTrue(Result.isSuccess(decodeRevision(withReasons)));
      })
  );

  it.effect("refuses a rejected item with no reason", () =>
    Effect.gen(function* () {
      const revision = yield* revisionOf;
      const rejected = [{ kind: "layout", change: move("m2", "b", [4, 6]) }];

      assert.isTrue(
        Result.isFailure(decodeRevision({ ...revision, rejected }))
      );
    })
  );

  it.effect(
    "refuses a revision below 1, a field it doesn't know, a newer format and a bad timestamp",
    () =>
      Effect.gen(function* () {
        const revision = yield* revisionOf;

        for (const broken of [
          { ...revision, revision: 0 },
          { ...revision, extra: true },
          { ...revision, format: 2 },
          { ...revision, savedAt: "yesterday" },
          { ...revision, message: "" },
          { ...revision, data: undefined },
          { ...revision, layout: undefined },
        ]) {
          assert.isTrue(Result.isFailure(decodeRevision(broken)));
        }
      })
  );
});
