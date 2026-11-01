import { assert, describe, it } from "@effect/vitest";
import { Option, Result, Schema } from "effect";
import { vi } from "vitest";

import {
  applyLayoutChanges,
  checkProposals,
  layoutRefusal,
  Proposals,
  replaceChanges,
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

const move = (structureId: string, x: number, y: number): LayoutChange => ({
  kind: "move",
  structureId,
  position: { x, y },
});

const resize = (structureId: string, w: number, d: number): LayoutChange => ({
  kind: "resize",
  structureId,
  footprint: { w, d },
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

const decodes = (layout: readonly LayoutChange[]) =>
  Result.isSuccess(decode({ format: 1, revision: 0, layout }));

describe("applying pending layout changes", () => {
  it("moves and resizes structures, and leaves the rest as accepted", () => {
    const shown = applyLayoutChanges(accepted, [
      move("a", 0.5, 6),
      resize("a", 3, 1.5),
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
    const shown = applyLayoutChanges(accepted, [move("gone", 9, 9)]);

    assert.deepStrictEqual(shown.structures, accepted.structures);
  });

  it("replaces a structure's changes, dropping those that match the accepted layout", () => {
    const changes = [move("a", 0, 6), move("b", 4, 6)];

    assert.deepStrictEqual(
      replaceChanges({
        changes,
        accepted,
        id: "a",
        next: { x: 0, y: 0, w: 3, d: 2 },
      }),
      [move("b", 4, 6), resize("a", 3, 2)]
    );
  });
});

describe("refusing layout changes", () => {
  it("refuses a move that makes footprints overlap", () => {
    const refusal = layoutRefusal({
      accepted,
      before: [],
      after: [move("a", 3, 0)],
    });

    assert.deepStrictEqual(
      refusal,
      Option.some(
        'a at x 3, y 0, w 2, d 2 would overlap "b" at x 4, y 0, w 2, d 2. Pick a free spot.'
      )
    );
  });

  it("refuses a resize that reaches another footprint", () => {
    assert.isTrue(refused([], [resize("a", 4.5, 2)]));
  });

  it("allows footprints that only touch along an edge", () => {
    assert.isFalse(refused([], [resize("a", 4, 2)]));
  });

  it("checks against other pending moves, not only the accepted layout", () => {
    // b's pending move frees the spot a moves to, and a then lands on b's
    // new spot.
    const away = move("b", 10, 0);

    assert.isFalse(refused([away], [away, move("a", 4, 0)]));
    assert.isTrue(refused([away], [away, move("a", 9, 0)]));
  });

  it("never refuses a discard", () => {
    // The accepted layout changed under a pending move, so the move now
    // overlaps. Discarding any change still goes through.
    const crowded: Layout = {
      ...accepted,
      structures: { ...accepted.structures, c: { x: 0, y: 6, w: 2, d: 2 } },
    };

    assert.isFalse(
      refused([move("a", 0, 6), move("b", 4, 6)], [move("a", 0, 6)], crowded)
    );
  });

  it("refuses a change for a structure the layout doesn't place", () => {
    assert.isTrue(refused([], [move("gone", 9, 9)]));
  });
});

describe("the proposals.json schema", () => {
  it("reads a file with pending moves and resizes", () => {
    const file = {
      format: 1 as const,
      revision: 2,
      layout: [move("a", 0, 6), resize("a", 3, 2)],
    };

    assert.deepStrictEqual(decode(file), Result.succeed(file));
  });

  it("refuses two moves of one structure", () => {
    assert.isFalse(decodes([move("a", 0, 6), move("a", 1, 6)]));
  });

  it("refuses a position off the half-unit grid", () => {
    assert.isFalse(decodes([move("a", 0.3, 6)]));
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
      layout: [move("gone", 9, 9)],
    });

    assert.deepStrictEqual(problems, [
      {
        severity: "warning",
        file: "proposals.json",
        path: "layout[0].structureId",
        message:
          'no structure in data.mjs has the id "gone", so this move does nothing. Discard it from the page\'s Pending list.',
      },
    ]);
  });

  it("warns when a pending footprint overlaps another", () => {
    const problems = checkProposals(data, accepted, {
      format: 1,
      revision: 1,
      layout: [move("a", 4, 1)],
    });

    assert.strictEqual(problems.length, 1);
    assert.include(problems[0]?.message, 'overlap "b"');
  });
});
