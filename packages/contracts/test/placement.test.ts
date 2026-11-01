import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect, Record as Rec, String as Str } from "effect";

import {
  checkLayout,
  footprintsOverlap,
  placeStructures,
  tagCovers,
} from "../src/index.ts";
import type {
  Hop,
  Layout,
  MapData,
  Placement,
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
});
