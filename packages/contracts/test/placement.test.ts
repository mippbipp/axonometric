import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect, Record as Rec, String as Str } from "effect";

import {
  boxOutline,
  checkLayout,
  footprintsOverlap,
  placeStructures,
  tagCovers,
  zoneGap,
  zonePadding,
} from "../src/index.ts";
import type {
  Hop,
  Layout,
  MapData,
  Placement,
  ScreenPoint,
  Shape,
  Structure,
} from "../src/index.ts";

const structure = (id: string, group = "main", name = id): Structure => ({
  id,
  code: "S",
  name,
  shape: "box",
  group,
  status: "live",
  oneLiner: "One line.",
  whatItDoes: "Does.",
  howItsBuilt: "Built.",
});

const hop = (from: string, to: string): Hop => ({
  id: `${from}-${to}`,
  from,
  to,
  label: "calls",
});

const mapOf = (
  structures: readonly Structure[],
  hops: readonly Hop[] = []
): MapData => ({
  format: 1,
  revision: 0,
  overview: { title: "Map", summary: "A map." },
  groups: Arr.map(Arr.dedupe(Arr.map(structures, (s) => s.group)), (id) => ({
    id,
    title: id,
  })),
  structures,
  hops,
  flows: [],
  chapters: [],
});

const layoutOf = (
  structures: Readonly<Record<string, Placement>> = {}
): Layout => ({ format: 1, revision: 3, structures });

const at = (x: number, y: number): Placement => ({ x, y, w: 2, d: 2 });

const sized = (placement: Placement): Placement => placement;

/** The placement of `id`, failing the test when it has none. */
const placementOf = (layout: Layout, id: string): Placement => {
  const placement = layout.structures[id];

  assert.isDefined(placement, `${id} has no placement`);

  return placement;
};

/** The highest screen point of an outline. Screen y grows downwards. */
const topOf = (outline: readonly ScreenPoint[]) =>
  Math.min(...Arr.map(outline, (point) => point.sy));

const grow = (box: Placement, by: number): Placement => ({
  x: box.x - by,
  y: box.y - by,
  w: box.w + 2 * by,
  d: box.d + 2 * by,
});

const centre = (placement: Placement) => ({
  x: placement.x + placement.w / 2,
  y: placement.y + placement.d / 2,
});

const gap = (a: Placement, b: Placement) =>
  Math.abs(centre(a).x - centre(b).x) + Math.abs(centre(a).y - centre(b).y);

const zoneOf = (layout: Layout, ids: readonly string[]) => {
  const boxes = Arr.map(ids, (id) => placementOf(layout, id));

  const left = Math.min(...Arr.map(boxes, (box) => box.x));
  const top = Math.min(...Arr.map(boxes, (box) => box.y));

  return {
    x: left,
    y: top,
    w: Math.max(...Arr.map(boxes, (box) => box.x + box.w)) - left,
    d: Math.max(...Arr.map(boxes, (box) => box.y + box.d)) - top,
  };
};

/** The ids of `data`'s structures in `group`. */
const idsIn = (data: MapData, group: string) =>
  Arr.map(
    Arr.filter(data.structures, (s) => s.group === group),
    (s) => s.id
  );

/** Three groups of four, with hops inside groups and one between groups. */
const crowded = mapOf(
  [
    ...Arr.map(["a1", "a2", "a3", "a4"], (id) => structure(id, "a")),
    ...Arr.map(["b1", "b2", "b3", "b4"], (id) => structure(id, "b")),
    ...Arr.map(["c1", "c2", "c3", "c4"], (id) =>
      structure(id, "c", `A long service name ${id}`)
    ),
  ],
  [hop("a1", "a2"), hop("a2", "b1"), hop("b1", "b2"), hop("c1", "a4")]
);

const assertTidy = (data: MapData, layout: Layout) => {
  const placements = Rec.toEntries(layout.structures);

  for (const [id, placement] of placements) {
    for (const value of [placement.x, placement.y, placement.w, placement.d]) {
      assert.isTrue(Number.isInteger(value * 2), `${id} is off the half grid`);
    }
  }

  assert.deepStrictEqual(
    checkLayout(data, layout),
    [],
    "placement left layout warnings"
  );
};

describe("placement", () => {
  it.effect(
    "places every structure of an empty layout on half units, clear of each other",
    () =>
      Effect.sync(() => {
        const { layout, placed, pruned } = placeStructures(crowded, layoutOf());

        assert.deepStrictEqual(
          Rec.keys(layout.structures),
          Arr.map(crowded.structures, ({ id }) => id)
        );
        assert.strictEqual(placed.length, 12);
        assert.deepStrictEqual(pruned, []);
        assertTidy(crowded, layout);
      })
  );

  it.effect("gives the same layout for the same input", () =>
    Effect.sync(() => {
      assert.deepStrictEqual(
        placeStructures(crowded, layoutOf()),
        placeStructures(crowded, layoutOf())
      );
    })
  );

  it.effect("never moves a placed structure, and keeps the revision", () =>
    Effect.sync(() => {
      const fixed = {
        a1: sized({ x: 10, y: 10, w: 3, d: 2.5 }),
        b2: at(-6.5, 0),
      };

      const { layout, placed } = placeStructures(crowded, layoutOf(fixed));

      assert.deepStrictEqual(layout.structures.a1, fixed.a1);
      assert.deepStrictEqual(layout.structures.b2, fixed.b2);
      assert.strictEqual(layout.revision, 3);
      assert.notInclude(placed, "a1");
      assertTidy(crowded, layout);
    })
  );

  it.effect("keeps each group's zone clear of the others", () =>
    Effect.sync(() => {
      const { layout } = placeStructures(crowded, layoutOf());

      const zones = Arr.map(["a", "b", "c"], (group) =>
        zoneOf(
          layout,
          Arr.map(
            Arr.filter(crowded.structures, (s) => s.group === group),
            (s) => s.id
          )
        )
      );

      for (const [index, zone] of zones.entries()) {
        for (const other of zones.slice(index + 1)) {
          assert.isFalse(footprintsOverlap(zone, other));
        }
      }
    })
  );

  it.effect(
    "puts a new structure next to its group, not beside another group",
    () =>
      Effect.sync(() => {
        const data = mapOf([
          structure("a1", "a"),
          structure("a2", "a"),
          structure("b1", "b"),
          structure("a3", "a"),
        ]);

        const { layout } = placeStructures(
          data,
          layoutOf({ a1: at(0, 0), a2: at(4, 0), b1: at(20, 0) })
        );

        const added = placementOf(layout, "a3");

        assert.isBelow(gap(added, at(4, 0)), gap(added, at(20, 0)));
        assert.isAtMost(gap(added, zoneOf(layout, ["a1", "a2"])), 6);
      })
  );

  it.effect(
    "puts a new structure near the structures its hops connect to",
    () =>
      Effect.sync(() => {
        const data = mapOf(
          [
            structure("left"),
            structure("middle"),
            structure("right"),
            structure("new"),
          ],
          [hop("new", "right")]
        );

        const { layout } = placeStructures(
          data,
          layoutOf({ left: at(0, 0), middle: at(4, 0), right: at(8, 0) })
        );

        const added = placementOf(layout, "new");

        assert.isBelow(gap(added, at(8, 0)), gap(added, at(0, 0)));
      })
  );

  it.effect(
    "lays a group of four or more out in more than one row and column",
    () =>
      Effect.sync(() => {
        const { layout } = placeStructures(crowded, layoutOf());
        const members = ["b1", "b2", "b3", "b4"];
        const spots = Arr.map(members, (id) => placementOf(layout, id));
        const xs = Arr.dedupe(Arr.map(spots, (spot) => spot.x));
        const ys = Arr.dedupe(Arr.map(spots, (spot) => spot.y));

        assert.isAbove(xs.length, 1);
        assert.isAbove(ys.length, 1);
      })
  );

  it.effect("puts groups side by side in rows and columns", () =>
    Effect.sync(() => {
      const { layout } = placeStructures(crowded, layoutOf());

      const zones = Arr.map(["a", "b", "c"], (group) =>
        zoneOf(layout, idsIn(crowded, group))
      );

      const lefts = Arr.dedupe(Arr.map(zones, (zone) => zone.x));
      const tops = Arr.dedupe(Arr.map(zones, (zone) => zone.y));

      assert.isAbove(lefts.length, 1);
      assert.isAbove(tops.length, 1);
    })
  );

  it.effect("keeps structures joined by a hop next to each other", () =>
    Effect.sync(() => {
      const data = mapOf(
        Arr.map(["a", "b", "c", "d", "e", "f", "g", "h", "i"], (id) =>
          structure(id)
        ),
        [hop("a", "i")]
      );

      const { layout } = placeStructures(data, layoutOf());
      const a = placementOf(layout, "a");
      const i = placementOf(layout, "i");

      assert.isAtMost(gap(a, i), gap(a, placementOf(layout, "h")));
    })
  );

  it.effect("keeps each zone's padding clear of other groups' structures", () =>
    Effect.sync(() => {
      const { layout } = placeStructures(crowded, layoutOf());

      for (const group of ["a", "b", "c"]) {
        const zone = grow(
          zoneOf(layout, idsIn(crowded, group)),
          zonePadding + zoneGap / 2
        );

        const others = Arr.filter(crowded.structures, (s) => s.group !== group);

        for (const other of others) {
          const footprint = grow(placementOf(layout, other.id), zoneGap / 2);

          assert.isFalse(
            footprintsOverlap(zone, footprint),
            `${other.id} is inside ${group}'s zone`
          );
        }
      }
    })
  );

  it.effect("starts a new group's zone next to everything already placed", () =>
    Effect.sync(() => {
      const data = mapOf([structure("a1", "a"), structure("b1", "b")]);
      const { layout } = placeStructures(data, layoutOf({ a1: at(0, 0) }));

      assert.deepStrictEqual(layout.structures.b1, at(6, 0));
    })
  );

  it.effect("drops entries for structures that no longer exist", () =>
    Effect.sync(() => {
      const data = mapOf([structure("kept")]);

      const { layout, pruned } = placeStructures(
        data,
        layoutOf({ kept: at(0, 0), gone: at(4, 0) })
      );

      assert.deepStrictEqual(pruned, ["gone"]);
      assert.deepStrictEqual(layout.structures, { kept: at(0, 0) });
    })
  );

  it.effect(
    "puts a structure whose only hop leaves its group on the side facing that group",
    () =>
      Effect.sync(() => {
        const data = mapOf(
          Arr.flatMap(["a", "b", "c", "d"], (group) =>
            Arr.map([1, 2, 3, 4], (n) => structure(`${group}${n}`, group))
          ),
          [hop("a4", "b1"), hop("c1", "d1"), hop("a1", "a2")]
        );

        const { layout } = placeStructures(data, layoutOf());
        const own = zoneOf(layout, idsIn(data, "a"));
        const other = zoneOf(layout, idsIn(data, "b"));
        const spot = centre(placementOf(layout, "a4"));

        const middle = centre(own);
        const right = other.x >= own.x + own.w;
        const left = other.x + other.w <= own.x;
        const below = other.y >= own.y + own.d;
        const above = other.y + other.d <= own.y;

        assert.isTrue(right || left || below || above, "zones overlap");

        if (right) {
          assert.isAbove(spot.x, middle.x);
        }

        if (left) {
          assert.isBelow(spot.x, middle.x);
        }

        if (below) {
          assert.isAbove(spot.y, middle.y);
        }

        if (above) {
          assert.isBelow(spot.y, middle.y);
        }
      })
  );

  it.effect(
    "puts two heavily connected groups next to each other, whatever their order in groups",
    () =>
      Effect.sync(() => {
        const data = mapOf(
          Arr.flatMap(["a", "b", "c", "d"], (group) =>
            Arr.map([1, 2, 3, 4], (n) => structure(`${group}${n}`, group))
          ),
          [hop("a1", "d1"), hop("a2", "d2"), hop("d3", "a3"), hop("b1", "c1")]
        );

        const { layout } = placeStructures(data, layoutOf());
        const a = zoneOf(layout, idsIn(data, "a"));
        const d = zoneOf(layout, idsIn(data, "d"));

        const sameColumn = a.x < d.x + d.w && d.x < a.x + a.w;
        const sameRow = a.y < d.y + d.d && d.y < a.y + a.d;

        assert.isTrue(sameColumn || sameRow, "a and d sit diagonally apart");
        assertTidy(data, layout);
      })
  );

  it.effect("works around a hand-placed structure in the way", () =>
    Effect.sync(() => {
      const data = mapOf([structure("a"), structure("b"), structure("c")]);

      const { layout } = placeStructures(
        data,
        layoutOf({ a: at(0, 0), b: sized({ x: 3.5, y: -0.5, w: 3, d: 3 }) })
      );

      assertTidy(data, layout);
    })
  );
});

describe("layout checks", () => {
  it.effect("is quiet for a tidy layout and for unplaced structures", () =>
    Effect.sync(() => {
      const data = mapOf([structure("a"), structure("b"), structure("c")]);

      const layout = layoutOf({ a: at(0, 0), b: at(4, 0) });

      assert.deepStrictEqual(checkLayout(data, layout), []);
    })
  );

  it.effect("warns about an entry for a structure that no longer exists", () =>
    Effect.sync(() => {
      const problems = checkLayout(
        mapOf([structure("a")]),
        layoutOf({ a: at(0, 0), gone: at(4, 0) })
      );

      assert.deepStrictEqual(
        Arr.map(problems, ({ severity, file, path }) => ({
          severity,
          file,
          path,
        })),
        [{ severity: "warning", file: "layout.json", path: "structures.gone" }]
      );
      assert.include(
        Arr.join(
          Arr.map(problems, ({ message }) => message),
          "\n"
        ),
        "build removes this entry"
      );
    })
  );

  it.effect(
    "warns once about two overlapping footprints, naming the other",
    () =>
      Effect.sync(() => {
        const problems = checkLayout(
          mapOf([structure("a"), structure("b")]),
          layoutOf({ a: sized({ x: 0, y: 0, w: 4, d: 4 }), b: at(3, 3) })
        );

        const overlaps = Arr.filter(problems, ({ message }) =>
          Str.includes("overlaps")(message)
        );

        assert.deepStrictEqual(
          Arr.map(overlaps, ({ path, message }) => ({ path, message })),
          [
            {
              path: "structures.b",
              message:
                'footprint overlaps "a". Move one of them, for example with axonometric layout <home> b --x <x> --y <y>.',
            },
          ]
        );
      })
  );

  it.effect(
    "doesn't count footprints that only share an edge as overlapping",
    () =>
      Effect.sync(() => {
        assert.isFalse(footprintsOverlap(at(0, 0), at(2, 0)));
        assert.isTrue(footprintsOverlap(at(0, 0), at(1.5, 1.5)));
      })
  );

  it.effect("warns when a name tag is drawn on another box", () =>
    Effect.sync(() => {
      // b sits right in front of a's front corner, where a's tag hangs.
      const data = mapOf([structure("a"), structure("b")]);

      const problems = checkLayout(
        data,
        layoutOf({ a: at(0, 0), b: at(2, 2) })
      );

      assert.deepStrictEqual(
        Arr.map(problems, ({ path, message }) => ({ path, message })),
        [
          {
            path: "structures.a",
            message:
              'name tag is drawn on top of "b". Move one of them apart, so the tag under the front corner has room.',
          },
        ]
      );
    })
  );

  it.effect(
    "measures a name tag from its text, so a long name reaches further",
    () =>
      Effect.sync(() => {
        const short = {
          structure: structure("a", "main", "A"),
          placement: at(0, 0),
        };

        const long = {
          structure: structure(
            "a",
            "main",
            "A very long structure name indeed"
          ),
          placement: at(0, 0),
        };

        // Two units along x puts the box up and to the right of a's front corner.
        const beside = { structure: structure("b"), placement: at(2, 0) };

        assert.isFalse(tagCovers(short, beside));
        assert.isTrue(tagCovers(long, beside));
      })
  );

  it.effect("draws a tall shape's outline higher than a slab's", () =>
    Effect.sync(() => {
      const tall = topOf(boxOutline(at(0, 0), "tall"));
      const slab = topOf(boxOutline(at(0, 0), "slab"));

      assert.isBelow(tall, slab);
    })
  );

  it.effect("checks a name tag against the height of the box behind it", () =>
    Effect.sync(() => {
      // a's tag hangs below its front corner. A box two units further back
      // along both axes only reaches the tag when it's tall.
      const tagged = { structure: structure("a"), placement: at(0, 0) };

      const behind = (shape: Shape) => ({
        structure: { ...structure("b"), shape },
        placement: at(4, 4),
      });

      assert.isTrue(tagCovers(tagged, behind("tall")));
      assert.isFalse(tagCovers(tagged, behind("slab")));
    })
  );

  it.effect("sizes a name tag from the tag label when there is one", () =>
    Effect.sync(() => {
      const tagged = {
        structure: {
          ...structure("a", "main", "A very long structure name indeed"),
          tag: "A",
        },
        placement: at(0, 0),
      };

      const beside = { structure: structure("b"), placement: at(2, 0) };

      assert.isFalse(tagCovers(tagged, beside));
    })
  );
});
