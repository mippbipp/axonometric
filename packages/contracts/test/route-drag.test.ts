import { assert, describe, it } from "@effect/vitest";
import { Array as Arr } from "effect";
import { vi } from "vitest";

import { dragSegment, routeVertices, segmentGuides } from "../src/index.ts";
import type { GridPoint, Placement } from "../src/index.ts";
import { onEdge } from "./route-geometry.ts";

vi.setConfig({ testTimeout: 5000 });

const from: Placement = { x: 0, y: 0, w: 2, d: 2 };

const to: Placement = { x: 8, y: 0, w: 2, d: 2 };

const ends = { from, to };

const p = (x: number, y: number): GridPoint => ({ x, y });

/** Out of A's +x face, round a detour below, into B's -x face. */
const detour = [p(2, 1), p(3, 1), p(3, 5), p(7, 5), p(7, 1), p(8, 1)];

const drag = (points: readonly GridPoint[], segment: number, offset: number) =>
  dragSegment({ points, segment, offset, ends });

const dragBetween = (
  placed: typeof ends,
  drags: readonly [readonly GridPoint[], number, number]
) =>
  dragSegment({
    points: drags[0],
    segment: drags[1],
    offset: drags[2],
    ends: placed,
  });

/** Every segment of the detour with offsets either side, in and out of range. */
const allDrags: readonly (readonly [number, number])[] = Arr.flatMap(
  [0, 1, 2, 3, 4],
  (segment) =>
    Arr.map(
      [-6, -2.5, -0.5, 0.5, 1, 3.5, 8],
      (offset) => [segment, offset] as const
    )
);

const straight = (before: GridPoint | undefined, point: GridPoint) =>
  before !== undefined && (before.x === point.x || before.y === point.y);

describe("the vertices of a route", () => {
  it("keeps the ends and the bends, and drops points in a straight line", () => {
    assert.deepStrictEqual(
      routeVertices([p(2, 1), p(3, 1), p(4, 1), p(4, 2), p(4, 3), p(5, 3)]),
      [p(2, 1), p(4, 1), p(4, 3), p(5, 3)]
    );
  });

  it("merges repeated points", () => {
    assert.deepStrictEqual(routeVertices([p(2, 1), p(2, 1), p(5, 1)]), [
      p(2, 1),
      p(5, 1),
    ]);
  });
});

describe("dragging a segment", () => {
  it("moves a horizontal segment up or down, and the segments either side stretch", () => {
    assert.deepStrictEqual(drag(detour, 2, 1), [
      p(2, 1),
      p(3, 1),
      p(3, 6),
      p(7, 6),
      p(7, 1),
      p(8, 1),
    ]);
  });

  it("moves a vertical segment along x", () => {
    assert.deepStrictEqual(drag(detour, 1, 1.5), [
      p(2, 1),
      p(4.5, 1),
      p(4.5, 5),
      p(7, 5),
      p(7, 1),
      p(8, 1),
    ]);
  });

  it("snaps the offset to half units", () => {
    assert.deepStrictEqual(drag(detour, 2, 0.3), drag(detour, 2, 0.5));
    assert.deepStrictEqual(drag(detour, 2, 0.2), routeVertices(detour));
  });

  it("flattens a detour that is dragged back in line with its ends", () => {
    assert.deepStrictEqual(drag(detour, 2, -4), [p(2, 1), p(8, 1)]);
  });

  it("keeps the leg out of a box at least half a unit long", () => {
    // Pulling the first vertical leg left would send the route back through A.
    assert.deepStrictEqual(drag(detour, 1, -2), [
      p(2, 1),
      p(2.5, 1),
      p(2.5, 5),
      p(7, 5),
      p(7, 1),
      p(8, 1),
    ]);
  });

  it("keeps the leg into a box at least half a unit long", () => {
    assert.deepStrictEqual(drag(detour, 3, 3), [
      p(2, 1),
      p(3, 1),
      p(3, 5),
      p(7.5, 5),
      p(7.5, 1),
      p(8, 1),
    ]);
  });

  it("slides both ends along their edges while they stay on them", () => {
    assert.deepStrictEqual(drag([p(2, 1), p(8, 1)], 0, 0.5), [
      p(2, 1.5),
      p(8, 1.5),
    ]);
  });

  it("jogs out from the ends when a straight route is dragged past its edges", () => {
    assert.deepStrictEqual(drag([p(2, 1), p(8, 1)], 0, 3), [
      p(2, 1.5),
      p(2.5, 1.5),
      p(2.5, 4),
      p(7.5, 4),
      p(7.5, 1.5),
      p(8, 1.5),
    ]);
  });

  it("jogs the end of a first segment that is dragged past its edge", () => {
    // Segment 0 leaves A along x; dragging it down lengthens the leg after it.
    const route = [p(2, 1), p(3, 1), p(3, 5), p(8, 5)];
    const tall: Placement = { x: 8, y: 4, w: 2, d: 2 };

    assert.deepStrictEqual(dragBetween({ from, to: tall }, [route, 0, -3]), [
      p(2, 0.5),
      p(2.5, 0.5),
      p(2.5, -2),
      p(3, -2),
      p(3, 5),
      p(8, 5),
    ]);
  });

  it("keeps a short straight route between touching footprints on their shared edge", () => {
    const left: Placement = { x: 0, y: 0, w: 2, d: 2 };
    const right: Placement = { x: 2.5, y: 0, w: 2, d: 2 };

    assert.deepStrictEqual(
      dragBetween({ from: left, to: right }, [[p(2, 1), p(2.5, 1)], 0, 4]),
      [p(2, 1.5), p(2.5, 1.5)]
    );
  });

  it("leaves a route alone when the segment doesn't exist", () => {
    assert.deepStrictEqual(drag(detour, 9, 1), routeVertices(detour));
    assert.deepStrictEqual(drag(detour, -1, 1), routeVertices(detour));
  });

  it("keeps both ends on their footprints and every leg along x or y, whichever segment is dragged how far", () => {
    for (const [segment, offset] of allDrags) {
      const result = drag(detour, segment, offset);
      const where = `segment ${segment} dragged by ${offset}`;

      assert.isTrue(onEdge(result[0], from), `${where}: start off A`);
      assert.isTrue(onEdge(result.at(-1), to), `${where}: end off B`);
      assert.isTrue(
        Arr.every(result.slice(1), (point, index) =>
          straight(result[index], point)
        ),
        `${where}: a leg runs diagonally`
      );
    }
  });
});

describe("the guides for dragging segments", () => {
  it("returns each segment of the route itself when it is drawn as it is", () => {
    assert.deepStrictEqual(segmentGuides({ route: detour, drawn: detour }), [
      { from: p(2, 1), to: p(3, 1), axis: "x" },
      { from: p(3, 1), to: p(3, 5), axis: "y" },
      { from: p(3, 5), to: p(7, 5), axis: "x" },
      { from: p(7, 5), to: p(7, 1), axis: "y" },
      { from: p(7, 1), to: p(8, 1), axis: "x" },
    ]);
  });

  it("follows a segment into the lane it is drawn in", () => {
    const drawn = [
      p(2, 1),
      p(3.25, 1),
      p(3.25, 5.25),
      p(7, 5.25),
      p(7, 1),
      p(8, 1),
    ];

    const guides = segmentGuides({ route: detour, drawn });

    assert.deepStrictEqual(guides[1], {
      from: p(3.25, 1),
      to: p(3.25, 5.25),
      axis: "y",
    });
    assert.deepStrictEqual(guides[2], {
      from: p(3.25, 5.25),
      to: p(7, 5.25),
      axis: "x",
    });
  });

  it("falls back to the route's own segment when nothing is drawn near it", () => {
    const guides = segmentGuides({ route: detour, drawn: [p(2, 1), p(8, 1)] });

    assert.deepStrictEqual(guides[2], {
      from: p(3, 5),
      to: p(7, 5),
      axis: "x",
    });
  });

  it("returns nothing for a route with no segments", () => {
    assert.deepStrictEqual(segmentGuides({ route: [p(2, 1)], drawn: [] }), []);
  });
});
