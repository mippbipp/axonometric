import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

// The editor has no test runner of its own; its pure modules are tested here.
import { readableScale, tagGrowthAt } from "../../editor/src/readable-text.ts";

const rect = (
  left: number,
  top: number,
  { width, height = 18 }: { readonly width: number; readonly height?: number }
) => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
});

const polygon = (box: ReturnType<typeof rect>) => [
  { sx: box.left, sy: box.top },
  { sx: box.right, sy: box.top },
  { sx: box.right, sy: box.bottom },
  { sx: box.left, sy: box.bottom },
];

/** A 100 by 18 tag at `left`, hanging from the middle of its top edge. */
const hanging = (left: number) => ({
  rect: rect(left, 0, { width: 100 }),
  anchor: { sx: left + 50, sy: 0 },
});

/** Name tags start growing below this scale: 10 px over a 12 px font. */
const growsBelow = 10 / 12;

describe("the scale zoom to fit stops at so name tags don't collide", () => {
  it.effect("grows tags only below the scale where they'd draw at 10 px", () =>
    Effect.sync(() => {
      assert.strictEqual(tagGrowthAt(1), 1);
      assert.strictEqual(tagGrowthAt(growsBelow), 1);
      assert.closeTo(tagGrowthAt(growsBelow / 2), 2, 1e-9);
    })
  );

  it.effect("is the fitted scale when nothing collides", () =>
    Effect.sync(() => {
      const layout = { tags: [hanging(0)], shapes: [], text: [] };

      assert.strictEqual(readableScale(layout, 0.2), 0.2);
      assert.strictEqual(readableScale(layout, 1.2), 1.2);
    })
  );

  it.effect("is where two tags side by side would touch", () =>
    Effect.sync(() => {
      // Centres 150 apart, each 100 wide: they touch at 1.5 times size.
      const layout = { tags: [hanging(0), hanging(150)], shapes: [], text: [] };

      assert.closeTo(readableScale(layout, 0.3), growsBelow / 1.5, 1e-6);
      assert.strictEqual(readableScale(layout, 0.7), 0.7);
    })
  );

  it.effect("lets a tag grow away from its anchor, past a box above it", () =>
    Effect.sync(() => {
      const above = polygon(rect(0, -40, { width: 100, height: 39 }));
      const below = polygon(rect(0, 36, { width: 100, height: 44 }));

      assert.strictEqual(
        readableScale({ tags: [hanging(0)], shapes: [above], text: [] }, 0.1),
        0.1
      );
      // 18 tall reaches 36 down at twice its size.
      assert.closeTo(
        readableScale({ tags: [hanging(0)], shapes: [below], text: [] }, 0.1),
        growsBelow / 2,
        1e-6
      );
    })
  );

  it.effect("minds a hop label only at scales where it shows", () =>
    Effect.sync(() => {
      // The tag's right edge reaches the label at 53 / 50 times its size,
      // below 0.786; the label shows from 0.75.
      const layout = {
        tags: [{ rect: rect(0, 0, { width: 100 }), anchor: { sx: 50, sy: 9 } }],
        shapes: [],
        text: [
          { polygon: polygon(rect(103, 0, { width: 40 })), shownFrom: 0.75 },
        ],
      };

      const touches = growsBelow / (53 / 50);

      assert.strictEqual(readableScale(layout, 0.5), 0.5);
      assert.closeTo(readableScale(layout, 0.76), touches, 1e-6);
      assert.strictEqual(readableScale(layout, 0.8), 0.8);
    })
  );

  it.effect("ignores collisions the drawing already has at full size", () =>
    Effect.sync(() => {
      const layout = { tags: [hanging(0), hanging(90)], shapes: [], text: [] };

      assert.strictEqual(readableScale(layout, 0.2), 0.2);
    })
  );
});
