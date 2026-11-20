import { assert, describe, it } from "@effect/vitest";
import { Array as Arr } from "effect";

import {
  groundOutline,
  groundProjections,
  strikeSegments,
} from "../src/index.ts";
import type { View } from "../src/index.ts";
import { crossesPolygon, rectCorners } from "./screen-geometry.ts";

const placement = { d: 2, w: 2, x: 0, y: 0 };

/** A chip's box just inside the first corner of the footprint in `view`. */
const chipAt = (view: View) => {
  const [corner] = groundOutline(placement, groundProjections[view]);
  const { sx, sy } = corner ?? { sx: 0, sy: 0 };

  return { bottom: sy + 17, left: sx + 2, right: sx + 18, top: sy + 2 };
};

const crossingChip = (view: View) => {
  const chip = chipAt(view);

  const pieces = strikeSegments({
    ground: groundProjections[view],
    placement,
    text: [chip],
  });

  return {
    count: pieces.length,
    crossing: Arr.filter(pieces, (piece) =>
      crossesPolygon(piece, rectCorners(chip))
    ),
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
      ground: groundProjections.plan,
      placement,
      text: [undefined],
    });

    const [a, b, c, d] = groundOutline(placement, groundProjections.plan);

    // Each piece runs from one corner to the opposite one.
    assert.sameDeepMembers(
      Arr.map(pieces, ({ end, start }) => [start, end]),
      [
        [a, c],
        [b, d],
      ]
    );
  });
});
