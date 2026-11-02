import { Array as Arr, Option, Order, Record as Rec } from "effect";
import { dual } from "effect/Function";

import { changedProblems, footprintsOverlap } from "./layout-checks.ts";
import type { Checkable, DraggedProblem } from "./layout-checks.ts";
import type { Layout, Placement } from "./layout.ts";
import type { MapData, Structure } from "./map-data.ts";
import { defaultFootprint, placeStructures } from "./placement.ts";
import { quoteText } from "./review-quote.ts";
import { actionOf, structureOfNew } from "./structure-actions.ts";
import type { StructureChange } from "./structure-change.ts";
import { zonesOf } from "./zones.ts";

/**
 * `data` with `change` applied, as the page shows it before the agent has
 * decided. A deletion leaves the structure in: the page draws it crossed out.
 * A proposed structure is not added to any chapter's reveals; the page shows
 * it in every chapter on its own.
 */
export const structureChangeToData: {
  (change: StructureChange): (data: MapData) => MapData;
  (data: MapData, change: StructureChange): MapData;
} = dual(2, (data: MapData, change: StructureChange): MapData =>
  actionOf(change).toData(data)
);

/** `layout` with a proposed structure placed where it was dropped. */
export const structureChangeToLayout: {
  (change: StructureChange): (layout: Layout) => Layout;
  (layout: Layout, change: StructureChange): Layout;
} = dual(2, (layout: Layout, change: StructureChange): Layout =>
  change.action === "add" && !Rec.has(layout.structures, change.structure.id)
    ? {
        ...layout,
        structures: {
          ...layout.structures,
          [change.structure.id]: change.at,
        },
      }
    : layout
);

/** A footprint in words, such as `x 4, y 2, w 2, d 2`. */
export const describePlacement = ({ x, y, w, d }: Placement) =>
  `x ${x}, y ${y}, w ${w}, d ${d}`;

/**
 * Everything that refers to structure `id`, one phrase each: the hops that
 * start or end at it, the flows that play those hops, the chapters that
 * reveal it or play those hops, and its questions. Labels and titles go
 * through `quoteText`, since they are text the agent reads.
 */
export const referencesTo: {
  (
    id: string
  ): (
    data: Pick<MapData, "structures" | "hops" | "flows" | "chapters">
  ) => readonly string[];
  (
    data: Pick<MapData, "structures" | "hops" | "flows" | "chapters">,
    id: string
  ): readonly string[];
} = dual(
  2,
  (
    data: Pick<MapData, "structures" | "hops" | "flows" | "chapters">,
    id: string
  ): readonly string[] => {
    const hops = Arr.filter(
      data.hops,
      ({ from, to }) => from === id || to === id
    );

    const hopIds = new Set(Arr.map(hops, (hop) => hop.id));

    const hopRefs = Arr.map(
      hops,
      (hop) =>
        `hop ${hop.id} (${quoteText(hop.label)}) ${hop.from === id ? "starts" : "ends"} at it`
    );

    const flowRefs = Arr.flatMap(data.flows, (flow) => {
      const used = Arr.filter(flow.hops, (hop) => hopIds.has(hop));

      return used.length === 0
        ? []
        : [
            `flow ${flow.id} (${quoteText(flow.name)}) plays ${Arr.join(used, ", ")}`,
          ];
    });

    const chapterRefs = Arr.flatMap(data.chapters, (chapter) => {
      const played = Arr.filter(chapter.plays, (hop) => hopIds.has(hop));

      return [
        ...(chapter.reveals.includes(id)
          ? [`chapter ${chapter.id} (${quoteText(chapter.title)}) reveals it`]
          : []),
        ...(played.length === 0
          ? []
          : [
              `chapter ${chapter.id} (${quoteText(chapter.title)}) plays ${Arr.join(played, ", ")}`,
            ]),
      ];
    });

    const questions = Option.getOrElse(
      Option.flatMapNullishOr(
        Arr.findFirst(data.structures, (structure) => structure.id === id),
        ({ questions: held }) => held
      ),
      () => []
    );

    const questionRefs = Arr.map(
      questions,
      (question) => `question ${question.id} (${question.state}) is about it`
    );

    return [...hopRefs, ...flowRefs, ...chapterRefs, ...questionRefs];
  }
);

/** What `structureBreakage` needs to know about the map. */
export interface StructureLanding {
  readonly layout: Layout;
  readonly structureIds: ReadonlySet<string>;
  /** The map's data, which a deletion is checked against. */
  readonly data: Pick<
    MapData,
    "structures" | "hops" | "flows" | "chapters" | "groups"
  >;
}

const unknownGroup = (
  data: StructureLanding["data"],
  group: string
): Option.Option<string> =>
  Arr.some(data.groups, ({ id }) => id === group)
    ? Option.none()
    : Option.some(
        `No group in data.mjs has the id ${quoteText(group)}. Add the group first, or put the structure in one that exists.`
      );

/**
 * Why accepting `change` would break the map, or nothing when it wouldn't.
 *
 * - A change to a structure needs the structure in data.mjs.
 * - A new structure needs a group data.mjs has and a free spot.
 * - A deletion breaks the map when hops, flows, chapters or questions still
 *   refer to the structure; each reference is named.
 */
export const structureBreakage: {
  (
    landing: StructureLanding
  ): (change: StructureChange) => Option.Option<string>;
  (change: StructureChange, landing: StructureLanding): Option.Option<string>;
} = dual(
  2,
  (
    change: StructureChange,
    { layout, structureIds, data }: StructureLanding
  ): Option.Option<string> => {
    if (change.action === "add") {
      const { structure: made, at } = change;

      return Option.orElse(unknownGroup(data, made.group), () =>
        Option.map(
          Arr.findFirst(
            Rec.toEntries(layout.structures),
            ([id, placement]) =>
              id !== made.id && footprintsOverlap(at, placement)
          ),
          ([id, placement]) =>
            `${made.id} at ${describePlacement(at)} would overlap "${id}" at ${describePlacement(placement)}. Place it with axonometric layout, then give the verdict changed.`
        )
      );
    }

    const id = change.structure;

    if (!structureIds.has(id)) {
      return Option.some(
        `No structure in data.mjs has the id "${id}", so this ${change.action} has nothing to act on.`
      );
    }

    if (change.action === "group") {
      return unknownGroup(data, change.group);
    }

    if (change.action === "delete") {
      const references = referencesTo(data, id);

      return references.length === 0
        ? Option.none()
        : Option.some(
            `Deleting "${id}" would leave ${references.length} ${references.length === 1 ? "reference" : "references"} to a structure that is gone: ${Arr.join(references, "; ")}.`
          );
    }

    return Option.none();
  }
);

/**
 * The group whose zone a structure dropped at `at` lands in, when that is
 * not the group it is in, or nothing. The zones are those of the other
 * structures, so the structure itself neither stretches its own zone nor
 * the one it is dropped in. A drop is in a zone when the footprint's centre
 * is inside it. A drop in the structure's own zone, or in none, is a layout
 * change only.
 */
export const droppedIntoGroup = ({
  data,
  layout,
  id,
  at,
  revealed,
}: {
  readonly data: Pick<MapData, "groups" | "structures">;
  readonly layout: Layout;
  readonly id: string;
  readonly at: Placement;
  readonly revealed?: ReadonlySet<string> | undefined;
}): Option.Option<string> => {
  const own = Arr.findFirst(
    data.structures,
    (structure) => structure.id === id
  );

  if (Option.isNone(own)) {
    return Option.none();
  }

  const zones = zonesOf({
    data,
    layout: { ...layout, structures: Rec.remove(layout.structures, id) },
    revealed,
  });

  const centre = { x: at.x + at.w / 2, y: at.y + at.d / 2 };

  const inside = Arr.filter(
    zones,
    ({ box }) =>
      centre.x >= box.x &&
      centre.x <= box.x + box.w &&
      centre.y >= box.y &&
      centre.y <= box.y + box.d
  );

  return Arr.some(inside, ({ group }) => group.id === own.value.group)
    ? Option.none()
    : Option.map(Arr.head(inside), ({ group }) => group.id);
};

/** The id `defaultSpotFor` gives the structure it tries at each spot. */
const probeId = "__spot-probe__";

/** How far from the group's zone, in grid units, `defaultSpotFor` looks. */
export const defaultSpotRadius = 12;

/** The most spots `defaultSpotFor` runs the full checks on. */
const checkedSpots = 300;

/** Where a new structure goes when the engineer hasn't picked a spot. */
export interface DefaultSpot {
  readonly spot: Placement;
  /**
   * How many warnings the proposed map gains from a structure at `spot`.
   * Nothing is the aim; more than that means no spot within reach was clear.
   */
  readonly added: number;
}

/** The gap between two ground rectangles, 0 when they touch or overlap. */
const gapBetween = (a: Placement, b: Placement): number =>
  Math.hypot(
    Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w), 0),
    Math.max(b.y - (a.y + a.d), a.y - (b.y + b.d), 0)
  );

const centreGap = (a: Placement, b: Placement): number =>
  Math.hypot(a.x + a.w / 2 - (b.x + b.w / 2), a.y + a.d / 2 - (b.y + b.d / 2));

/**
 * Where a new structure called `name`, of `shape`, in group `group` goes if
 * the engineer doesn't pick a spot: the nearest spot to the group's zone, on
 * the half-unit grid, where the proposed map gains no `check` warning. A
 * spot inside the zone's bounds is the best. The search is the one the
 * warnings panel makes: it adds the structure to `data` and `layout`, the
 * map as proposed, and asks `changedProblems` what is new. When no spot
 * within `defaultSpotRadius` adds nothing, it is the one that adds the
 * fewest, and `added` says how many.
 */
export const defaultSpotFor = ({
  data,
  layout,
  group,
  shape,
  name,
}: {
  readonly data: MapData;
  readonly layout: Layout;
  readonly group: string;
  readonly shape: Structure["shape"];
  readonly name: string;
}): DefaultSpot => {
  // The structure the page would draw for this add, code and all: the name
  // tag holds the code, so a probe with another code is checked at another
  // width.
  const probe: Structure = structureOfNew(
    { id: probeId, name, shape, group, status: "planned" },
    new Set(Arr.map(data.structures, ({ code }) => code))
  );

  const withProbe: MapData = {
    ...data,
    structures: [...data.structures, probe],
  };

  const before: Checkable = { data, layout };

  const addedAt = (spot: Placement): number =>
    Arr.filter(
      changedProblems(
        {
          data: withProbe,
          layout: {
            ...layout,
            structures: { ...layout.structures, [probeId]: spot },
          },
        },
        before
      ),
      ({ added }) => added
    ).length;

  const beside: Placement = {
    ...defaultFootprint,
    ...(placeStructures(withProbe, layout).layout.structures[probeId] ?? {
      x: 0,
      y: 0,
    }),
  };

  const base = Option.match(
    Arr.findFirst(zonesOf({ data, layout }), (zone) => zone.group.id === group),
    { onNone: () => beside, onSome: ({ box }) => box }
  );

  const { w, d } = defaultFootprint;
  const others = Rec.values(layout.structures);
  const columns = Math.ceil((base.w + w + 2 * defaultSpotRadius) / 0.5);
  const rows = Math.ceil((base.d + d + 2 * defaultSpotRadius) / 0.5);

  const grid = Arr.flatMap(Arr.range(0, columns), (column) =>
    Arr.map(Arr.range(0, rows), (row): Placement => ({
      x: base.x - w - defaultSpotRadius + column * 0.5,
      y: base.y - d - defaultSpotRadius + row * 0.5,
      w,
      d,
    }))
  );

  const nearest = Arr.sort(
    Arr.filter(
      grid,
      (spot) =>
        gapBetween(spot, base) <= defaultSpotRadius &&
        !Arr.some(others, (other) => footprintsOverlap(spot, other))
    ),
    Order.combine(
      Order.mapInput(Order.Number, (spot: Placement) => gapBetween(spot, base)),
      Order.mapInput(Order.Number, (spot: Placement) => centreGap(spot, base))
    )
  );

  let best: DefaultSpot | undefined;

  for (const spot of nearest.slice(0, checkedSpots)) {
    const added = addedAt(spot);

    if (best === undefined || added < best.added) {
      best = { spot, added };
    }

    if (added === 0) {
      break;
    }
  }

  return best ?? { spot: beside, added: addedAt(beside) };
};

/**
 * Everything `check` would report for the map as proposed with `changes`
 * added, each marked `added` when the map as proposed now didn't have it.
 * This is the check a drag runs, on the proposed map instead of the accepted
 * one, so a new structure, or a group change, that stretches a zone over
 * another group is reported the same way a drag that does it is.
 *
 * `moved` puts structures where a drop has just put them before the changes
 * apply, so a group change from a drop is judged at the structure's new
 * spot, in the zone it lands in. The map `before` is the one without them.
 */
export const candidateProblems = ({
  before,
  changes,
  moved = {},
}: {
  /** The map as proposed now. */
  readonly before: Checkable;
  /** The changes about to be proposed. */
  readonly changes: readonly StructureChange[];
  /** Structures a drop has just moved, by id. */
  readonly moved?: Readonly<Record<string, Placement>>;
}): readonly DraggedProblem[] => {
  const from: Checkable = {
    data: before.data,
    layout: {
      ...before.layout,
      structures: { ...before.layout.structures, ...moved },
    },
  };

  return changedProblems(Arr.reduce(changes, from, applyStructureChange), from);
};

const applyStructureChange = (
  map: Checkable,
  change: StructureChange
): Checkable => ({
  data: structureChangeToData(map.data, change),
  layout: structureChangeToLayout(map.layout, change),
});
