import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Record as Rec } from "effect";

import {
  alignMoves,
  appendMove,
  distributeMoves,
  nudgeMoves,
  structuresInBox,
} from "../src/index.ts";
import type { LayoutChange, Placement } from "../src/index.ts";

interface Point {
  readonly x: number;
  readonly y: number;
}

const at = (
  x: number,
  y: number,
  size?: { readonly d: number; readonly w: number }
): Placement => ({ d: size?.d ?? 2, w: size?.w ?? 2, x, y });

const placements = {
  a: at(0, 0),
  b: at(5, 3, { d: 1, w: 3 }),
  c: at(10, 6, { d: 4, w: 1 }),
};

/** The positions an alignment sets, by structure id. */
const positions = (moves: ReturnType<typeof alignMoves>) =>
  Rec.fromEntries(
    Arr.map(moves, (move) => [move.target.id, move.position] as const)
  );

describe("aligning structures", () => {
  it("left puts every left edge on the smallest x", () => {
    assert.deepStrictEqual(
      positions(alignMoves({ how: "left", ids: ["a", "b", "c"], placements })),
      { b: { x: 0, y: 3 }, c: { x: 0, y: 6 } }
    );
  });

  it("right puts every right edge on the largest right edge", () => {
    // c ends at 11, so a (w 2) starts at 9 and b (w 3) at 8.
    assert.deepStrictEqual(
      positions(alignMoves({ how: "right", ids: ["a", "b", "c"], placements })),
      { a: { x: 9, y: 0 }, b: { x: 8, y: 3 } }
    );
  });

  it("top puts every top edge on the smallest y", () => {
    assert.deepStrictEqual(
      positions(alignMoves({ how: "top", ids: ["a", "b", "c"], placements })),
      { b: { x: 5, y: 0 }, c: { x: 10, y: 0 } }
    );
  });

  it("bottom puts every bottom edge on the largest bottom edge", () => {
    // c ends at 10 along y.
    assert.deepStrictEqual(
      positions(
        alignMoves({ how: "bottom", ids: ["a", "b", "c"], placements })
      ),
      { a: { x: 0, y: 8 }, b: { x: 5, y: 9 } }
    );
  });

  it("centre-x puts every centre on the middle of the selection's x extent", () => {
    // The extent is 0 to 11, so the middle is 5.5. a (w 2) starts at 4.5,
    // b (w 3) at 4 and c (w 1) at 5.
    assert.deepStrictEqual(
      positions(
        alignMoves({ how: "centre-x", ids: ["a", "b", "c"], placements })
      ),
      { a: { x: 4.5, y: 0 }, b: { x: 4, y: 3 }, c: { x: 5, y: 6 } }
    );
  });

  it("centre-y puts every centre on the middle of the selection's y extent", () => {
    // The extent is 0 to 10, so the middle is 5. a (d 2) starts at 4,
    // b (d 1) at 4.5 and c (d 4) at 3.
    assert.deepStrictEqual(
      positions(
        alignMoves({ how: "centre-y", ids: ["a", "b", "c"], placements })
      ),
      { a: { x: 0, y: 4 }, b: { x: 5, y: 4.5 }, c: { x: 10, y: 3 } }
    );
  });

  it("lands on half units when the middle falls between them", () => {
    // Extent 0 to 5, middle 2.5. A 2-wide box would start at 1.5, a 1-wide
    // one at 2.
    const moves = alignMoves({
      how: "centre-x",
      ids: ["p", "q"],
      placements: { p: at(0, 0, { d: 1, w: 2 }), q: at(4, 0, { d: 1, w: 1 }) },
    });

    assert.deepStrictEqual(positions(moves), {
      p: { x: 1.5, y: 0 },
      q: { x: 2, y: 0 },
    });
  });

  it("leaves out a structure that is already aligned, and ids it doesn't place", () => {
    const moves = alignMoves({ how: "left", ids: ["a", "ghost"], placements });

    assert.deepStrictEqual(moves, []);
  });
});

describe("distributing structures", () => {
  const row = {
    a: at(0, 0),
    b: at(3, 4),
    c: at(10, 2, { d: 1, w: 4 }),
    d: at(20, 0),
  };

  it("keeps the first and last in place and equalises the gaps along x", () => {
    // The extent is 0 to 22; the widths total 2 + 2 + 4 + 2 = 10, so the
    // three gaps are 4 each: b at 6, c at 12.
    assert.deepStrictEqual(
      positions(
        distributeMoves({
          axis: "x",
          ids: ["a", "b", "c", "d"],
          placements: row,
        })
      ),
      { b: { x: 6, y: 4 }, c: { x: 12, y: 2 } }
    );
  });

  it("equalises the gaps along y by the footprint depth", () => {
    // Sorted by y: a (0, d 2), c (2, d 1), b (4, d 2). The extent is 0 to 6
    // and the depths total 5, so the gaps are 0.5: c at 2.5.
    assert.deepStrictEqual(
      positions(
        distributeMoves({ axis: "y", ids: ["a", "b", "c"], placements: row })
      ),
      { c: { x: 10, y: 2.5 } }
    );
  });

  it("orders by position, not by the order of ids", () => {
    assert.deepStrictEqual(
      positions(
        distributeMoves({
          axis: "x",
          ids: ["d", "c", "b", "a"],
          placements: row,
        })
      ),
      { b: { x: 6, y: 4 }, c: { x: 12, y: 2 } }
    );
  });

  it("rounds a gap that falls between half units to the nearest half unit", () => {
    // Extent 0 to 7, widths total 6, two gaps of 0.5: no rounding needed.
    // Extent 0 to 8 gives gaps of 1. Extent 0 to 7.5 gives 0.75, so the
    // middle box starts at 2.75, which rounds to 3.
    const moves = distributeMoves({
      axis: "x",
      ids: ["p", "q", "r"],
      placements: { p: at(0, 0), q: at(2.5, 5), r: at(5.5, 0) },
    });

    assert.deepStrictEqual(positions(moves), { q: { x: 3, y: 5 } });
  });

  it("does nothing for fewer than three structures", () => {
    assert.deepStrictEqual(
      distributeMoves({ axis: "x", ids: ["a", "d"], placements: row }),
      []
    );
  });
});

describe("nudging structures", () => {
  it("shifts every structure by the same step", () => {
    assert.deepStrictEqual(
      positions(
        nudgeMoves({ delta: { x: 0.5, y: 0 }, ids: ["a", "b"], placements })
      ),
      { a: { x: 0.5, y: 0 }, b: { x: 5.5, y: 3 } }
    );
  });
});

describe("selecting with a box", () => {
  const spread = { a: at(0, 0), b: at(4, 0), c: at(8, 0), d: at(0, 4) };
  const everyone = ["a", "b", "c", "d"];

  /** The structures a box between two ground points touches. */
  const touched = (
    from: Point,
    to: Point,
    ids: ReadonlyArray<string> = everyone
  ) => structuresInBox({ box: { from, to }, ids, placements: spread });

  it("picks every structure whose footprint the box overlaps", () => {
    // The box reaches x 1 to 5, so it overlaps a (0 to 2) and b (4 to 6).
    assert.deepStrictEqual(touched({ x: 1, y: 0.5 }, { x: 5, y: 1.5 }), [
      "a",
      "b",
    ]);
  });

  it("takes the corners in either order", () => {
    assert.deepStrictEqual(touched({ x: 5, y: 1.5 }, { x: 1, y: 0.5 }), [
      "a",
      "b",
    ]);
  });

  it("does not pick a footprint the box only touches along an edge", () => {
    assert.deepStrictEqual(touched({ x: 2, y: 0 }, { x: 4, y: 2 }), []);
  });

  it("picks a structure the box sits wholly inside", () => {
    assert.deepStrictEqual(touched({ x: 8.5, y: 0.5 }, { x: 9, y: 1 }), ["c"]);
  });

  it("looks only at the ids it's given", () => {
    assert.deepStrictEqual(
      touched({ x: -1, y: -1 }, { x: 20, y: 20 }, ["b", "d", "ghost"]),
      ["b", "d"]
    );
  });
});

describe("appending a move to the pending changes", () => {
  const existing: LayoutChange = {
    id: "m1",
    kind: "move",
    moves: [{ position: at(1, 1), target: { id: "a", kind: "structure" } }],
  };

  it("adds one change holding every move, after the existing ones", () => {
    const moves = [
      { position: at(0, 3), target: { id: "b", kind: "structure" as const } },
      { position: at(0, 6), target: { id: "c", kind: "structure" as const } },
    ] as const;

    assert.deepStrictEqual(
      appendMove({ changes: [existing], id: "m2", moves }),
      [existing, { id: "m2", kind: "move", moves }]
    );
  });

  it("adds nothing when there is nothing to move", () => {
    assert.deepStrictEqual(
      appendMove({ changes: [existing], id: "m2", moves: [] }),
      [existing]
    );
  });
});
