import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect, Option, String as Str } from "effect";

import {
  checkLayout,
  footprintsOverlap,
  placeStructures,
  zonePadding,
  zonesOf,
} from "../src/index.ts";
import type {
  Layout,
  MapData,
  MapProblem,
  Placement,
  Structure,
} from "../src/index.ts";

type MapParts = Pick<MapData, "groups" | "structures">;

const structure = (id: string, group: string): Structure => ({
  id,
  code: "S",
  name: id,
  shape: "box",
  group,
  status: "live",
  oneLiner: "One line.",
  whatItDoes: "Does.",
  howItsBuilt: "Built.",
});

const data: MapParts = {
  groups: [
    { id: "front", title: "Front" },
    { id: "back", title: "Back end" },
    { id: "empty", title: "Empty" },
  ],
  structures: [
    structure("web", "front"),
    structure("api", "back"),
    structure("db", "back"),
    structure("cache", "back"),
  ],
};

const mapOf = (parts: MapParts): MapData => ({
  format: 1,
  revision: 0,
  overview: { title: "Map", summary: "A map." },
  ...parts,
  hops: [],
  flows: [],
  chapters: [],
});

const at = (x: number, y: number): Placement => ({ x, y, w: 2, d: 2 });

const layoutOf = (structures: Readonly<Record<string, Placement>>): Layout => ({
  format: 1,
  revision: 0,
  structures,
});

const layout = layoutOf({
  web: at(0, 0),
  api: at(6, 0),
  db: { x: 10, y: 3, w: 3, d: 2.5 },
  cache: at(6, 4),
});

const pad = (box: Placement, by: number): Placement => ({
  x: box.x - by,
  y: box.y - by,
  w: box.w + 2 * by,
  d: box.d + 2 * by,
});

const zoneWarnings = (problems: readonly MapProblem[]) =>
  Arr.filter(problems, ({ message }) => Str.includes("zones of")(message));

const membersOf = (group: string, count: number) =>
  Arr.map(Arr.range(1, count), (n) => structure(`${group}${n}`, group));

const groupsNamed = (ids: readonly string[]) =>
  Arr.map(ids, (id) => ({ id, title: id }));

/** Asserts that no two of the map's zones share ground. */
const assertSeparate = (parts: MapParts, placed: Layout) => {
  const zones = zonesOf({ data: parts, layout: placed });

  for (const [index, zone] of zones.entries()) {
    for (const other of zones.slice(index + 1)) {
      assert.isFalse(
        footprintsOverlap(zone.box, other.box),
        `${zone.group.id}'s zone overlaps ${other.group.id}'s`
      );
    }
  }
};

describe("zones", () => {
  it.effect(
    "fits each group's placed structures plus padding, in groups order",
    () =>
      Effect.sync(() => {
        assert.deepStrictEqual(zonesOf({ data, layout }), [
          {
            group: { id: "front", title: "Front" },
            members: ["web"],
            box: pad(at(0, 0), zonePadding),
          },
          {
            group: { id: "back", title: "Back end" },
            members: ["api", "db", "cache"],
            box: pad({ x: 6, y: 0, w: 7, d: 6 }, zonePadding),
          },
        ]);
      })
  );

  it.effect("follows the current positions", () =>
    Effect.sync(() => {
      const moved = layoutOf({ ...layout.structures, web: at(-4, 2.5) });
      const [front] = zonesOf({ data, layout: moved });

      assert.deepStrictEqual(front?.box, pad(at(-4, 2.5), zonePadding));
    })
  );

  it.effect("fits only the revealed structures when given a set", () =>
    Effect.sync(() => {
      const zones = zonesOf({
        data,
        layout,
        revealed: new Set(["api", "cache"]),
      });

      assert.deepStrictEqual(
        Arr.map(zones, ({ group, members, box }) => ({
          group: group.id,
          members,
          box,
        })),
        [
          {
            group: "back",
            members: ["api", "cache"],
            box: pad({ x: 6, y: 0, w: 2, d: 6 }, zonePadding),
          },
        ]
      );
    })
  );

  it.effect("skips structures with no placement and groups with none", () =>
    Effect.sync(() => {
      const zones = zonesOf({ data, layout: layoutOf({ db: at(0, 0) }) });

      assert.deepStrictEqual(
        Arr.map(zones, ({ group, members }) => ({ group: group.id, members })),
        [{ group: "back", members: ["db"] }]
      );
    })
  );
});

describe("zone overlap check", () => {
  it.effect("warns once when two zones overlap, naming both groups", () =>
    Effect.sync(() => {
      const crowded = layoutOf({ ...layout.structures, web: at(3, 0) });
      const problems = checkLayout(mapOf(data), crowded);

      assert.deepStrictEqual(zoneWarnings(problems), [
        {
          severity: "warning",
          file: "layout.json",
          path: "",
          message:
            'the zones of groups "front" and "back" overlap. Move one group\'s structures away from the other, for example with axonometric layout <home> <id> --x <x> --y <y>.',
        },
      ]);
    })
  );

  it.effect("is quiet when zones only touch along an edge", () =>
    Effect.sync(() => {
      // With web at x 2, front's zone ends at x 5, where back's starts.
      const touching = layoutOf({ ...layout.structures, web: at(2, 0) });
      const problems = checkLayout(mapOf(data), touching);

      assert.deepStrictEqual(zoneWarnings(problems), []);
    })
  );
});

describe("placement and zones", () => {
  it.effect("keeps every zone apart when it places a map from scratch", () =>
    Effect.sync(() => {
      const parts = {
        groups: groupsNamed(["a", "b", "c"]),
        structures: [
          ...membersOf("a", 5),
          ...membersOf("b", 2),
          ...membersOf("c", 7),
        ],
      };

      assertSeparate(parts, placeStructures(mapOf(parts), layoutOf({})).layout);
    })
  );

  it.effect(
    "puts each new structure next to its own zone, never inside another group's",
    () =>
      Effect.sync(() => {
        const groups = groupsNamed(["a", "b", "c"]);
        const structures = [...membersOf("a", 3), ...membersOf("b", 3)];

        let current = placeStructures(
          mapOf({ groups, structures }),
          layoutOf({})
        ).layout;

        // Members arrive one at a time, as when an agent grows a map.
        const additions = [
          structure("a4", "a"),
          structure("b4", "b"),
          structure("c1", "c"),
          structure("a5", "a"),
          structure("b5", "b"),
          structure("c2", "c"),
        ];

        for (const added of additions) {
          structures.push(added);

          const parts = { groups, structures };
          const before = zonesOf({ data: parts, layout: current });

          current = placeStructures(mapOf(parts), current).layout;

          const spot = current.structures[added.id];

          assert.isDefined(spot, `${added.id} has no placement`);

          if (spot === undefined) {
            return;
          }

          for (const zone of before) {
            if (zone.group.id !== added.group) {
              assert.isFalse(
                footprintsOverlap(zone.box, spot),
                `${added.id} landed inside ${zone.group.id}'s zone`
              );
            }
          }

          const own = Arr.findFirst(
            before,
            (zone) => zone.group.id === added.group
          );

          // Next to its zone means within one slot of the zone's edge.
          if (Option.isSome(own)) {
            assert.isTrue(
              footprintsOverlap(pad(own.value.box, 4), spot),
              `${added.id} is far from ${added.group}'s zone`
            );
          }

          assertSeparate(parts, current);
        }
      })
  );

  it.effect("grows a zone away from a neighbour that sits close by", () =>
    Effect.sync(() => {
      const parts = {
        groups: groupsNamed(["a", "b"]),
        structures: [
          structure("a1", "a"),
          structure("b1", "b"),
          structure("a2", "a"),
        ],
      };

      const { layout: placed } = placeStructures(
        mapOf(parts),
        layoutOf({ a1: at(0, 0), b1: at(6, 0) })
      );

      assertSeparate(parts, placed);
    })
  );
});
