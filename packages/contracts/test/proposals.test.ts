import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Option, Result, Schema } from "effect";
import { vi } from "vitest";

import {
  applyLayoutChanges,
  checkProposals,
  discardChange,
  layoutRefusal,
  placeStructure,
  Proposals,
} from "../src/index.ts";
import type { Layout, LayoutChange, MapData, Structure } from "../src/index.ts";

vi.setConfig({ testTimeout: 5000 });

const accepted: Layout = {
  format: 1,
  revision: 3,
  structures: {
    a: { x: 0, y: 0, w: 2, d: 2 },
    b: { x: 4, y: 0, w: 2, d: 2 },
  },
};

const at = (x: number, y: number) => ({ x, y });

/** A move of one structure to the `[x, y]` in `to`. */
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
      position: at(to[0], to[1]),
    },
  ],
});

/** A resize of one structure to the `[w, d]` in `size`. */
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

const structure = (id: string): Structure => ({
  id,
  code: id,
  name: id,
  shape: "box",
  group: "main",
  status: "live",
  oneLiner: "One line.",
  whatItDoes: "Does.",
  howItsBuilt: "Built.",
});

const decode = Schema.decodeUnknownResult(Proposals, {
  onExcessProperty: "error",
});

/** Whether `layoutRefusal` refuses going from `before` to `after`. */
const refused = (
  before: readonly LayoutChange[],
  after: readonly LayoutChange[],
  layout: Layout = accepted
) => Option.isSome(layoutRefusal({ accepted: layout, before, after }));

const file = (layout: readonly LayoutChange[], format = 1) => ({
  format,
  revision: 0,
  layout,
});

/** Whether a file holding `layout`, any JSON, decodes. */
const decodesRaw = (
  layout: readonly Readonly<Record<string, string | readonly never[]>>[]
) => Result.isSuccess(decode({ format: 1, revision: 0, layout }));

const decodes = (layout: readonly LayoutChange[]) =>
  Result.isSuccess(decode(file(layout)));

let counter = 0;

const newId = () => {
  counter += 1;

  return `new${counter}`;
};

const place = (
  changes: readonly LayoutChange[],
  id: string,
  next: { x: number; y: number; w: number; d: number }
) => placeStructure({ changes, accepted, id, next, newId });

describe("applying pending layout changes", () => {
  it("moves and resizes structures, and leaves the rest as accepted", () => {
    const shown = applyLayoutChanges(accepted, [
      move("m1", "a", [0.5, 6]),
      resize("r1", "a", [3, 1.5]),
    ]);

    assert.deepStrictEqual(shown.structures, {
      a: { x: 0.5, y: 6, w: 3, d: 1.5 },
      b: { x: 4, y: 0, w: 2, d: 2 },
    });
    assert.strictEqual(shown.revision, 3);
  });

  it("returns the accepted layout itself when nothing is pending", () => {
    assert.strictEqual(applyLayoutChanges(accepted, []), accepted);
  });

  it("skips a change for a structure the layout doesn't place", () => {
    const shown = applyLayoutChanges(accepted, [move("m1", "gone", [9, 9])]);

    assert.deepStrictEqual(shown.structures, accepted.structures);
  });

  it("applies changes in list order, so a later one wins", () => {
    const group: LayoutChange = {
      id: "g",
      kind: "move",
      moves: [
        { target: { kind: "structure", id: "a" }, position: at(0, 10) },
        { target: { kind: "structure", id: "b" }, position: at(4, 10) },
      ],
    };

    const later = applyLayoutChanges(accepted, [group, move("m", "a", [1, 1])]);

    const earlier = applyLayoutChanges(accepted, [
      move("m", "a", [1, 1]),
      group,
    ]);

    assert.deepStrictEqual(later.structures.a, { x: 1, y: 1, w: 2, d: 2 });
    assert.deepStrictEqual(later.structures.b, { x: 4, y: 10, w: 2, d: 2 });
    assert.deepStrictEqual(earlier.structures.a, { x: 0, y: 10, w: 2, d: 2 });
  });

  it("ignores a change whose structure id is a prototype key", () => {
    const shown = applyLayoutChanges(accepted, [
      move("m1", "__proto__", [9, 9]),
      move("m2", "constructor", [9, 9]),
    ]);

    assert.deepStrictEqual(shown.structures, accepted.structures);
  });
});

describe("placing a structure", () => {
  it("adds a move with a new id", () => {
    const changes = place([], "a", { x: 0, y: 6, w: 2, d: 2 });

    assert.deepStrictEqual(changes, [move("new1", "a", [0, 6])]);
  });

  it("updates a structure's own move, keeping its id", () => {
    const first = place([], "a", { x: 0, y: 6, w: 2, d: 2 });
    const second = place(first, "a", { x: 0, y: 8, w: 2, d: 2 });

    assert.deepStrictEqual(
      Arr.map(second, ({ id }) => id),
      Arr.map(first, ({ id }) => id)
    );
    assert.deepStrictEqual(
      Arr.map(second, ({ kind }) => kind),
      ["move"]
    );
  });

  it("keeps a resize's id as the corner moves, and a corner can add a move too", () => {
    const first = place([], "a", { x: 0, y: 0, w: 3, d: 2 });
    const second = place(first, "a", { x: -0.5, y: 0, w: 3.5, d: 2 });
    const resizes = Arr.filter(second, ({ kind }) => kind === "resize");

    assert.strictEqual(second.length, 2);
    assert.deepStrictEqual(
      Arr.map(resizes, ({ id }) => id),
      [first[0]?.id]
    );
  });

  it("drops a change that puts the structure back where it was accepted", () => {
    const first = place([], "a", { x: 0, y: 6, w: 2, d: 2 });

    assert.deepStrictEqual(place(first, "a", { x: 0, y: 0, w: 2, d: 2 }), []);
  });

  it("puts the structure's own change after a group move, so it wins", () => {
    const group: LayoutChange = {
      id: "g",
      kind: "move",
      moves: [
        { target: { kind: "structure", id: "a" }, position: at(0, 10) },
        { target: { kind: "structure", id: "b" }, position: at(4, 10) },
      ],
    };

    const changes = place([group], "a", { x: 1, y: 10, w: 2, d: 2 });

    assert.deepStrictEqual(Arr.map(changes, ({ id }) => id).slice(0, 1), ["g"]);
    assert.strictEqual(changes.length, 2);
    assert.deepStrictEqual(applyLayoutChanges(accepted, changes).structures.a, {
      x: 1,
      y: 10,
      w: 2,
      d: 2,
    });
  });

  it("ignores an id the layout doesn't place, or a prototype key", () => {
    assert.deepStrictEqual(place([], "gone", { x: 0, y: 0, w: 1, d: 1 }), []);
    assert.deepStrictEqual(
      place([], "constructor", { x: 0, y: 0, w: 1, d: 1 }),
      []
    );
  });

  it("discards a change by id", () => {
    const changes = [move("m1", "a", [0, 6]), resize("r1", "b", [3, 2])];

    assert.deepStrictEqual(discardChange(changes, "m1"), [
      resize("r1", "b", [3, 2]),
    ]);
  });
});

describe("refusing layout changes", () => {
  it("refuses a move that makes footprints overlap", () => {
    const refusal = layoutRefusal({
      accepted,
      before: [],
      after: [move("m1", "a", [3, 0])],
    });

    assert.deepStrictEqual(
      refusal,
      Option.some(
        'a at x 3, y 0, w 2, d 2 would overlap "b" at x 4, y 0, w 2, d 2. Pick a free spot.'
      )
    );
  });

  it("refuses a resize that reaches another footprint", () => {
    assert.isTrue(refused([], [resize("r1", "a", [4.5, 2])]));
  });

  it("allows footprints that only touch along an edge", () => {
    assert.isFalse(refused([], [resize("r1", "a", [4, 2])]));
  });

  it("checks every structure of a move of several", () => {
    const group: LayoutChange = {
      id: "g",
      kind: "move",
      moves: [
        { target: { kind: "structure", id: "a" }, position: at(0, 10) },
        { target: { kind: "structure", id: "b" }, position: at(1, 10) },
      ],
    };

    assert.isTrue(refused([], [group]));
  });

  it("checks against other pending moves, not only the accepted layout", () => {
    const away = move("m1", "b", [10, 0]);

    assert.isFalse(refused([away], [away, move("m2", "a", [4, 0])]));
    assert.isTrue(refused([away], [away, move("m2", "a", [9, 0])]));
  });

  it("allows a discard that leaves nothing on top of anything", () => {
    assert.isFalse(
      refused(
        [move("m1", "a", [0, 6]), resize("r1", "b", [3, 2])],
        [move("m1", "a", [0, 6])]
      )
    );
  });

  it("allows a discard onto an overlap the accepted layout already had", () => {
    const crowded: Layout = {
      ...accepted,
      structures: { ...accepted.structures, c: { x: 0, y: 1, w: 2, d: 2 } },
    };

    assert.isFalse(refused([move("m1", "a", [0, 8])], [], crowded));
  });

  it("refuses a discard that puts a structure back on a pending footprint, naming the other change", () => {
    // a moved away, then b moved into a's old place. Discarding a's move
    // would put it back on b.
    const before = [move("m1", "a", [0, 8]), move("m2", "b", [0, 0])];

    const refusal = layoutRefusal({
      accepted,
      before,
      after: [move("m2", "b", [0, 0])],
    });

    assert.isTrue(Option.isSome(refusal));
    assert.include(
      Option.getOrElse(refusal, () => ""),
      "change m2"
    );
    assert.include(
      Option.getOrElse(refusal, () => ""),
      "change m1"
    );
  });

  it("refuses a change for a structure the layout doesn't place", () => {
    assert.isTrue(refused([], [move("m1", "gone", [9, 9])]));
  });

  it("refuses prototype keys as structure ids", () => {
    for (const id of [
      "__proto__",
      "constructor",
      "toString",
      "hasOwnProperty",
    ]) {
      assert.isTrue(refused([], [move("m1", id, [9, 9])]), id);
      assert.isTrue(refused([], [resize("r1", id, [3, 3])]), id);
    }
  });
});

describe("the proposals.json schema", () => {
  it("reads a file with pending moves and resizes", () => {
    const body = file([move("m1", "a", [0, 6]), resize("r1", "a", [3, 2])]);

    assert.deepStrictEqual(decode(body), Result.succeed(body));
  });

  it("reads a move of several structures", () => {
    assert.isTrue(
      decodes([
        {
          id: "g",
          kind: "move",
          moves: [
            { target: { kind: "structure", id: "a" }, position: at(0, 10) },
            { target: { kind: "structure", id: "b" }, position: at(4, 10) },
          ],
        },
      ])
    );
  });

  it("refuses a move of nothing", () => {
    assert.isFalse(decodesRaw([{ id: "g", kind: "move", moves: [] }]));
  });

  it("refuses two changes with one id", () => {
    assert.isFalse(
      decodes([move("same", "a", [0, 6]), resize("same", "b", [3, 2])])
    );
  });

  it("refuses a change with no id", () => {
    assert.isFalse(decodesRaw([{ kind: "move", moves: [] }]));
  });

  it("refuses an id with odd characters", () => {
    assert.isFalse(decodes([move("a b", "a", [0, 6])]));
    assert.isFalse(decodes([move("a/b", "a", [0, 6])]));
  });

  it("refuses a position off the half-unit grid", () => {
    assert.isFalse(decodes([move("m1", "a", [0.3, 6])]));
  });

  it("tells you to upgrade when the format is newer than this one", () => {
    const message = Result.match(decode(file([], 2)), {
      onSuccess: () => "",
      onFailure: (error) => error.message,
    });

    assert.include(message, "Upgrade axonometric");
    assert.notInclude(message, "the only format");
  });
});

describe("checking proposals", () => {
  const data: MapData = {
    format: 1,
    revision: 0,
    overview: { title: "Map", summary: "A map." },
    groups: [{ id: "main", title: "Main" }],
    structures: [structure("a"), structure("b")],
    hops: [],
    flows: [],
    chapters: [],
  };

  it("warns about a change for a structure data.mjs doesn't have", () => {
    const problems = checkProposals(data, accepted, {
      format: 1,
      revision: 1,
      layout: [move("m1", "gone", [9, 9])],
    });

    assert.deepStrictEqual(problems, [
      {
        severity: "warning",
        file: "proposals.json",
        path: "layout[0].moves[0].target.id",
        message:
          'no structure in data.mjs has the id "gone", so this move does nothing. Discard it from the page\'s Pending list.',
      },
    ]);
  });

  it("warns when a pending footprint overlaps another", () => {
    const problems = checkProposals(data, accepted, {
      format: 1,
      revision: 1,
      layout: [move("m1", "a", [4, 1])],
    });

    assert.strictEqual(problems.length, 1);
    assert.include(problems[0]?.message, 'overlap "b"');
  });
});
