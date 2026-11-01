import { Array as Arr, Record as Rec, String as Str } from "effect";
import { dual } from "effect/Function";

import { boxOutline, nameTagRect, nameTagText, tagCoversBox } from "./iso.ts";
import type { Layout, Placement } from "./layout.ts";
import type { MapData, Structure } from "./map-data.ts";
import { mapWarning } from "./problems.ts";
import type { MapProblem } from "./problems.ts";
import { routeLength, routeRevealed } from "./routing.ts";
import type { HopRoute } from "./routing.ts";
import { sceneClashes, sceneOf } from "./scene.ts";
import type { SceneClash } from "./scene.ts";
import { zonesOf } from "./zones.ts";

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

const overlappingZones = (data: MapData, layout: Layout) => {
  const zones = zonesOf({ data, layout });

  return Arr.flatMap(zones, (first, index) =>
    Arr.flatMap(zones.slice(index + 1), (second) =>
      footprintsOverlap(first.box, second.box)
        ? [
            mapWarning({
              file: "layout.json",
              path: [],
              message: `the zones of groups "${first.group.id}" and "${second.group.id}" overlap. Move one group's structures away from the other, for example with axonometric layout <home> <id> --x <x> --y <y>.`,
            }),
          ]
        : []
    )
  );
};

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

/** The warnings about one hop's route, if it runs under a box or too far. */
const routeWarnings = (
  hop: MapData["hops"][number],
  route: HopRoute
): readonly MapProblem[] => {
  const one = route.crosses.length === 1;

  const why = route.overridden
    ? `its route override passes through ${one ? "that box" : "those boxes"}. Change the override's points so it goes around, or delete it so the hop routes itself.`
    : `no clear route goes around ${one ? "it" : "them"}. Move the structures apart to open a gap, or write a route override.`;

  const under = Arr.isReadonlyArrayNonEmpty(route.crosses)
    ? [
        mapWarning({
          file: "layout.json",
          path: ["routes", hop.id],
          message: `hop "${hop.id}" from "${hop.from}" to "${hop.to}" runs under ${quotedList(route.crosses)}: ${why}`,
        }),
      ]
    : [];

  const { length, distance } = routeLength(route.points);

  const long = route.tooLong
    ? [
        mapWarning({
          file: "layout.json",
          path: ["routes", hop.id],
          message: `hop "${hop.id}" from "${hop.from}" to "${hop.to}" takes a long way round: ${length} units for ends ${distance} apart. Move the structures so nothing stands between them, or write a route override.`,
        }),
      ]
    : [];

  return [...under, ...long];
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
 * What each chapter reveals, with every earlier chapter's reveals, and the
 * hops it plays. A map with no chapters shows everything at once.
 */
interface ChapterView {
  readonly id: string | undefined;
  readonly revealed: ReadonlySet<string>;
  readonly plays: readonly string[];
}

const chapterViews = (data: MapData): readonly ChapterView[] => {
  if (!Arr.isReadonlyArrayNonEmpty(data.chapters)) {
    return [
      {
        id: undefined,
        revealed: new Set(Arr.map(data.structures, ({ id }) => id)),
        plays: Arr.empty<string>(),
      },
    ];
  }

  return Arr.map(data.chapters, (chapter, index) => ({
    id: chapter.id,
    revealed: new Set(
      Arr.flatMap(data.chapters.slice(0, index + 1), ({ reveals }) => reveals)
    ),
    plays: chapter.plays,
  }));
};

const thingNames = {
  box: "the box of",
  tag: "the name tag of",
  chip: "the code chip of",
  title: "the zone title of",
  label: "the label of hop",
  route: "the route of hop",
} as const satisfies Record<string, string>;

const kindOf = (thing: string) => Str.split(":")(thing)[0];

const thingKinds: ReadonlySet<string> = new Set(Rec.keys(thingNames));

const isKind = (kind: string): kind is keyof typeof thingNames =>
  thingKinds.has(kind);

const describeThing = (thing: string) => {
  const [kind, ...rest] = Str.split(":")(thing);
  const name = isKind(kind) ? thingNames[kind] : kind;

  return `${name} "${Arr.join(rest, ":")}"`;
};

/** What the footprint and name tag checks cover between them. */
const structureParts: ReadonlySet<string> = new Set(["box", "tag", "chip"]);

/**
 * Whether the older checks already warn about a clash: boxes, tags and
 * chips drawn over each other come from overlapping footprints or a tag on
 * a box, which `overlaps` and `coveredTags` report.
 */
const coveredElsewhere = (first: string, second: string) =>
  structureParts.has(kindOf(first)) && structureParts.has(kindOf(second));

/**
 * Warnings about each chapter's drawing, as the walkthrough draws it: hops
 * routed around the structures revealed so far, and everything else the
 * iso view would draw over something by the scene's overlap rule (chips,
 * zone titles, labels and routes). Each warning is reported once, at the
 * first chapter it shows in.
 */
const chapterWarnings = (data: MapData, layout: Layout) => {
  const seen = new Set<string>();

  const once = (key: string) => {
    const fresh = !seen.has(key);

    seen.add(key);

    return fresh;
  };

  return Arr.flatMap(chapterViews(data), ({ id, revealed, plays }) => {
    const routes = routeRevealed({ data, layout, revealed });
    const where = id === undefined ? "" : ` in chapter "${id}"`;

    const routing = Arr.flatMap(data.hops, (hop) => {
      const route = routes[hop.id];

      return route === undefined
        ? []
        : Arr.filter(routeWarnings(hop, route), ({ message }) => once(message));
    });

    const clashes = Arr.flatMap<SceneClash, MapProblem>(
      sceneClashes(
        sceneOf({ data, layout, revealed, routes, labelFirst: plays })
      ),
      ({ between: [first, second] }) =>
        coveredElsewhere(first, second) || !once(`${first} ${second}`)
          ? []
          : [
              mapWarning({
                file: "layout.json",
                path: ["structures"],
                message: `${describeThing(first)} is drawn over ${describeThing(second)}${where}. Move the structures apart, so the drawing has room.`,
              }),
            ]
    );

    return [...routing, ...clashes];
  });
};

/**
 * Warnings about how the layout reads: entries for structures that no longer
 * exist, route overrides for hops that no longer exist, footprints that
 * overlap, name tags drawn over other boxes, zones that overlap, routes that
 * run under boxes, and anything else the iso view would draw over something
 * in some chapter. A structure with no placement gets nothing, because
 * `build` places it.
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
    ...overlappingZones(data, layout),
    ...chapterWarnings(data, layout),
  ];
});
