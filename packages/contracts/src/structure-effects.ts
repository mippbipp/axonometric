import { Array as Arr, Option, Record as Rec } from "effect";
import { dual } from "effect/Function";

import { footprintsOverlap } from "./layout-checks.ts";
import type { Layout, Placement } from "./layout.ts";
import type { MapData } from "./map-data.ts";
import { quoteText } from "./quote.ts";
import { actionOf } from "./structure-actions.ts";
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
  actionOf(change).toData(change, data)
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
