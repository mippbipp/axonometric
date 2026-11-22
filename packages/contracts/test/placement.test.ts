import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect, Record as Rec, String as Str } from "effect";

import {
  footprintsOverlap,
  placeStructures,
  sceneOf,
  spanOf,
} from "../src/index.ts";
import type {
  Hop,
  Layout,
  MapData,
  Placement,
  ScreenPoint,
  Structure,
} from "../src/index.ts";
import { placeStructuresWith } from "../src/placement.ts";
import { placedFixture } from "./fixture-maps.ts";
import { grow, placementOf } from "./footprints.ts";
import { layoutProblems } from "./layout-problems.ts";

/** What `check` says of a hop whose Plan label has no spot in a chapter. */
const hiddenLabel = (id: string, chapter: string) =>
  `the label of hop "${id}" has no clear spot beside its route in chapter "${chapter}" in Plan view, so the drawing leaves it out and it shows only on hover. Move the structures it passes apart, or shorten the label.`;

const structure = (id: string, group = "main", name = id): Structure => ({
  code: "S",
  group,
  howItsBuilt: "Built.",
  id,
  name,
  oneLiner: "One line.",
  shape: "box",
  status: "live",
  whatItDoes: "Does.",
});

const hop = (from: string, to: string): Hop => ({
  from,
  id: `${from}-${to}`,
  label: "calls",
  to,
});

const mapOf = (
  structures: ReadonlyArray<Structure>,
  hops: ReadonlyArray<Hop> = []
): MapData => ({
  chapters: [],
  flows: [],
  format: 1,
  groups: Arr.map(Arr.dedupe(Arr.map(structures, (s) => s.group)), (id) => ({
    id,
    title: id,
  })),
  hops,
  overview: { summary: "A map.", title: "Map" },
  revision: 0,
  structures,
});

const layoutOf = (
  structures: Readonly<Record<string, Placement>> = {}
): Layout => ({ format: 1, revision: 3, structures });

const at = (x: number, y: number): Placement => ({ d: 2, w: 2, x, y });

const sized = (placement: Placement): Placement => placement;

/** The highest screen point of an outline. Screen y grows downwards. */
const topOf = (outline: ReadonlyArray<ScreenPoint>) =>
  Math.min(...Arr.map(outline, (point) => point.sy));

/** The highest screen point of `shape`'s outline at 0, 0 in the Iso view. */
const outlineTop = (shape: Structure["shape"]) => {
  const scene = sceneOf({
    data: mapOf([{ ...structure("a"), shape }]),
    layout: layoutOf({ a: at(0, 0) }),
    revealed: new Set(["a"]),
  });

  return topOf(Arr.flatMap(scene.structures, ({ outline }) => outline));
};

const centre = (placement: Placement) => ({
  x: placement.x + placement.w / 2,
  y: placement.y + placement.d / 2,
});

const gap = (a: Placement, b: Placement) =>
  Math.abs(centre(a).x - centre(b).x) + Math.abs(centre(a).y - centre(b).y);

const zoneOf = (layout: Layout, ids: ReadonlyArray<string>) => {
  const boxes = Arr.map(ids, (id) => placementOf(layout, id));

  const left = Math.min(...Arr.map(boxes, (box) => box.x));
  const top = Math.min(...Arr.map(boxes, (box) => box.y));

  return {
    d: Math.max(...Arr.map(boxes, (box) => box.y + box.d)) - top,
    w: Math.max(...Arr.map(boxes, (box) => box.x + box.w)) - left,
    x: left,
    y: top,
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

/**
 * Groups a, b, c and d, listed in that order, with structures a1, a2 and so
 * on up to `size` in each, and `hops` between them.
 */
const fourGroupsOf = (size: number, hops: ReadonlyArray<Hop>) =>
  mapOf(
    Arr.flatMap(["a", "b", "c", "d"], (group) =>
      Arr.map(Arr.range(1, size), (n) => structure(`${group}${n}`, group))
    ),
    hops
  );

/**
 * Seven groups of four linked in a chain, with a few hops across it, and a
 * two-member group "pair" whose members each have a hop to the same-numbered
 * structure of `target`. `extra` adds hops.
 */
const chainWithPair = (target: string, extra: ReadonlyArray<Hop> = []) => {
  const names = ["a", "b", "c", "d", "e", "f", "g"];

  return mapOf(
    [
      ...Arr.flatMap(names, (group) =>
        Arr.map(Arr.range(0, 3), (n) => structure(`${group}${n}`, group))
      ),
      structure("p0", "pair"),
      structure("p1", "pair"),
    ],
    [
      ...Arr.flatMap(names, (group) =>
        Arr.map(Arr.range(0, 2), (n) => hop(`${group}${n}`, `${group}${n + 1}`))
      ),
      ...Arr.map(Arr.drop(names, 1), (group, index) =>
        hop(`${names[index]}3`, `${group}0`)
      ),
      hop("a1", "d2"),
      hop("b2", "f1"),
      hop("c1", "g3"),
      hop("p0", `${target}0`),
      hop("p1", `${target}1`),
      ...extra,
    ]
  );
};

/** The gap between two zones' bounding boxes on the ground. */
const zoneGap = (a: Placement, b: Placement) =>
  Math.hypot(
    Math.max(0, b.x - (a.x + a.w), a.x - (b.x + b.w)),
    Math.max(0, b.y - (a.y + a.d), a.y - (b.y + b.d))
  );

/** Asserts that no other group's zone is nearer `group`'s than `target`'s. */
const assertNextTo = (
  { data, layout }: { readonly data: MapData; readonly layout: Layout },
  group: string,
  target: string
) => {
  const own = zoneOf(layout, idsIn(data, group));
  const near = zoneGap(own, zoneOf(layout, idsIn(data, target)));

  for (const { id } of data.groups) {
    const other = zoneOf(layout, idsIn(data, id));

    if (id !== group) {
      assert.isAtMost(
        near,
        zoneGap(own, other),
        `${group} is nearer ${id} than ${target}`
      );
    }
  }
};

const assertTidy = (data: MapData, layout: Layout) => {
  const placements = Rec.toEntries(layout.structures);

  for (const [id, placement] of placements) {
    for (const value of [placement.x, placement.y, placement.w, placement.d]) {
      assert.isTrue(Number.isInteger(value * 2), `${id} is off the half grid`);
    }
  }

  assert.deepStrictEqual(
    layoutProblems(data, layout),
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

  it.effect("gives the update pipeline the same layout each time", () =>
    Effect.gen(function* () {
      const first = yield* placedFixture("update-pipeline");
      const second = yield* placedFixture("update-pipeline");

      assert.deepStrictEqual(first.layout, second.layout);
    })
  );

  it.effect("places 40 one-member groups with bounded work", () =>
    Effect.sync(() => {
      const ids = Arr.map(Arr.range(0, 39), (index) => `s${index}`);

      const data = mapOf(
        Arr.map(ids, (id) => structure(id, `g-${id}`)),
        Arr.map(Arr.range(0, 59), (index) => ({
          ...hop(`s${(index * 7) % 40}`, `s${(index * 13 + 5) % 40}`),
          id: `h${index}`,
        }))
      );

      const work = { drawing: 0, slot: 0 };
      const { layout } = placeStructuresWith(data, layoutOf(), (kind) => {
        work[kind] += 1;
      });

      // Measured 11985 slot tests and no drawings, since a drawing budget of
      // 12 shared by 40 groups leaves each none. The slot ceiling is about 1.7
      // times the measured count, so a search twice as wide fails it. The
      // drawing ceiling is the budget itself.
      assert.isAtMost(work.slot, 20_000);
      assert.isAtMost(work.drawing, 12);
      assert.lengthOf(Rec.keys(layout.structures), 40);
    })
  );

  it.effect(
    "puts a two-member group next to the zone it shares the most hops with",
    () =>
      Effect.sync(() => {
        for (const target of ["a", "b", "e", "g"]) {
          const data = chainWithPair(target);
          const { layout } = placeStructures(data, layoutOf());

          assertNextTo({ data, layout }, "pair", target);
          assertTidy(data, layout);
        }
      })
  );

  it.effect(
    "puts a two-member group next to the first of two zones with as many hops",
    () =>
      Effect.sync(() => {
        const data = chainWithPair("b", [hop("p0", "e0"), hop("p1", "e1")]);

        const { layout } = placeStructures(data, layoutOf());

        assertNextTo({ data, layout }, "pair", "b");
        assertTidy(data, layout);
      })
  );

  it.effect(
    "puts each member of a two-member group on the side facing its hop neighbours",
    () =>
      Effect.sync(() => {
        const data = fourGroupsOf(4, [
          hop("a1", "a2"),
          hop("b1", "b2"),
          hop("c1", "c2"),
          hop("a4", "b1"),
          hop("b4", "c1"),
        ]);

        const pair = mapOf(
          [
            ...data.structures,
            structure("p0", "pair"),
            structure("p1", "pair"),
          ],
          [...data.hops, hop("p1", "d1"), hop("p1", "d2"), hop("p0", "p1")]
        );

        const { layout } = placeStructures(pair, layoutOf());
        const target = zoneOf(layout, idsIn(pair, "d"));

        assertNextTo({ data: pair, layout }, "pair", "d");
        assert.isBelow(
          gap(placementOf(layout, "p1"), target),
          gap(placementOf(layout, "p0"), target)
        );
        assertTidy(pair, layout);
      })
  );

  it.effect("gives the same layout for the same two-member maps", () =>
    Effect.sync(() => {
      const maps = [
        chainWithPair("b"),
        chainWithPair("b", [hop("p0", "e0"), hop("p1", "e1")]),
      ];

      for (const data of maps) {
        assert.deepStrictEqual(
          placeStructures(data, layoutOf()),
          placeStructures(data, layoutOf())
        );
      }
    })
  );

  it.effect(
    "places 40 structures in 20 two-member groups with bounded work",
    () =>
      Effect.sync(() => {
        const data = mapOf(
          Arr.map(Arr.range(0, 39), (index) =>
            structure(`s${index}`, `g${Math.floor(index / 2)}`)
          ),
          Arr.map(Arr.range(0, 59), (index) => ({
            ...hop(`s${(index * 7) % 40}`, `s${(index * 13 + 5) % 40}`),
            id: `h${index}`,
          }))
        );

        const work = { drawing: 0, slot: 0 };
        const { layout } = placeStructuresWith(data, layoutOf(), (kind) => {
          work[kind] += 1;
        });

        // Measured 80 slot tests and no drawings, as the pass tests only the
        // first spots of its ranking. The ceilings are those of the 40
        // one-member groups test above.
        assert.isAtMost(work.slot, 20_000);
        assert.isAtMost(work.drawing, 12);
        assert.lengthOf(Rec.keys(layout.structures), 40);
      })
  );

  it.effect(
    "places flake-pipeline's two-member zone next to repo, from an empty layout",
    () =>
      Effect.gen(function* () {
        const { data, layout } = yield* placedFixture("flake-pipeline");

        assertNextTo({ data, layout }, "outside", "repo");
        assert.deepStrictEqual(layoutProblems(data, layout), []);
      })
  );

  it.effect(
    "gives the update pipeline only these layout warnings, placed by build",
    () =>
      Effect.gen(function* () {
        const { data, layout } = yield* placedFixture("update-pipeline");

        // Earlier chapters show h-merge faded, with no label to warn about.
        // The last chapter plays nothing, so it labels every hop.
        assert.deepStrictEqual(
          Arr.map(layoutProblems(data, layout), ({ message }) => message),
          [hiddenLabel("h-merge", "c-whole")]
        );
      })
  );

  it.effect("never moves a placed structure, and keeps the revision", () =>
    Effect.sync(() => {
      const fixed = {
        a1: sized({ d: 2.5, w: 3, x: 10, y: 10 }),
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

      // A zone reaches 1 unit past its members, and 2 units of clear ground
      // run between zones: 1 from each side.
      for (const group of ["a", "b", "c"]) {
        const zone = grow(zoneOf(layout, idsIn(crowded, group)), 2);

        const others = Arr.filter(crowded.structures, (s) => s.group !== group);

        for (const other of others) {
          const footprint = grow(placementOf(layout, other.id), 1);

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
      const b1 = placementOf(layout, "b1");

      // Two zones, each 1 unit past its member, with 2 units between them,
      // leave at least 4 units between the footprints. Next to means no more
      // than one more structure's width beyond that.
      const apart = Math.max(
        b1.x - 2,
        -(b1.x + b1.w),
        b1.y - 2,
        -(b1.y + b1.d)
      );

      assert.isAtLeast(apart, 4);
      assert.isAtMost(apart, 6);
    })
  );

  it.effect("drops entries for structures that no longer exist", () =>
    Effect.sync(() => {
      const data = mapOf([structure("kept")]);

      const { layout, pruned } = placeStructures(
        data,
        layoutOf({ gone: at(4, 0), kept: at(0, 0) })
      );

      assert.deepStrictEqual(pruned, ["gone"]);
      assert.deepStrictEqual(layout.structures, { kept: at(0, 0) });
    })
  );

  it.effect(
    "puts a structure whose only hop leaves its group on the side facing that group",
    () =>
      Effect.sync(() => {
        const data = fourGroupsOf(4, [
          hop("a4", "b1"),
          hop("c1", "d1"),
          hop("a1", "a2"),
        ]);

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

        assertTidy(data, layout);
      })
  );

  it.effect(
    "puts the two most connected groups side by side when groups lists them first and last",
    () =>
      Effect.sync(() => {
        const data = fourGroupsOf(4, [
          hop("a1", "d1"),
          hop("a2", "d2"),
          hop("d3", "a3"),
          hop("b1", "c1"),
        ]);

        const { layout } = placeStructures(data, layoutOf());
        const a = zoneOf(layout, idsIn(data, "a"));
        const d = zoneOf(layout, idsIn(data, "d"));

        const sameColumn = a.x < d.x + d.w && d.x < a.x + a.w;
        const sameRow = a.y < d.y + d.d && d.y < a.y + a.d;

        assert.isTrue(sameColumn || sameRow, "a and d sit diagonally apart");
        assertTidy(data, layout);
      })
  );

  it.effect(
    "puts hop-linked structures of neighbouring groups on a shared row or column",
    () =>
      Effect.sync(() => {
        const data = fourGroupsOf(2, [hop("b2", "a1"), hop("a1", "b1")]);

        const { layout } = placeStructures(data, layoutOf());
        const a1 = placementOf(layout, "a1");

        for (const id of ["b1", "b2"]) {
          const other = placementOf(layout, id);

          assert.isTrue(
            centre(a1).x === centre(other).x ||
              centre(a1).y === centre(other).y,
            `a1 and ${id} sit diagonally apart`
          );
        }
      })
  );

  it.effect("works around a hand-placed structure in the way", () =>
    Effect.sync(() => {
      const data = mapOf([structure("a"), structure("b"), structure("c")]);

      const { layout } = placeStructures(
        data,
        layoutOf({ a: at(0, 0), b: sized({ d: 3, w: 3, x: 3.5, y: -0.5 }) })
      );

      assertTidy(data, layout);
    })
  );

  it.effect(
    "puts a structure whose only hops go to the other of two zones on the side facing it",
    () =>
      Effect.sync(() => {
        // a5 is listed last, so a block in data.mjs order puts it on the
        // far side of a's block from b.
        const data = mapOf(
          [
            ...Arr.map(["a1", "a2", "a3", "a4", "a5"], (id) =>
              structure(id, "a")
            ),
            ...Arr.map(["b1", "b2"], (id) => structure(id, "b")),
          ],
          [
            hop("a1", "a2"),
            hop("a2", "a3"),
            hop("a3", "a4"),
            hop("a5", "b1"),
            hop("b1", "a5"),
            hop("b2", "a5"),
          ]
        );

        const { layout } = placeStructures(data, layoutOf());
        const own = zoneOf(layout, idsIn(data, "a"));
        const other = zoneOf(layout, idsIn(data, "b"));
        const spot = placementOf(layout, "a5");

        // The side facing b is the row or column of a's zone nearest it.
        const facing = Arr.filter(
          [
            other.x >= own.x + own.w && spot.x + spot.w === own.x + own.w,
            other.x + other.w <= own.x && spot.x === own.x,
            other.y >= own.y + own.d && spot.y + spot.d === own.y + own.d,
            other.y + other.d <= own.y && spot.y === own.y,
          ],
          Boolean
        );

        assert.isNotEmpty(facing, "a5 isn't on the side of a facing b");
        assertTidy(data, layout);
      })
  );

  it.effect(
    "puts a one-member group next to the zone it has the most hops with",
    () =>
      Effect.sync(() => {
        // lone has one hop to a and three to d, which groups lists last.
        const data = mapOf(
          [
            ...Arr.map(["a1", "a2", "a3"], (id) => structure(id, "a")),
            ...Arr.map(["b1", "b2", "b3"], (id) => structure(id, "b")),
            ...Arr.map(["c1", "c2", "c3"], (id) => structure(id, "c")),
            structure("lone", "l"),
            ...Arr.map(["d1", "d2", "d3"], (id) => structure(id, "d")),
          ],
          [
            hop("a1", "b1"),
            hop("b2", "c1"),
            hop("c2", "d1"),
            hop("lone", "a3"),
            hop("lone", "d1"),
            hop("d2", "lone"),
            hop("d3", "lone"),
          ]
        );

        const { layout } = placeStructures(data, layoutOf());
        const lone = placementOf(layout, "lone");
        const busiest = zoneOf(layout, idsIn(data, "d"));

        // Next to: no other zone nearer, and no structure of another group
        // in the ground between the two.
        const zones = Arr.map(["a", "b", "c", "d"], (group) => ({
          gap: gap(lone, zoneOf(layout, idsIn(data, group))),
          group,
        }));

        const nearest = Arr.reduce(zones, zones[0], (best, zone) =>
          best === undefined || zone.gap < best.gap ? zone : best
        );

        assert.strictEqual(nearest?.group, "d");

        const between = spanOf(lone, busiest);

        for (const other of data.structures) {
          if (other.group !== "d" && other.id !== "lone") {
            assert.isFalse(
              footprintsOverlap(between, placementOf(layout, other.id)),
              `${other.id} sits between lone and d`
            );
          }
        }

        assertTidy(data, layout);
      })
  );

  it.effect(
    "counts every hop to a structure, when a one-member group picks its side",
    () =>
      Effect.sync(() => {
        // lone has three hops to d1 and one each to a2 and a3, so d is the
        // zone it has the most hops with, though a has more structures.
        const data = mapOf(
          [
            ...Arr.map(["a1", "a2", "a3"], (id) => structure(id, "a")),
            structure("lone", "l"),
            ...Arr.map(["d1", "d2", "d3"], (id) => structure(id, "d")),
          ],
          [
            hop("a1", "a2"),
            hop("a2", "a3"),
            hop("d1", "d2"),
            hop("d2", "d3"),
            hop("a3", "d3"),
            hop("lone", "a2"),
            hop("lone", "a3"),
            hop("lone", "d1"),
            { ...hop("d1", "lone"), id: "d1-lone-reply" },
            { ...hop("lone", "d1"), id: "lone-d1-retry" },
          ]
        );

        const { layout } = placeStructures(data, layoutOf());
        const lone = placementOf(layout, "lone");
        const busiest = zoneOf(layout, idsIn(data, "d"));
        const biggest = zoneOf(layout, idsIn(data, "a"));

        assert.isBelow(gap(lone, busiest), gap(lone, biggest));

        assertTidy(data, layout);
      })
  );
});

describe("layout checks", () => {
  it.effect("is quiet for a tidy layout and for unplaced structures", () =>
    Effect.sync(() => {
      const data = mapOf([structure("a"), structure("b"), structure("c")]);

      const layout = layoutOf({ a: at(0, 0), b: at(4, 0) });

      assert.deepStrictEqual(layoutProblems(data, layout), []);
    })
  );

  it.effect("warns about an entry for a structure that no longer exists", () =>
    Effect.sync(() => {
      const problems = layoutProblems(
        mapOf([structure("a")]),
        layoutOf({ a: at(0, 0), gone: at(4, 0) })
      );

      assert.deepStrictEqual(
        Arr.map(problems, ({ file, path, severity }) => ({
          file,
          path,
          severity,
        })),
        [{ file: "layout.json", path: "structures.gone", severity: "warning" }]
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
        const problems = layoutProblems(
          mapOf([structure("a"), structure("b")]),
          layoutOf({ a: sized({ d: 4, w: 4, x: 0, y: 0 }), b: at(3, 3) })
        );

        const overlaps = Arr.filter(problems, ({ message }) =>
          Str.includes("overlaps")(message)
        );

        assert.deepStrictEqual(
          Arr.map(overlaps, ({ hint, message, path }) => ({
            hint,
            message,
            path,
          })),
          [
            {
              hint: "Move one of them, for example with axonometric layout <home> b --x <x> --y <y>.",
              message: 'footprint overlaps "a".',
              path: "structures.b",
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

      const problems = layoutProblems(
        data,
        layoutOf({ a: at(0, 0), b: at(2, 2) })
      );

      assert.deepStrictEqual(
        Arr.map(problems, ({ message, path }) => ({ message, path })),
        [
          {
            message:
              'name tag is drawn on top of "b". Move one of them apart, so the tag under the front corner has room.',
            path: "structures.a",
          },
        ]
      );
    })
  );

  it.effect(
    "measures a name tag from its text or tag label, and the box behind it by its height",
    () =>
      Effect.sync(() => {
        const longName = "A very long structure name indeed";

        // Two units along x puts b up and to the right of a's front corner.
        // Four units back along both axes, b only reaches a's tag when tall.
        const cases = [
          ["a short name", structure("a", "main", "A"), "box", at(2, 0), false],
          [
            "a long name",
            structure("a", "main", longName),
            "box",
            at(2, 0),
            true,
          ],
          [
            "a long name with a short tag label",
            { ...structure("a", "main", longName), tag: "A" },
            "box",
            at(2, 0),
            false,
          ],
          ["a tall box behind", structure("a"), "tall", at(4, 4), true],
          ["a slab behind", structure("a"), "slab", at(4, 4), false],
        ] as const;

        for (const [what, tagged, shape, behind, covered] of cases) {
          const problems = layoutProblems(
            mapOf([tagged, { ...structure("b"), shape }]),
            layoutOf({ a: at(0, 0), b: behind })
          );

          assert.strictEqual(
            Arr.some(
              problems,
              ({ message, path }) =>
                path === "structures.a" &&
                Str.includes('name tag is drawn on top of "b"')(message)
            ),
            covered,
            what
          );
        }
      })
  );

  it.effect("draws a tall shape's outline higher than a slab's", () =>
    Effect.sync(() => {
      assert.isBelow(outlineTop("tall"), outlineTop("slab"));
    })
  );
});
