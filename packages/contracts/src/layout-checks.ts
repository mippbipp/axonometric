import { Array as Arr, Record as Rec, String as Str } from "effect";
import { dual } from "effect/Function";

import { boxOutline, nameTagRect, nameTagText, tagCoversBox } from "./iso.ts";
import type { GridPoint, Layout, Placement } from "./layout.ts";
import type { MapData, Structure } from "./map-data.ts";
import { views } from "./plan.ts";
import type { View } from "./plan.ts";
import { mapError, mapWarning } from "./problems.ts";
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
          message: `hop "${hop.id}" from "${hop.from}" to "${hop.to}" takes a long way round: ${length} units for ends ${distance} apart. ${
            route.overridden
              ? "Shorten the route override's points, or delete it so the hop routes itself."
              : "Move the structures so nothing stands between them, or write a route override."
          }`,
        }),
      ]
    : [];

  return [...under, ...long];
};

/** Whether a point sits on a footprint's outline, edges and corners included. */
const onOutline = (point: GridPoint, box: Placement) => {
  const withinX = point.x >= box.x && point.x <= box.x + box.w;
  const withinY = point.y >= box.y && point.y <= box.y + box.d;
  const onX = point.x === box.x || point.x === box.x + box.w;
  const onY = point.y === box.y || point.y === box.y + box.d;

  return (onX && withinY) || (onY && withinX);
};

/**
 * Errors for route overrides whose first point isn't on the edge of the
 * hop's source footprint, or whose last point isn't on its target's. Such
 * a route starts or ends in the open, or inside a box, so it can't be
 * drawn as a hop between the two.
 */
const offEndOverrides = (data: MapData, layout: Layout) =>
  Arr.flatMap(data.hops, (hop) => {
    const points = layout.routes?.[hop.id];
    const from = layout.structures[hop.from];
    const to = layout.structures[hop.to];

    if (points === undefined || from === undefined || to === undefined) {
      return [];
    }

    const ends = [
      { end: "first", point: points[0], box: from, structure: hop.from },
      { end: "last", point: points.at(-1), box: to, structure: hop.to },
    ] as const;

    return Arr.flatMap(ends, ({ end, point, box, structure }) =>
      point === undefined || onOutline(point, box)
        ? []
        : [
            mapError({
              file: "layout.json",
              path: ["routes", hop.id],
              message: `hop "${hop.id}"'s route override ${end === "first" ? "starts" : "ends"} at (${point.x}, ${point.y}), which isn't on the edge of "${structure}" at x ${box.x}–${box.x + box.w}, y ${box.y}–${box.y + box.d}. Move its ${end} point onto that footprint's edge.`,
            }),
          ]
    );
  });

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

/** What the footprint and name tag checks cover between them, by view. */
const structureParts: Readonly<Record<View, ReadonlySet<string>>> = {
  iso: new Set(["box", "tag", "chip"]),
  plan: new Set(["box", "chip"]),
};

/**
 * Whether the older checks already warn about a clash. In the iso view,
 * boxes, tags and chips drawn over each other come from overlapping
 * footprints or a tag on a box, which `overlaps` and `coveredTags` report.
 * Those checks measure the iso view's tags, so in Plan view only boxes and
 * chips drawn over each other count as covered: they come from overlapping
 * footprints.
 */
const coveredElsewhere = (view: View, first: string, second: string) =>
  structureParts[view].has(kindOf(first)) &&
  structureParts[view].has(kindOf(second));

/** How a warning names the view it's about. The iso view goes unnamed. */
const viewNames: Readonly<Record<View, string>> = {
  iso: "",
  plan: " in Plan view",
};

/** Every half-unit step a route takes, as order-free keys. */
const stepKeysOf = (points: readonly GridPoint[]) =>
  new Set(
    Arr.flatMap(points, (start, index) => {
      const end = points[index + 1];

      if (end === undefined) {
        return [];
      }

      const count = (Math.abs(end.x - start.x) + Math.abs(end.y - start.y)) * 2;
      const dx = Math.sign(end.x - start.x) / 2;
      const dy = Math.sign(end.y - start.y) / 2;

      return Arr.map(Arr.range(0, count - 1), (step) => {
        const x = start.x + dx * step;
        const y = start.y + dy * step;

        return `${Math.min(x, x + dx)},${Math.min(y, y + dy)},${dx === 0 ? "y" : "x"}`;
      });
    })
  );

/**
 * Warnings for two routes that run along the same segment, where at least
 * one is a route override. The router keeps its own routes apart, so only
 * an override can land on top of another route, and then the two hops read
 * as one line.
 */
const sharedSegments = (
  data: MapData,
  routes: Readonly<Record<string, HopRoute>>
) => {
  const routed = Arr.flatMap(data.hops, (hop) => {
    const route = routes[hop.id];

    return route === undefined
      ? []
      : [{ hop, route, steps: stepKeysOf(route.points) }];
  });

  return Arr.flatMap(routed, (first, index) =>
    Arr.flatMap(routed.slice(index + 1), (second) => {
      const overridden = first.route.overridden || second.route.overridden;

      const shares = Arr.some([...second.steps], (step) =>
        first.steps.has(step)
      );

      if (!overridden || !shares) {
        return [];
      }

      const owner = first.route.overridden ? first : second;
      const other = owner === first ? second : first;

      return [
        mapWarning({
          file: "layout.json",
          path: ["routes", owner.hop.id],
          message: `hop "${owner.hop.id}"'s route override runs along the same segment as hop "${other.hop.id}", so the two read as one line. Move the override's points off the other route.`,
        }),
      ];
    })
  );
};

/**
 * A warning for each clash in each view's scene of one chapter, except
 * those the older checks cover. `once` keys by the view as well as the
 * pair, so a pair that clashes in both views warns in both.
 */
export const clashWarnings = ({
  clashes,
  where,
  once,
}: {
  readonly clashes: readonly {
    readonly view: View;
    readonly clashes: readonly SceneClash[];
  }[];
  /** Where the clashes are, such as ` in chapter "c-all"`. */
  readonly where: string;
  /** Whether a key is seen for the first time, across chapters. */
  readonly once: (key: string) => boolean;
}): readonly MapProblem[] =>
  Arr.flatMap(clashes, ({ view, clashes: drawn }) =>
    Arr.flatMap(drawn, ({ between: [first, second] }) =>
      coveredElsewhere(view, first, second) ||
      !once(`${view} ${first} ${second}`)
        ? []
        : [
            mapWarning({
              file: "layout.json",
              path: ["structures"],
              message: `${describeThing(first)} is drawn over ${describeThing(second)}${where}${viewNames[view]}. Move the structures apart, so the drawing has room.`,
            }),
          ]
    )
  );

/**
 * Warnings about each chapter's drawing, as the walkthrough draws it: hops
 * routed around the structures revealed so far, and everything else the
 * iso view or Plan view would draw over something by the scene's overlap
 * rule (chips, zone titles, labels and routes). Each warning is reported
 * once per view, at the first chapter it shows in.
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

    const clashes = clashWarnings({
      clashes: Arr.map(views, (view) => ({
        view,
        clashes: sceneClashes(
          sceneOf({ data, layout, revealed, routes, labelFirst: plays, view })
        ),
      })),
      where,
      once,
    });

    const shared = Arr.filter(sharedSegments(data, routes), ({ message }) =>
      once(message)
    );

    return [...routing, ...shared, ...clashes];
  });
};

/**
 * Problems with how the layout reads. Errors for route overrides whose ends
 * aren't on their hop's footprints; warnings for entries for structures
 * that no longer exist, route overrides for hops that no longer exist,
 * overrides that share a segment with another route, footprints that
 * overlap, name tags drawn over other boxes, zones that overlap, routes that
 * run under boxes, and anything else the iso view or Plan view would draw
 * over something in some chapter. A structure with no placement gets nothing, because
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
    ...offEndOverrides(data, layout),
    ...overlaps(placed),
    ...coveredTags(placed),
    ...overlappingZones(data, layout),
    ...chapterWarnings(data, layout),
  ];
});
