import { Array as Arr, Option, Record as Rec } from "effect";

import type { BatchItem, LayoutChange } from "./proposals.ts";
import type { Verdict } from "./proposals.ts";
import { plain, removedMark } from "./review-kind-defaults.ts";
import type { KindSpec, Pointer } from "./review-kinds.ts";
import { decorate } from "./review-quote.ts";
import { actionOf } from "./structure-actions.ts";
import { maxStructureNameLength, structureOf } from "./structure-change.ts";
import {
  structureBreakage,
  structureChangeToData,
  structureChangeToLayout,
} from "./structure-effects.ts";

// The kind for a proposed change to the structures: add, delete, rename, and
// a new shape, group or status. It is one entry of the kind table;
// `review-kinds.ts` lists it.

type StructureItem = Extract<BatchItem, { kind: "structure" }>;

/** Said once, in the prompt and in `review`, when a batch holds a structure item. */
const structureNotice =
  "A structure item changes data.mjs, which only you edit. A new structure comes with a provisional id: add it to data.mjs under that id, or under another and give the verdict changed with --as <id>. Add an accepted new structure to the reveals of the chapter that should show it first, or the last chapter fails to check; until you do, the page shows it in every chapter. commit writes its position to layout.json under the final id.";

/**
 * The id a taken structure item ends up with: the provisional id, or the one
 * the agent gave with `--as`.
 */
const finalIdOf = (item: StructureItem, verdict: Verdict): string =>
  item.change.action === "add" &&
  verdict.verdict === "changed" &&
  verdict.as !== undefined
    ? verdict.as
    : structureOf(item.change);

export const structureKind: KindSpec<StructureItem> = {
  ...plain<StructureItem>(),
  textLimit: maxStructureNameLength,
  listKey: "structures",
  text: ({ change }) =>
    Option.some(
      change.action === "add" ? change.structure.name : structureOf(change)
    ),
  describe: ({ change }, nameOf) =>
    Option.some(
      actionOf(change).describe({
        structure: nameOf,
        group: (id) => id,
      })
    ),
  dangling: ({ change }, known) =>
    change.action === "add" || known.structures.has(structureOf(change))
      ? Option.none()
      : Option.some(
          `no structure in data.mjs has the id "${structureOf(change)}"`
        ),
  notice: structureNotice,
  open: (proposals) =>
    Arr.map(proposals.structures ?? [], (proposal): StructureItem => ({
      id: proposal.id,
      kind: "structure",
      change: proposal.change,
    })),
  clear: (proposals) => ({ ...proposals, structures: [] }),
  add: (proposals, { id, change }) => ({
    ...proposals,
    structures: [...(proposals.structures ?? []), { id, change }],
  }),
  name: ({ change }) => actionOf(change).label,
  targets: ({ change }): readonly Pointer[] => [
    { kind: "structure", id: structureOf(change) },
  ],
  summary: ({ id, change }, nameOf) => actionOf(change).summary(id, nameOf),
  facts: ({ change }, layout, data) =>
    actionOf(change).facts(
      Option.flatMap(Option.fromNullishOr(data), (map) =>
        Arr.findFirst(map.structures, ({ id }) => id === structureOf(change))
      ),
      layout
    ),
  appliesToData: ({ change }, map) => ({
    data: structureChangeToData(map.data, change),
    layout: structureChangeToLayout(map.layout, change),
  }),
  touches: ({ change }) => ({
    structures: [structureOf(change)],
    hops: [],
    marks: {
      [removedMark]: change.action === "delete" ? [structureOf(change)] : [],
    },
  }),
  breakage: ({ change }, landing) =>
    landing.data === undefined
      ? Option.none()
      : structureBreakage(change, { ...landing, data: landing.data }),
  verdictRefusal: (item, verdict, { accepted, taken }) => {
    if (verdict.verdict !== "changed" || verdict.as === undefined) {
      return Option.none();
    }

    const { change } = item;

    if (change.action !== "add") {
      return Option.some(
        "--as gives a new structure the id you used for it in data.mjs. This item does not add a structure."
      );
    }

    if (accepted.has(verdict.as)) {
      return Option.some(
        `--as ${verdict.as} names a structure the accepted map already has. Pick the id of the new structure you added to data.mjs.`
      );
    }

    return Option.map(
      Arr.findFirst(
        [...taken.entries()],
        ([other, id]) => other !== item.id && id === verdict.as
      ),
      ([other]) =>
        `--as ${verdict.as} is already the final id of item ${other} in this batch. Give each new structure its own id.`
    );
  },
  renames: (item, verdict) => {
    if (verdict.verdict === "rejected" || item.change.action !== "add") {
      return [];
    }

    const to = finalIdOf(item, verdict);

    return to === item.change.structure.id
      ? []
      : [[item.change.structure.id, to]];
  },
  retargeted: (item, renames) => {
    const { change } = item;

    if (change.action === "add") {
      return item;
    }

    const to = renames.get(change.structure);

    return to === undefined
      ? item
      : { ...item, change: { ...change, structure: to } };
  },
  applies: (item, verdict, { layout, saved }): readonly LayoutChange[] => {
    const { change } = item;

    if (verdict.verdict === "rejected" || change.action !== "add") {
      return [];
    }

    const id = finalIdOf(item, verdict);
    const placed = Rec.get(layout.structures, id);

    // A structure the agent already placed with `axonometric layout` stays
    // where it put it.
    if (Option.isNone(placed) || Rec.has(saved.structures, id)) {
      return [];
    }

    const target = { kind: "structure" as const, id };
    const { x, y, w, d } = change.at;
    const there = placed.value;

    return [
      ...(there.x === x && there.y === y
        ? []
        : [
            {
              id: `${item.id}-move`,
              kind: "move" as const,
              moves: [{ target, position: { x, y } }] as const,
            },
          ]),
      ...(there.w === w && there.d === d
        ? []
        : [
            {
              id: `${item.id}-size`,
              kind: "resize" as const,
              target,
              footprint: { w, d },
            },
          ]),
    ];
  },
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
  accepted: (item, verdict) => {
    const base = {
      kind: "structure",
      id: item.id,
      change: item.change,
    } as const;

    const final = finalIdOf(item, verdict);

    return decorate(
      item.change.action === "add" && final !== item.change.structure.id
        ? { ...base, as: final }
        : base,
      verdict
    );
  },
  rejected: (item, reason) => ({
    kind: "structure",
    id: item.id,
    change: item.change,
    reason,
  }),
  reopened: (item, newId) => ({ ...item, id: newId }),
};
