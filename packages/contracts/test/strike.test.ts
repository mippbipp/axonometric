import { assert, describe, it } from "@effect/vitest";
import { Array as Arr } from "effect";

import {
  groundOutline,
  groundProjections,
  segmentCrosses,
  strikeSegments,
} from "../src/index.ts";
import type { View } from "../src/index.ts";

const placement = { x: 0, y: 0, w: 2, d: 2 };

/** A chip's box just inside the first corner of the footprint in `view`. */
const chipAt = (view: View) => {
  const [corner] = groundOutline(placement, groundProjections[view]);
  const { sx, sy } = corner ?? { sx: 0, sy: 0 };

  return { left: sx + 2, top: sy + 2, right: sx + 18, bottom: sy + 17 };
};

const crossingChip = (view: View) => {
  const chip = chipAt(view);

  const pieces = strikeSegments({
    placement,
    ground: groundProjections[view],
    text: [chip],
  });

  const box = [
    { sx: chip.left, sy: chip.top },
    { sx: chip.right, sy: chip.top },
    { sx: chip.right, sy: chip.bottom },
    { sx: chip.left, sy: chip.bottom },
  ];

  return {
    count: pieces.length,
    crossing: Arr.filter(pieces, (piece) => segmentCrosses(piece, box)),
  };
};

describe("the cross through a deleted structure", () => {
  it.each(["iso", "plan"] as const)(
    "keeps clear of a chip on a corner of the %s footprint",
    (view) => {
      const { count, crossing } = crossingChip(view);

      assert.isAtLeast(count, 2);
      assert.deepStrictEqual(crossing, []);
    },
    5000
  );

  it("is the two whole diagonals when there is no text", () => {
    const pieces = strikeSegments({
      placement,
      ground: groundProjections.plan,
      text: [undefined],
    });

    const [a, b, c, d] = groundOutline(placement, groundProjections.plan);

    // Each piece runs from one corner to the opposite one.
    assert.sameDeepMembers(
      Arr.map(pieces, ({ start, end }) => [start, end]),
      [
        [a, c],
        [b, d],
      ]
    );
  }, 5000);
});
