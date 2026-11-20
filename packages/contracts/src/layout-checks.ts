import { Array as Arr, Order, Record as Rec, String as Str } from "effect";
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
import type { Scene, SceneClash } from "./scene.ts";
import { zonesOf } from "./zones.ts";

/** A structure and where the layout puts it. */
export interface PlacedStructure {
  readonly placement: Placement;
  readonly structure: Structure;
}

/** Every structure that has a placement, in data.mjs order. */
export const placedStructures: {
  (layout: Layout): (data: MapData) => ReadonlyArray<PlacedStructure>;
  (data: MapData, layout: Layout): ReadonlyArray<PlacedStructure>;
} = dual(2, (data: MapData, layout: Layout): ReadonlyArray<PlacedStructure> =>
  Arr.flatMap(data.structures, (structure) => {
    const placement = layout.structures[structure.id];

    return placement === undefined ? [] : [{ placement, structure }];
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

/** The ground two footprints span, from the top left of both to the bottom right. */
export const spanOf: {
  (b: Placement): (a: Placement) => Placement;
  (a: Placement, b: Placement): Placement;
} = dual(2, (a: Placement, b: Placement): Placement => {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);

  return {
    d: Math.max(a.y + a.d, b.y + b.d) - y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    x,
    y,
  };
});

/** Whether `a`'s name tag is drawn over `b`'s box in the Iso view. */
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

const overlaps = (placed: ReadonlyArray<PlacedStructure>) =>
  Arr.flatMap(placed, (first, index) =>
    Arr.flatMap(placed.slice(index + 1), (second) =>
      footprintsOverlap(first.placement, second.placement)
        ? [
            mapWarning({
              file: "layout.json",
              hint: `Move one of them, for example with axonometric layout <home> ${second.structure.id} --x <x> --y <y>.`,
              message: `footprint overlaps "${first.structure.id}".`,
              path: at(second.structure.id),
            }),
          ]
        : []
    )
  );

const coveredTags = (placed: ReadonlyArray<PlacedStructure>) =>
  Arr.flatMap(placed, (tagged) =>
    Arr.flatMap(placed, (other) =>
      other.structure.id !== tagged.structure.id && tagCovers(tagged, other)
        ? [
            mapWarning({
              file: "layout.json",
              message: `name tag is drawn on top of "${other.structure.id}". Move one of them apart, so the tag under the front corner has room.`,
              path: at(tagged.structure.id),
            }),
          ]
        : []
    )
  );

/** What `overlappingZones` looks at: the map, and optionally one chapter's drawing. */
interface ZoneCheck {
  readonly data: MapData;
  readonly layout: Layout;
  /** The structures the chapter has revealed; every structure when left out. */
  readonly revealed?: ReadonlySet<string>;
  /** Where the zones are, such as ` in chapter "c-all"`. */
  readonly where?: string;
}

const overlappingZones = ({
  data,
  layout,
  revealed,
  where = "",
}: ZoneCheck) => {
  const zones = zonesOf({ data, layout, revealed });

  return Arr.flatMap(zones, (first, index) =>
    Arr.flatMap(zones.slice(index + 1), (second) =>
      footprintsOverlap(first.box, second.box)
        ? [
            mapWarning({
              file: "layout.json",
              hint: "Move one group's structures away from the other, for example with axonometric layout <home> <id> --x <x> --y <y>.",
              message: `the zones of groups "${first.group.id}" and "${second.group.id}" overlap${where}.`,
              path: [],
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
            message: `no structure in data.mjs has the id "${id}". build removes this entry.`,
            path: at(id),
          }),
        ]
  );
};

const quotedList = (ids: ReadonlyArray<string>) =>
  Arr.join(
    Arr.map(ids, (id) => `"${id}"`),
    ", "
  );

/** The warnings about one hop's route, if it runs under a box or too far. */
const routeWarnings = (
  hop: MapData["hops"][number],
  route: HopRoute
): ReadonlyArray<MapProblem> => {
  const one = route.crosses.length === 1;

  const why = route.overridden
    ? `its route override passes through ${one ? "that box" : "those boxes"}. Change the override's points so it goes around, or delete it so the hop routes itself.`
    : `no clear route goes around ${one ? "it" : "them"}. Move the structures apart to open a gap, or write a route override.`;

  const under = Arr.isReadonlyArrayNonEmpty(route.crosses)
    ? [
        mapWarning({
          file: "layout.json",
          message: `hop "${hop.id}" from "${hop.from}" to "${hop.to}" runs under ${quotedList(route.crosses)}: ${why}`,
          path: ["routes", hop.id],
        }),
      ]
    : [];

  const { distance, length } = routeLength(route.points);

  const long = route.tooLong
    ? [
        mapWarning({
          file: "layout.json",
          message: `hop "${hop.id}" from "${hop.from}" to "${hop.to}" takes a long way round: ${length} units for ends ${distance} apart. ${
            route.overridden
              ? "Shorten the route override's points, or delete it so the hop routes itself."
              : "Move the structures so nothing stands between them, or write a route override."
          }`,
          path: ["routes", hop.id],
        }),
      ]
    : [];

  return [...under, ...long];
};

/** Whether a point sits on a footprint's outline, edges and corners included. */
export const onOutline: {
  (box: Placement): (point: GridPoint) => boolean;
  (point: GridPoint, box: Placement): boolean;
} = dual(2, (point: GridPoint, box: Placement) => {
  const withinX = point.x >= box.x && point.x <= box.x + box.w;
  const withinY = point.y >= box.y && point.y <= box.y + box.d;
  const onX = point.x === box.x || point.x === box.x + box.w;
  const onY = point.y === box.y || point.y === box.y + box.d;

  return (onX && withinY) || (onY && withinX);
});

/** A hop's id and the structures at its ends. */
export interface HopEnds {
  readonly from: string;
  readonly id: string;
  readonly to: string;
}

/** A route override with an end off its footprint, and the problem it makes. */
export interface OffEnd {
  readonly end: "first" | "last";
  readonly hop: HopEnds;
  readonly problem: MapProblem;
}

/**
 * Errors for route overrides whose first point isn't on the edge of the
 * hop's source footprint, or whose last point isn't on its target's. Such
 * a route starts or ends in the open, or inside a box, so it can't be
 * drawn as a hop between the two. `check` and the page's reroute refusals
 * both ask this, so they never disagree about what an override may be.
 */
export const offEndFindings: {
  (layout: Layout): (hops: ReadonlyArray<HopEnds>) => ReadonlyArray<OffEnd>;
  (hops: ReadonlyArray<HopEnds>, layout: Layout): ReadonlyArray<OffEnd>;
} = dual(
  2,
  (hops: ReadonlyArray<HopEnds>, layout: Layout): ReadonlyArray<OffEnd> =>
    Arr.flatMap(hops, (hop) => {
      const points = layout.routes?.[hop.id];
      const from = layout.structures[hop.from];
      const to = layout.structures[hop.to];

      if (points === undefined || from === undefined || to === undefined) {
        return [];
      }

      const ends = [
        { box: from, end: "first", point: points[0], structure: hop.from },
        { box: to, end: "last", point: points.at(-1), structure: hop.to },
      ] as const;

      return Arr.flatMap(ends, ({ box, end, point, structure }) =>
        point === undefined || onOutline(point, box)
          ? []
          : [
              {
                end,
                hop,
                problem: mapError({
                  file: "layout.json",
                  message: `hop "${hop.id}"'s route override ${end === "first" ? "starts" : "ends"} at (${point.x}, ${point.y}), which isn't on the edge of "${structure}" at x ${box.x}–${box.x + box.w}, y ${box.y}–${box.y + box.d}. Move its ${end} point onto that footprint's edge.`,
                  path: ["routes", hop.id],
                }),
              },
            ]
      );
    })
);

/** The errors `offEndFindings` finds. */
export const offEndOverrides: {
  (layout: Layout): (hops: ReadonlyArray<HopEnds>) => ReadonlyArray<MapProblem>;
  (hops: ReadonlyArray<HopEnds>, layout: Layout): ReadonlyArray<MapProblem>;
} = dual(
  2,
  (hops: ReadonlyArray<HopEnds>, layout: Layout): ReadonlyArray<MapProblem> =>
    Arr.map(offEndFindings(hops, layout), ({ problem }) => problem)
);

const staleRoutes = (data: MapData, layout: Layout) => {
  const ids = new Set(Arr.map(data.hops, ({ id }) => id));

  return Arr.flatMap(Rec.keys(layout.routes ?? {}), (id) =>
    ids.has(id)
      ? []
      : [
          mapWarning({
            file: "layout.json",
            message: `no hop in data.mjs has the id "${id}". build removes this route override.`,
            path: ["routes", id],
          }),
        ]
  );
};

/**
 * What each chapter reveals, with every earlier chapter's reveals, and the
 * hops it plays. A map with no chapters shows everything at once.
 */
export interface ChapterView {
  readonly id: string | undefined;
  readonly plays: ReadonlyArray<string>;
  readonly revealed: ReadonlySet<string>;
}

/** The chapters `check` draws, in order: one for the whole map when it has none. */
export const chapterViews = (data: MapData): ReadonlyArray<ChapterView> => {
  if (!Arr.isReadonlyArrayNonEmpty(data.chapters)) {
    return [
      {
        id: undefined,
        plays: Arr.empty<string>(),
        revealed: new Set(Arr.map(data.structures, ({ id }) => id)),
      },
    ];
  }

  return Arr.map(data.chapters, (chapter, index) => ({
    id: chapter.id,
    plays: chapter.plays,
    revealed: new Set(
      Arr.flatMap(data.chapters.slice(0, index + 1), ({ reveals }) => reveals)
    ),
  }));
};

const thingNames = {
  arrow: "the arrowhead of hop",
  box: "the box of",
  chip: "the code chip of",
  corner: "a corner of",
  label: "the label of hop",
  route: "the route of hop",
  tag: "the name tag of",
  title: "the zone title of",
  zone: "the outline of zone",
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
 * Whether the older checks already warn about a clash. In the Iso view,
 * boxes, tags and chips drawn over each other come from overlapping
 * footprints or a tag on a box, which `overlaps` and `coveredTags` report.
 * Those checks measure the Iso view's tags, so in Plan view only boxes and
 * chips drawn over each other count as covered: they come from overlapping
 * footprints.
 */
const coveredElsewhere = (view: View, first: string, second: string) =>
  structureParts[view].has(kindOf(first)) &&
  structureParts[view].has(kindOf(second));

/** How a warning names the view it's about. The Iso view goes unnamed. */
const viewNames: Readonly<Record<View, string>> = {
  iso: "",
  plan: " in Plan view",
};

/**
 * Which views `check` warns about hidden hop labels in. Plan view holds
 * every label to the strict rule, so a hidden one means the layout lacks
 * room. The Iso view lets a label sit nearer another route than its own to
 * save it, and still hides many labels, so it isn't held to this.
 */
const labelsChecked: Readonly<Record<View, boolean>> = {
  iso: false,
  plan: true,
};

/** Every half-unit step a route takes, as order-free keys. */
const stepKeysOf = (points: ReadonlyArray<GridPoint>) =>
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
 * A finding for each hop whose label the scene leaves out in a view `check`
 * holds to the label rule, keyed so it is reported once per hop and view
 * across chapters.
 */
const hiddenLabelFindings = ({
  scene,
  view,
  where,
}: {
  readonly scene: Scene;
  readonly view: View;
  /** Where the scene is, such as ` in chapter "c-all"`. */
  readonly where: string;
}): ReadonlyArray<ChapterFinding> => {
  if (!labelsChecked[view]) {
    return [];
  }

  const hidden = Arr.filter(scene.hops, ({ label }) => label === undefined);

  return Arr.map(hidden, ({ hop }) => ({
    key: `label ${view} ${hop.id}`,
    problem: mapWarning({
      file: "layout.json",
      message: `the label of hop "${hop.id}" has no clear spot beside its route${where}${viewNames[view]}, so the drawing leaves it out and it shows only on hover. Move the structures it passes apart, or shorten the label.`,
      path: ["structures"],
    }),
  }));
};

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
          message: `hop "${owner.hop.id}"'s route override runs along the same segment as hop "${other.hop.id}", so the two read as one line. Move the override's points off the other route.`,
          path: ["routes", owner.hop.id],
        }),
      ];
    })
  );
};

/**
 * A finding for each clash in each view's scene of one chapter, except
 * those the older checks cover. The key holds the view as well as the pair,
 * so a pair that clashes in both views warns in both.
 */
const clashFindings = ({
  clashes,
  where,
}: {
  readonly clashes: ReadonlyArray<{
    readonly clashes: ReadonlyArray<SceneClash>;
    readonly view: View;
  }>;
  /** Where the clashes are, such as ` in chapter "c-all"`. */
  readonly where: string;
}): ReadonlyArray<ChapterFinding> =>
  Arr.flatMap(clashes, ({ clashes: drawn, view }) =>
    Arr.flatMap(drawn, ({ between: [first, second] }) =>
      coveredElsewhere(view, first, second)
        ? []
        : [
            {
              key: `${view} ${first} ${second}`,
              problem: mapWarning({
                file: "layout.json",
                message: `${describeThing(first)} is drawn over ${describeThing(second)}${where}${viewNames[view]}. Move the structures apart, so the drawing has room.`,
                path: ["structures"],
              }),
            },
          ]
    )
  );

/**
 * Warnings about each chapter's drawing, as the walkthrough draws it: hops
 * routed around the structures revealed so far, and everything else the
 * Iso view or Plan view would draw over something by the scene's overlap
 * rule (chips, zone titles, labels and routes). Each warning is reported
 * once per view, at the first chapter it shows in.
 */
/** Where a check looks: the whole map, or one chapter's drawing. */
export type CheckScope =
  | { readonly of: "map" }
  | { readonly chapter: string | undefined; readonly of: "chapter" };

const everyChapter: CheckScope = { of: "map" };

/**
 * A warning about one chapter's drawing, and the key `check` reports it once
 * by. A warning another chapter already gave, under the same key, is left out
 * of the later chapter's report.
 */
export interface ChapterFinding {
  readonly key: string;
  readonly problem: MapProblem;
}

const keyedBy =
  (key: (problem: MapProblem) => string) =>
  (problems: ReadonlyArray<MapProblem>): ReadonlyArray<ChapterFinding> =>
    Arr.map(problems, (problem) => ({ key: key(problem), problem }));

const byMessage = keyedBy(({ message }) => message);

/**
 * Every warning about one chapter's drawing, each with its key, before
 * warnings repeated from earlier chapters are dropped.
 */
const findingsOf = (
  { data, layout }: Checkable,
  { id, plays, revealed }: ChapterView,
  scope: CheckScope
): ReadonlyArray<ChapterFinding> => {
  const routes = routeRevealed({ data, layout, revealed });
  const where = id === undefined ? "" : ` in chapter "${id}"`;

  const routing = byMessage(
    Arr.flatMap(data.hops, (hop) => {
      const route = routes[hop.id];

      return route === undefined ? [] : routeWarnings(hop, route);
    })
  );

  const scenes = Arr.map(views, (view) => ({
    scene: sceneOf({
      data,
      labelFirst: plays,
      layout,
      revealed,
      routes,
      view,
    }),
    view,
  }));

  const clashes = clashFindings({
    clashes: Arr.map(scenes, ({ scene, view }) => ({
      clashes: sceneClashes(scene),
      view,
    })),
    where,
  });

  const unlabelled = Arr.flatMap(scenes, ({ scene, view }) =>
    hiddenLabelFindings({ scene, view, where })
  );

  const shared = byMessage(sharedSegments(data, routes));

  // A zone fits the structures revealed so far. `check` leaves this to the
  // whole map's zones; a proposal to a chapter is judged by the zones that
  // chapter draws.
  const zones =
    scope.of === "map"
      ? []
      : byMessage(overlappingZones({ data, layout, revealed, where }));

  return [...routing, ...shared, ...zones, ...clashes, ...unlabelled];
};

/**
 * The chapters' findings as `check` reports them: in chapter order, each
 * warning once, at the first chapter it shows in.
 */
export const firstShown = (
  chapters: ReadonlyArray<ReadonlyArray<ChapterFinding>>
): ReadonlyArray<MapProblem> => {
  const seen = new Set<string>();

  return Arr.flatMap(chapters, (findings) =>
    Arr.flatMap(findings, ({ key, problem }) => {
      if (seen.has(key)) {
        return [];
      }

      seen.add(key);

      return [problem];
    })
  );
};

const chapterWarnings = (data: MapData, layout: Layout, scope: CheckScope) => {
  const shown = Arr.filter(
    chapterViews(data),
    ({ id }) => scope.of === "map" || id === scope.chapter
  );

  return firstShown(
    Arr.map(shown, (view) => findingsOf({ data, layout }, view, scope))
  );
};

/**
 * The checks of `checkLayout` that look at the whole layout, not at any one
 * chapter's drawing. They don't route or draw, so they are quick. `zones` are
 * apart because a chapter judges them by the structures it has revealed.
 */
const layoutWide = (data: MapData, layout: Layout) => {
  const placed = placedStructures(data, layout);

  return {
    others: [
      ...staleEntries(data, layout),
      ...staleRoutes(data, layout),
      ...offEndOverrides(data.hops, layout),
      ...overlaps(placed),
      ...coveredTags(placed),
    ],
    zones: overlappingZones({ data, layout }),
  };
};

/** The layout-wide checks of `checkLayout`, in the order it reports them. */
export const layoutWideProblems: {
  (layout: Layout): (data: MapData) => ReadonlyArray<MapProblem>;
  (data: MapData, layout: Layout): ReadonlyArray<MapProblem>;
} = dual(2, (data: MapData, layout: Layout): ReadonlyArray<MapProblem> => {
  const { others, zones } = layoutWide(data, layout);

  return [...others, ...zones];
});

/**
 * What one chapter's drawing depends on in the layout: the placements of the
 * structures it reveals, and every route override, since the router keeps
 * clear of all of them. Two layouts with the same key draw that chapter the
 * same, so its findings carry over.
 */
const drawnKeyOf = (layout: Layout, { revealed }: ChapterView) =>
  // oxlint-disable-next-line effecttsgo/global-json -- a cache key, never decoded
  JSON.stringify([
    Arr.map(Arr.sort([...revealed], Order.String), (id) => [
      id,
      layout.structures[id] ?? null,
    ]),
    Arr.sort(Rec.toEntries(layout.routes ?? {}), byHop),
  ]);

const byHop = Order.mapInput(
  Order.String,
  ([hop]: readonly [string, unknown]) => hop
);

/** How many chapter drawings a `ChapterDrawings` remembers. */
const findingsKept = 256;

/**
 * Draws one chapter as `check` covers it and returns its findings, with every
 * warning keyed. See `rememberedDrawings`.
 */
export type ChapterDrawings = (
  map: Checkable,
  view: ChapterView
) => ReadonlyArray<ChapterFinding>;

/**
 * A `ChapterDrawings` that remembers each chapter by what it draws. A drag
 * that moves one structure leaves the chapters that don't reveal it alone, so
 * they aren't routed or drawn again. A memory belongs to one map's data: its
 * keys don't name the data.
 */
export const rememberedDrawings = (): ChapterDrawings => {
  const cache = new Map<string, ReadonlyArray<ChapterFinding>>();

  return ({ data, layout }, view) => {
    const key = `${view.id ?? ""}\n${drawnKeyOf(layout, view)}`;
    const cached = cache.get(key);

    if (cached !== undefined) {
      return cached;
    }

    const found = findingsOf({ data, layout }, view, everyChapter);

    // The oldest drawing goes first, so a long drag doesn't keep every spot.
    if (cache.size >= findingsKept) {
      const [oldest] = cache.keys();

      if (oldest !== undefined) {
        cache.delete(oldest);
      }
    }

    cache.set(key, found);

    return found;
  };
};

const drawingsOfData = new WeakMap<MapData, ChapterDrawings>();

/** The chapter drawings of callers that ask again about the same data. */
const drawingsFor = (data: MapData): ChapterDrawings => {
  const found = drawingsOfData.get(data);

  if (found !== undefined) {
    return found;
  }

  const made = rememberedDrawings();

  drawingsOfData.set(data, made);

  return made;
};

/**
 * The warnings from routing and drawing each chapter in both views: routes
 * that share a segment or run under boxes, and anything else the Iso view or
 * Plan view would draw over something in some chapter. This is the slow part
 * of `checkLayout`, so callers ask for it only when they report it.
 */
export const drawingProblems: {
  (layout: Layout): (data: MapData) => ReadonlyArray<MapProblem>;
  (data: MapData, layout: Layout): ReadonlyArray<MapProblem>;
} = dual(2, (data: MapData, layout: Layout): ReadonlyArray<MapProblem> =>
  firstShown(
    Arr.map(chapterViews(data), (view) =>
      drawingsFor(data)({ data, layout }, view)
    )
  )
);

/**
 * Problems with how the layout reads. Errors for route overrides whose ends
 * aren't on their hop's footprints; warnings for entries for structures
 * that no longer exist, route overrides for hops that no longer exist,
 * overrides that share a segment with another route, footprints that
 * overlap, name tags drawn over other boxes, zones that overlap, routes that
 * run under boxes, and anything else the Iso view or Plan view would draw
 * over something in some chapter. A structure with no placement gets nothing, because
 * `build` places it. The first group is `layoutWideProblems`, which is quick,
 * and the drawing warnings are `drawingProblems`, which isn't.
 */
export const checkLayout: {
  (layout: Layout): (data: MapData) => ReadonlyArray<MapProblem>;
  (data: MapData, layout: Layout): ReadonlyArray<MapProblem>;
} = dual(2, (data: MapData, layout: Layout): ReadonlyArray<MapProblem> => [
  ...layoutWideProblems(data, layout),
  ...drawingProblems(data, layout),
]);

/**
 * `checkLayout`, for the drawing of one chapter alone: the layout-wide checks
 * of the whole map except its zones, and the routing, zone and drawing checks
 * of `chapter` as the walkthrough draws it. A proposal to a chapter is judged
 * here against the chapter the engineer is viewing, not every chapter at once.
 */
const checkChapter = (
  map: Checkable,
  chapter: string | undefined
): ReadonlyArray<MapProblem> => [
  ...layoutWide(map.data, map.layout).others,
  ...chapterWarnings(map.data, map.layout, { chapter, of: "chapter" }),
];

const lineOf = (problem: MapProblem) =>
  `${problem.severity} ${problem.file} ${problem.path}: ${problem.message}`;

/** A problem `checkLayout` finds in a dragged layout, and whether the drag made it. */
export interface DraggedProblem {
  /** Whether the layout before the drag didn't have it. */
  readonly added: boolean;
  readonly problem: MapProblem;
}

/** `after`'s problems, each marked `added` when `before` doesn't have it. */
export const markedAdded: {
  (
    before: ReadonlyArray<MapProblem>
  ): (after: ReadonlyArray<MapProblem>) => ReadonlyArray<DraggedProblem>;
  (
    after: ReadonlyArray<MapProblem>,
    before: ReadonlyArray<MapProblem>
  ): ReadonlyArray<DraggedProblem>;
} = dual(
  2,
  (
    after: ReadonlyArray<MapProblem>,
    before: ReadonlyArray<MapProblem>
  ): ReadonlyArray<DraggedProblem> => {
    const known = new Set(Arr.map(before, lineOf));

    return Arr.map(after, (problem) => ({
      added: !known.has(lineOf(problem)),
      problem,
    }));
  }
);

const checked = new WeakMap<
  MapData,
  WeakMap<Layout, ReadonlyArray<MapProblem>>
>();

/**
 * `checkLayout`, remembered for this data and this layout. A proposal asks
 * about the same layout before again at every change, and the check is the
 * slow part.
 */
const checkLayoutOnce = (data: MapData, layout: Layout) => {
  const byLayout = checked.get(data) ?? new WeakMap();
  const found = byLayout.get(layout) ?? checkLayout(data, layout);

  byLayout.set(layout, found);
  checked.set(data, byLayout);

  return found;
};

/** A map as `check` sees it: its meaning and its layout. */
export interface Checkable {
  readonly data: MapData;
  readonly layout: Layout;
}

/**
 * Everything `check` would report for the map `after`, in the order it
 * reports it, each marked `added` when the map `before` didn't have it. It
 * is the check `check` runs, on the map a proposal would leave, so the page
 * lists exactly what `check` would then print, and can set apart what the
 * change made. A proposal can change the data as well as the layout, such as
 * a structure's group, which moves it between zones, so both maps are whole.
 *
 * With a chapter `scope`, it is what `checkChapter` would report for that
 * chapter alone, so a proposal that changes how a chapter draws, such as a
 * new group or a structure revealed in it, is judged by what that chapter
 * shows. A drag the page checks a chapter at a time uses `dragCheckOf`.
 */
export const changedProblems = ({
  after,
  before,
  scope = { of: "map" },
}: {
  readonly after: Checkable;
  readonly before: Checkable;
  readonly scope?: CheckScope;
}): ReadonlyArray<DraggedProblem> =>
  scope.of === "map"
    ? markedAdded(
        checkLayoutOnce(after.data, after.layout),
        checkLayoutOnce(before.data, before.layout)
      )
    : markedAdded(
        checkChapter(after, scope.chapter),
        checkChapter(before, scope.chapter)
      );
