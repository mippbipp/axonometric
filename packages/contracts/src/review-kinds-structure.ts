import { Array as Arr, Match, Option, Record as Rec } from "effect";

import type { Layout, Placement } from "./layout.ts";
import type { MapData } from "./map-data.ts";
import { placeStructures } from "./placement.ts";
import type { BatchItem, LayoutChange, Verdict } from "./proposals.ts";
import { followed, provisionalOf } from "./provisional-ids.ts";
import { plain, removedMark } from "./review-kind-defaults.ts";
import type { KindSpec, Pointer } from "./review-kinds.ts";
import { decorate } from "./review-quote.ts";
import { actionOf } from "./structure-actions.ts";
import {
  maxStructureNameLength,
  StructureName,
  structureOf,
} from "./structure-change.ts";
import {
  structureBreakage,
  structureChangeToData,
  structureChangeToLayout,
} from "./structure-effects.ts";
import { refusalOf } from "./text-schemas.ts";

// The kind for a proposed change to the structures: add, delete, rename, and
// a new shape, group or status. It is one entry of the kind table;
// `review-kinds.ts` lists it.

type StructureItem = Extract<BatchItem, { kind: "structure" }>;

/** Said once, in the prompt and in `review`, when a batch holds a structure item. */
const structureNotice =
  "A structure item changes data.mjs, which only you edit. A new structure comes with a provisional id: add it to data.mjs under that id, or under another and give the verdict changed with --as <id>. Add an accepted new structure to the reveals of the chapter that should show it first, or the last chapter fails to check; until you do, the page shows it in every chapter. commit writes its position to layout.json under the final id.";

/** What the structure kind adds under a provisional id, and how it says so. */
const provisional = provisionalOf<StructureItem>({
  adds: ({ change }) =>
    change.action === "add" ? Option.some(change.structure.id) : Option.none(),
  entity: "structure",
  noun: "structure",
});

/**
 * The id a taken structure item ends up with: the provisional id, or the one
 * the agent gave with `--as`.
 */
const finalIdOf = (item: StructureItem, verdict: Verdict): string =>
  Option.getOrElse(provisional.finalIdOf(item, verdict), () =>
    structureOf(item.change)
  );

/** Whether `kept`, the spot layout.json holds for `id`, is where `build` puts it. */
const isAutoPlaced = ({
  data,
  id,
  kept,
  saved,
}: {
  readonly data: MapData;
  readonly id: string;
  readonly kept: Placement;
  readonly saved: Layout;
}): boolean => {
  const unplaced: Layout = {
    ...saved,
    structures: Rec.remove(saved.structures, id),
  };

  const auto = placeStructures(data, unplaced).layout.structures[id];

  return (
    auto !== undefined &&
    auto.x === kept.x &&
    auto.y === kept.y &&
    auto.w === kept.w &&
    auto.d === kept.d
  );
};

/**
 * The name the engineer wrote, in the changes that hold one: an add and a
 * rename. The other changes are choices from a list and have no text to edit.
 */
const textOfChange = (change: StructureItem["change"]): Option.Option<string> =>
  Match.value(change).pipe(
    Match.when({ action: "add" }, ({ structure }) =>
      Option.some(structure.name)
    ),
    Match.when({ action: "rename" }, ({ name }) => Option.some(name)),
    Match.orElse(() => Option.none<string>())
  );

export const structureKind: KindSpec<StructureItem> = {
  ...plain<StructureItem>(),
  accepted: (item, verdict) => {
    const base = {
      change: item.change,
      id: item.id,
      kind: "structure",
    } as const;

    const final = finalIdOf(item, verdict);

    return decorate(
      item.change.action === "add" && final !== item.change.structure.id
        ? { ...base, as: final }
        : base,
      verdict
    );
  },
  add: (proposals, { change, id }) => ({
    ...proposals,
    structures: [...(proposals.structures ?? []), { change, id }],
  }),
  applies: (
    item,
    verdict,
    { data, layout, saved }
  ): ReadonlyArray<LayoutChange> => {
    const { change } = item;

    if (verdict.verdict === "rejected" || change.action !== "add") {
      return [];
    }

    const id = finalIdOf(item, verdict);
    const placed = Rec.get(layout.structures, id);

    if (Option.isNone(placed)) {
      return [];
    }

    // A structure the agent placed with `axonometric layout` stays where it
    // put it. A spot in layout.json is not proof of that: `build` and the
    // server place a new structure there too. So the saved spot counts as
    // the agent's only when it differs from where `placeStructures` puts the
    // structure unaided, which a rebuild before or after `verdict` can't
    // change.
    const kept = Rec.get(saved.structures, id);

    if (
      Option.isSome(kept) &&
      !isAutoPlaced({ data, id, kept: kept.value, saved })
    ) {
      return [];
    }

    const target = { id, kind: "structure" as const };
    const { d, w, x, y } = change.at;
    const there = placed.value;

    return [
      ...(there.x === x && there.y === y
        ? []
        : [
            {
              by: "engineer" as const,
              id: `${item.id}-move`,
              kind: "move" as const,
              moves: [{ position: { x, y }, target }] as const,
            },
          ]),
      ...(there.w === w && there.d === d
        ? []
        : [
            {
              by: "engineer" as const,
              footprint: { d, w },
              id: `${item.id}-size`,
              kind: "resize" as const,
              target,
            },
          ]),
    ];
  },
  appliesToData: ({ change }, map) => ({
    data: structureChangeToData(map.data, change),
    layout: structureChangeToLayout(map.layout, change),
  }),
  breakage: ({ change }, landing) =>
    landing.data === undefined
      ? Option.none()
      : structureBreakage(change, { ...landing, data: landing.data }),
  clear: (proposals) => ({ ...proposals, structures: [] }),
  commitRefusal: (item, verdict, { data }) => {
    const { change } = item;

    if (verdict.verdict === "rejected") {
      return Option.none();
    }

    if (change.action === "add") {
      const id = finalIdOf(item, verdict);

      return Arr.some(data.structures, (structure) => structure.id === id)
        ? Option.none()
        : Option.some(
            `data.mjs has no structure with the id "${id}", so item ${item.id} can't be taken. Add the structure to data.mjs${id === change.structure.id ? `, or give the id you used with: verdict ... changed --as <id>` : ""}. Or reject the item.`
          );
    }

    return change.action === "delete" &&
      verdict.verdict === "accepted" &&
      Arr.some(data.structures, ({ id }) => id === change.structure)
      ? Option.some(
          `data.mjs still has the structure "${change.structure}", so item ${item.id} can't be taken as accepted. Remove it from data.mjs, with what refers to it, or reject the item.`
        )
      : Option.none();
  },
  dangling: ({ change }, known) =>
    change.action === "add" || known.structures.has(structureOf(change))
      ? Option.none()
      : Option.some(
          `no structure in data.mjs has the id "${structureOf(change)}"`
        ),
  describe: ({ change }, called) =>
    Option.some(
      actionOf(change).describe({
        group: called.group,
        structure: called.structure,
      })
    ),
  facts: ({ change }, layout, data) =>
    actionOf(change).facts(
      Option.flatMap(Option.fromNullishOr(data), (map) =>
        Arr.findFirst(map.structures, ({ id }) => id === structureOf(change))
      ),
      layout
    ),
  listKey: "structures",
  name: ({ change }) => actionOf(change).label,
  notice: structureNotice,
  open: (proposals) =>
    Arr.map(proposals.structures ?? [], (proposal): StructureItem => ({
      change: proposal.change,
      id: proposal.id,
      kind: "structure",
    })),
  rejected: (item, reason) => ({
    change: item.change,
    id: item.id,
    kind: "structure",
    reason,
  }),
  renames: provisional.renames,
  reopened: (item, newId, text) => ({
    ...item,
    change:
      text === undefined
        ? item.change
        : Match.value(item.change).pipe(
            Match.when({ action: "add" }, (change) => ({
              ...change,
              structure: { ...change.structure, name: text },
            })),
            Match.when({ action: "rename" }, (change) => ({
              ...change,
              name: text,
            })),
            Match.orElse((change) => change)
          ),
    id: newId,
  }),
  retargeted: (item, renames) => {
    const { change } = item;

    // A structure that goes into a new group follows the id the agent gave
    // the group.
    const groupId = (group: string) => followed(renames, "group", group);

    if (change.action === "add") {
      const group = groupId(change.structure.group);

      return group === change.structure.group
        ? item
        : {
            ...item,
            change: { ...change, structure: { ...change.structure, group } },
          };
    }

    const to = followed(renames, "structure", change.structure);

    if (change.action === "group") {
      return {
        ...item,
        change: { ...change, group: groupId(change.group), structure: to },
      };
    }

    return to === change.structure
      ? item
      : { ...item, change: { ...change, structure: to } };
  },
  summary: ({ change, id }, called) =>
    actionOf(change).summary(id, called.structure),
  targets: ({ change }): ReadonlyArray<Pointer> => [
    { id: structureOf(change), kind: "structure" },
  ],
  text: ({ change }) => textOfChange(change),
  textLimit: maxStructureNameLength,
  textRefusal: ({ change }, text) =>
    Option.isNone(textOfChange(change))
      ? Option.none()
      : refusalOf(StructureName, text),
  touches: ({ change }) => ({
    hops: [],
    marks: [
      {
        ids: change.action === "delete" ? [structureOf(change)] : [],
        name: removedMark,
      },
    ],
    structures: [structureOf(change)],
  }),
  verdictRefusal: provisional.verdictRefusal,
};
