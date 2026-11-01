import { Array as Arr, Record as Rec } from "effect";
import { dual } from "effect/Function";

import { boxOutline, nameTagRect, nameTagText, tagCoversBox } from "./iso.ts";
import type { Layout, Placement } from "./layout.ts";
import type { MapData, Structure } from "./map-data.ts";
import { mapWarning } from "./problems.ts";
import type { MapProblem } from "./problems.ts";
import { routeHops } from "./routing.ts";

/** A structure and where the layout puts it. */
export interface PlacedStructure {
  readonly structure: Structure;
  readonly placement: Placement;
}

/** Every structure that has a placement, in data.mjs order. */
export const placedStructures: {
  (layout: Layout): (data: MapData) => readonly PlacedStructure[];
  (data: MapData, layout: Layout): readonly PlacedStructure[];
} = dual(2, (data: MapData, layout: Layout): readonly PlacedStructure[] =>
  Arr.flatMap(data.structures, (structure) => {
    const placement = layout.structures[structure.id];

    return placement === undefined ? [] : [{ structure, placement }];
  })
);

/**
 * Whether two footprints share ground. Footprints that only touch along an
 * edge don't overlap.
 */
export const footprintsOverlap: {
  (b: Placement): (a: Placement) => boolean;
  (a: Placement, b: Placement): boolean;
} = dual(
  2,
  (a: Placement, b: Placement) =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.d && b.y < a.y + a.d
);

/** Whether `a`'s name tag is drawn over `b`'s box in the iso view. */
export const tagCovers: {
  (b: PlacedStructure): (a: PlacedStructure) => boolean;
  (a: PlacedStructure, b: PlacedStructure): boolean;
} = dual(2, (a: PlacedStructure, b: PlacedStructure) =>
  tagCoversBox(
    nameTagRect(a.placement, nameTagText(a.structure)),
    boxOutline(b.placement, b.structure.shape)
  )
);

const at = (id: string) => ["structures", id];

const overlaps = (placed: readonly PlacedStructure[]) =>
  Arr.flatMap(placed, (first, index) =>
    Arr.flatMap(placed.slice(index + 1), (second) =>
      footprintsOverlap(first.placement, second.placement)
        ? [
            mapWarning({
              file: "layout.json",
              path: at(second.structure.id),
              message: `footprint overlaps "${first.structure.id}". Move one of them, for example with axonometric layout <home> ${second.structure.id} --x <x> --y <y>.`,
            }),
          ]
        : []
    )
  );

const coveredTags = (placed: readonly PlacedStructure[]) =>
  Arr.flatMap(placed, (tagged) =>
    Arr.flatMap(placed, (other) =>
      other.structure.id !== tagged.structure.id && tagCovers(tagged, other)
        ? [
            mapWarning({
              file: "layout.json",
              path: at(tagged.structure.id),
              message: `name tag is drawn on top of "${other.structure.id}". Move one of them apart, so the tag under the front corner has room.`,
            }),
          ]
        : []
    )
  );

const staleEntries = (data: MapData, layout: Layout) => {
  const ids = new Set(Arr.map(data.structures, ({ id }) => id));

  return Arr.flatMap(Rec.keys(layout.structures), (id) =>
    ids.has(id)
      ? []
      : [
          mapWarning({
            file: "layout.json",
            path: at(id),
            message: `no structure in data.mjs has the id "${id}". build removes this entry.`,
          }),
        ]
  );
};

const quotedList = (ids: readonly string[]) =>
  Arr.join(
    Arr.map(ids, (id) => `"${id}"`),
    ", "
  );

const blockedRoutes = (data: MapData, layout: Layout) => {
  const routes = routeHops(data, layout);

  return Arr.flatMap(data.hops, (hop) => {
    const route = routes[hop.id];

    if (route === undefined || !Arr.isReadonlyArrayNonEmpty(route.crosses)) {
      return [];
    }

    const one = route.crosses.length === 1;

    const why = route.overridden
      ? `its route override passes through ${one ? "that box" : "those boxes"}. Change the override's points so it goes around, or delete it so the hop routes itself.`
      : `no clear route goes around ${one ? "it" : "them"}. Move the structures apart to open a gap, or write a route override.`;

    return [
      mapWarning({
        file: "layout.json",
        path: ["routes", hop.id],
        message: `hop "${hop.id}" from "${hop.from}" to "${hop.to}" runs under ${quotedList(route.crosses)}: ${why}`,
      }),
    ];
  });
};

const staleRoutes = (data: MapData, layout: Layout) => {
  const ids = new Set(Arr.map(data.hops, ({ id }) => id));

  return Arr.flatMap(Rec.keys(layout.routes ?? {}), (id) =>
    ids.has(id)
      ? []
      : [
          mapWarning({
            file: "layout.json",
            path: ["routes", id],
            message: `no hop in data.mjs has the id "${id}". build removes this route override.`,
          }),
        ]
  );
};

/**
 * Warnings about how the layout reads: entries for structures that no longer
 * exist, route overrides for hops that no longer exist, footprints that
 * overlap, name tags drawn over other boxes, and routes that run under boxes.
 * A structure with no placement gets nothing, because `build` places it.
 */
export const checkLayout: {
  (layout: Layout): (data: MapData) => readonly MapProblem[];
  (data: MapData, layout: Layout): readonly MapProblem[];
} = dual(2, (data: MapData, layout: Layout): readonly MapProblem[] => {
  const placed = placedStructures(data, layout);

  return [
    ...staleEntries(data, layout),
    ...staleRoutes(data, layout),
    ...overlaps(placed),
    ...coveredTags(placed),
    ...blockedRoutes(data, layout),
  ];
});
