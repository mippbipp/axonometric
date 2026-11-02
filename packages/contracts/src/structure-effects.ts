import { Array as Arr, Option, Record as Rec, String as Str } from "effect";

import { footprintsOverlap } from "./layout-checks.ts";
import type { Layout, Placement } from "./layout.ts";
import type { MapData, Structure } from "./map-data.ts";
import { quoteText } from "./quote.ts";
import { structureOf } from "./structure-change.ts";
import { zonesOf } from "./zones.ts";
import type { NewStructure, StructureChange } from "./structure-change.ts";

/** What a structure the engineer proposes says until the agent writes it. */
export const proposedOneLiner =
  "Proposed on the page. The agent writes this if it accepts the structure.";

export const proposedDetails =
  "Proposed on the page, with no description yet.";

/**
 * A short code for a new structure: the capitals of its first words, or its
 * first letters, one to three of them. The agent sets the real code when it
 * folds the structure into data.mjs.
 */
export const codeOfName = (name: string): string => {
  const words = Arr.filter(Str.split(/[^\p{L}\p{N}]+/u)(name), (w) => w !== "");

  const initials = Arr.join(
    Arr.flatMap(Arr.take(words, 2), (word) => {
      const letter = /\p{L}/u.exec(word)?.[0];

      return letter === undefined || !/^[A-Za-z]$/u.test(letter)
        ? []
        : [Str.toUpperCase(letter)];
    }),
    ""
  );

  return initials === "" ? "N" : initials;
};

/** The structure the map draws for a proposed one. */
export const structureOfNew = (made: NewStructure): Structure => ({
  id: made.id,
  code: codeOfName(made.name),
  name: made.name,
  shape: made.shape,
  group: made.group,
  status: made.status,
  oneLiner: proposedOneLiner,
  whatItDoes: proposedDetails,
  howItsBuilt: proposedDetails,
});

const changeStructure = (
  data: MapData,
  id: string,
  change: (structure: Structure) => Structure
): MapData => ({
  ...data,
  structures: Arr.map(data.structures, (structure) =>
    structure.id === id ? change(structure) : structure
  ),
});

/**
 * `data` with `change` applied, as the page shows it before the agent has
 * decided. A deletion leaves the structure in: the page draws it crossed out.
 */
export const structureChangeToData = (
  data: MapData,
  change: StructureChange
): MapData => {
  switch (change.action) {
    case "add": {
      if (Arr.some(data.structures, ({ id }) => id === change.structure.id)) {
        return data;
      }

      // Reveals add up from the first chapter, so the structure shows in
      // every chapter, not only the one the engineer happens to be in.
      return {
        ...data,
        structures: [...data.structures, structureOfNew(change.structure)],
        chapters: Arr.map(data.chapters, (chapter, index) =>
          index === 0
            ? { ...chapter, reveals: [...chapter.reveals, change.structure.id] }
            : chapter
        ),
      };
    }

    case "delete": {
      return data;
    }

    case "rename": {
      return changeStructure(data, change.structure, (structure) => ({
        ...structure,
        name: change.name,
      }));
    }

    case "shape": {
      return changeStructure(data, change.structure, (structure) => ({
        ...structure,
        shape: change.shape,
      }));
    }

    case "group": {
      return changeStructure(data, change.structure, (structure) => ({
        ...structure,
        group: change.group,
      }));
    }

    case "status": {
      return changeStructure(data, change.structure, (structure) => ({
        ...structure,
        status: change.status,
      }));
    }
  }
};

/** `layout` with a proposed structure placed where it was dropped. */
export const structureChangeToLayout = (
  layout: Layout,
  change: StructureChange
): Layout =>
  change.action === "add" && !Rec.has(layout.structures, change.structure.id)
    ? {
        ...layout,
        structures: { ...layout.structures, [change.structure.id]: change.at },
      }
    : layout;

/** The structures a change adds, removes or alters. */
export interface StructureMarks {
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly changed: readonly string[];
}

export const marksOfStructureChange = (
  change: StructureChange
): StructureMarks => {
  const id = structureOf(change);

  return {
    added: change.action === "add" ? [id] : [],
    removed: change.action === "delete" ? [id] : [],
    changed: change.action === "add" || change.action === "delete" ? [] : [id],
  };
};

/** A footprint in words, such as `x 4, y 2, w 2, d 2`. */
export const describePlacement = ({ x, y, w, d }: Placement) =>
  `x ${x}, y ${y}, w ${w}, d ${d}`;

/**
 * Everything that refers to structure `id`, one phrase each: the hops that
 * start or end at it, the flows that play those hops, the chapters that
 * reveal it or play those hops, and its questions. Labels and titles go
 * through `quoteText`, since they are text the agent reads.
 */
export const referencesTo = (
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

  const questionRefs = Arr.map(
    data.structures.find((structure) => structure.id === id)?.questions ?? [],
    (question) => `question ${question.id} (${question.state}) is about it`
  );

  return [...hopRefs, ...flowRefs, ...chapterRefs, ...questionRefs];
};

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
export const structureBreakage = (
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
};

/**
 * `layout` with the footprint of every structure in `changes` that adds one,
 * so a layout change is checked against the ground proposals will take.
 */
export const layoutWithAdds = (
  layout: Layout,
  changes: readonly StructureChange[]
): Layout =>
  Arr.reduce(changes, layout, (so, change) =>
    structureChangeToLayout(so, change)
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
  const own = Arr.findFirst(data.structures, (structure) => structure.id === id);

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
