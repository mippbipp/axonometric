import { Array as Arr, Match, Option, Record as Rec } from "effect";
import type { Schema } from "effect";

import type { HopEnds } from "./layout-checks.ts";
import type { Layout } from "./layout.ts";
import type { MapData } from "./map-data.ts";
import {
  applyLayoutChanges,
  hopsOf,
  layoutRefusal,
  structuresOf,
  targetIdsOf,
} from "./proposals.ts";
import type {
  BatchItem,
  ChangeId,
  LayoutChange,
  Proposals,
  Verdict,
} from "./proposals.ts";
import {oneLine, quoteText} from "./quote.ts";

export { oneLine, quoteText } from "./quote.ts";

import type { Facts } from "./review-report.ts";
import type { AcceptedItem, RejectedItem } from "./revisions.ts";
import {
  marksOfStructureChange,
  structureBreakage,
  structureChangeToData,
  structureChangeToLayout,
} from "./structure-effects.ts";
import { structureOf } from "./structure-change.ts";



/** What a kind of item needs to know about the map. */
export interface Landing {
  /** The layout the item lands on. */
  readonly layout: Layout;
  /** The ids of the structures data.mjs has. */
  readonly structureIds: ReadonlySet<string>;
  /** The hops data.mjs has, which say where a reroute's ends belong. */
  readonly hops: readonly HopEnds[];
  /** The map's data, which a deletion is checked against. */
  readonly data: Pick<
    MapData,
    "structures" | "hops" | "flows" | "chapters" | "groups"
  >;
}

/** What a commit knows when it takes an item. */
export interface CommitContext {
  /** The layout the commit starts from: `layout.json` with new structures placed. */
  readonly layout: Layout;
  /** `layout.json` as the file holds it. */
  readonly saved: Layout;
  /** The map's data, as the agent left `data.mjs`. */
  readonly data: MapData;
}

/** The two parts of a map that proposals change on the page. */
export interface MapShape {
  readonly data: MapData;
  readonly layout: Layout;
}

/**
 * What an item changes in how the map is drawn: the structures and hops it
 * draws in the pending look, and the structures it draws crossed out.
 */
export interface Touches {
  readonly structures: readonly string[];
  readonly hops: readonly string[];
  /** Structures proposed for deletion, which stay on the map until reviewed. */
  readonly removes: readonly string[];
}

/** An item that draws nothing differently. */
export const touchesNothing: Touches = {
  structures: [],
  hops: [],
  removes: [],
};

/** `--as` names a structure's final id, so it only fits an item that adds one. */
const asRefusal = (verdict: Verdict): Option.Option<string> =>
  verdict.verdict === "changed" && verdict.as !== undefined
    ? Option.some(
        "--as gives a new structure the id you used for it in data.mjs. This item adds no structure."
      )
    : Option.none();

const decorate = <A extends object>(
  base: A,
  verdict: Verdict
): A & { readonly reason?: string; readonly changed?: true } => {
  const withReason =
    "reason" in verdict && verdict.reason !== undefined
      ? { ...base, reason: verdict.reason }
      : base;

  return verdict.verdict === "changed"
    ? { ...withReason, changed: true }
    : withReason;
};

/**
 * Everything the review loop needs to know about one kind of item. A new
 * kind of proposal adds one entry here and its schema: its member of
 * `BatchItem`, its optional list in `Proposals`, and its members of
 * `AcceptedItem` and `RejectedItem`. Nothing else in the loop names a kind.
 *
 * Methods are written as methods, so an entry for one kind also fits the
 * table's generic view of every kind.
 */
// oxlint-disable typescript/method-signature-style -- method signatures are bivariant in their parameters, which lets the table's entries for one kind stand as the generic `KindSpec<BatchItem>`; property signatures would not.
export interface KindSpec<I extends BatchItem> {
  /** The kind's open items: those not in a batch yet. */
  open(proposals: Proposals): readonly I[];
  /** `proposals` without the kind's open items. */
  clear(proposals: Proposals): Proposals;
  /** `proposals` with `item` among the kind's open items. */
  add(proposals: Proposals, item: I): Proposals;
  /** A word for what the item is, such as "move". */
  name(item: I): string;
  /**
   * The ids of what the item acts on or points at: structures, and for a
   * reroute the hop.
   */
  targets(item: I): readonly string[];
  /**
   * One line for the prompt. Text the engineer wrote goes through
   * `quoteText`. `hopLabelOf` gives a hop's label, for a reroute.
   */
  summary(
    item: I,
    nameOf: (id: string) => string,
    hopLabelOf: (id: string) => string
  ): string;
  /** What the item changes, from `layout` and `data`, for `review`. */
  facts(
    item: I,
    layout: Layout,
    data: MapData
  ): { before: Facts; after: Facts };
  /**
   * The map once the item is applied, as the page shows it before the agent
   * has decided. `proposedMap` runs every open and frozen item through this.
   */
  appliesToData(item: I, map: MapShape): MapShape;
  /** What the item changes in the drawing; see `Touches`. */
  touches(item: I): Touches;
  /** Why accepting the item would break the map, or nothing. */
  breakage(item: I, landing: Landing): Option.Option<string>;
  /** The layout changes that take effect when the item gets `verdict`. */
  applies(
    item: I,
    verdict: Verdict,
    context: CommitContext
  ): readonly LayoutChange[];
  /**
   * Why the commit can't take the item with `verdict`, or nothing. Only
   * asked for items that are accepted or changed.
   */
  commitRefusal(
    item: I,
    verdict: Verdict,
    context: CommitContext
  ): Option.Option<string>;
  /**
   * Why `verdict` can't be given to the item, or nothing. Checked when the
   * agent runs `verdict`, before anything is written.
   */
  verdictRefusal(item: I, verdict: Verdict): Option.Option<string>;
  /**
   * The structure ids the item makes new when it is taken with `verdict`,
   * as `[provisional, final]` pairs, when the agent used another id.
   */
  renames(
    item: I,
    verdict: Verdict
  ): readonly (readonly [from: string, to: string])[];
  /**
   * The item with each structure id in `renames` replaced by the id it
   * became, for an item that points at a structure accepted under another id.
   */
  retargeted(item: I, renames: ReadonlyMap<string, string>): I;
  /** The item as a revision records it when taken: accepted or changed. */
  accepted(item: I, verdict: Verdict): AcceptedItem;
  /** The item as a revision records it when rejected. */
  rejected(item: I, reason: string): RejectedItem;
  /** The item again under a new id, for an engineer who edits it after a rejection. */
  reopened(item: I, newId: ChangeId, text: string | undefined): I;
}

type LayoutItem = Extract<BatchItem, { kind: "layout" }>;

type NoteItem = Extract<BatchItem, { kind: "note" }>;

const retargetLayoutChange = (
  change: LayoutChange,
  renames: ReadonlyMap<string, string>
): LayoutChange => {
  const id = (from: string) => renames.get(from) ?? from;

  return Match.value(change).pipe(
    Match.discriminatorsExhaustive("kind")({
      move: (move) => ({
        ...move,
        moves: Arr.map(move.moves, (one) => ({
          ...one,
          target: { ...one.target, id: id(one.target.id) },
        })),
      }),
      resize: (resize) => ({
        ...resize,
        target: { ...resize.target, id: id(resize.target.id) },
      }),
      reroute: (reroute) => reroute,
    })
  );
};

/** Fields of a structure, as `review` prints them. */
const structureFacts = (
  fields: Readonly<Record<string, Schema.Json>>
): Facts => ({ structure: fields });

const positionOf = (
  layout: Layout,
  id: string
): Readonly<Record<string, number>> => {
  const placement = layout.structures[id];

  return placement === undefined
    ? {}
    : { x: placement.x, y: placement.y, w: placement.w, d: placement.d };
};

const positionsOf = (layout: Layout, ids: readonly string[]): Facts => {
  const found = Arr.flatMap(ids, (id) => {
    const placement = layout.structures[id];

    return placement === undefined
      ? []
      : [[id, { x: placement.x, y: placement.y }] as const];
  });

  return Rec.fromEntries(found);
};

const sizeOf = (layout: Layout, id: string): Facts => {
  const placement = layout.structures[id];

  return placement === undefined ? null : { w: placement.w, d: placement.d };
};

/** A hop's route override, or "automatic" when it routes itself. */
const routeOf = (layout: Layout, hop: string): Facts => {
  const points = layout.routes?.[hop];

  return {
    route:
      points === undefined
        ? "automatic"
        : Arr.map(points, ({ x, y }) => ({ x, y })),
  };
};

const layoutKind: KindSpec<LayoutItem> = {
  open: (proposals) =>
    Arr.map(proposals.layout, (change): LayoutItem => ({
      id: change.id,
      kind: "layout",
      change,
    })),
  clear: (proposals) => ({ ...proposals, layout: [] }),
  add: (proposals, item) => ({
    ...proposals,
    layout: [...proposals.layout, item.change],
  }),
  name: (item) => item.change.kind,
  targets: (item) => targetIdsOf(item.change),
  summary: (item, nameOf, hopLabelOf) => {
    const { change } = item;

    if (change.kind === "reroute") {
      return `reroute ${item.id} on ${quoteText(hopLabelOf(change.target.id))}`;
    }

    const names = Arr.map(structuresOf(change), (id) => quoteText(nameOf(id)));

    return `${change.kind} ${item.id}: ${Arr.join(names, ", ")}`;
  },
  appliesToData: (item, map) => ({
    ...map,
    layout: applyLayoutChanges(map.layout, [item.change]),
  }),
  touches: ({ change }) => ({
    structures: structuresOf(change),
    hops: hopsOf(change),
    removes: [],
  }),
  facts: ({ change }, layout) => {
    const next = applyLayoutChanges(layout, [change]);

    return Match.value(change).pipe(
      Match.discriminatorsExhaustive("kind")({
        move: () => ({
          before: positionsOf(layout, structuresOf(change)),
          after: positionsOf(next, structuresOf(change)),
        }),
        resize: ({ target }) => ({
          before: sizeOf(layout, target.id),
          after: sizeOf(next, target.id),
        }),
        reroute: ({ target }) => ({
          before: routeOf(layout, target.id),
          after: routeOf(next, target.id),
        }),
      })
    );
  },
  breakage: (item, { layout, hops }) =>
    layoutRefusal({ accepted: layout, before: [], after: [item.change], hops }),
  commitRefusal: () => Option.none(),
  verdictRefusal: (_item, verdict) => asRefusal(verdict),
  renames: () => [],
  retargeted: (item, renames) => {
    const change = retargetLayoutChange(item.change, renames);

    return change === item.change ? item : { ...item, change };
  },
  // A changed layout item is not applied: the agent set the layout itself.
  applies: (item, { verdict }) => (verdict === "accepted" ? [item.change] : []),
  accepted: (item, verdict) =>
    decorate(
      { kind: "layout", id: item.id, change: item.change } as const,
      verdict
    ),
  rejected: (item, reason) => ({
    kind: "layout",
    id: item.id,
    change: item.change,
    reason,
  }),
  reopened: (item, newId) => ({
    ...item,
    id: newId,
    change: { ...item.change, id: newId },
  }),
};

const noteKind: KindSpec<NoteItem> = {
  open: (proposals) =>
    Arr.map(proposals.notes ?? [], (note): NoteItem => ({
      id: note.id,
      kind: "note",
      target: note.target,
      text: note.text,
    })),
  clear: (proposals) => ({ ...proposals, notes: [] }),
  add: (proposals, { id, target, text }) => ({
    ...proposals,
    notes: [...(proposals.notes ?? []), { id, target, text }],
  }),
  name: () => "note",
  targets: (item) => [item.target.id],
  summary: (item, nameOf) =>
    `note ${item.id} on ${quoteText(nameOf(item.target.id))}: ${quoteText(oneLine(item.text, 80))}`,
  facts: (item) => ({ before: null, after: { text: item.text } }),
  breakage: (item, { structureIds }) =>
    structureIds.has(item.target.id)
      ? Option.none()
      : Option.some(
          `No structure in data.mjs has the id "${item.target.id}", so this note has nothing to point at.`
        ),
  applies: () => [],
  commitRefusal: () => Option.none(),
  verdictRefusal: (_item, verdict) => asRefusal(verdict),
  renames: () => [],
  retargeted: (item, renames) => {
    const id = renames.get(item.target.id);

    return id === undefined ? item : { ...item, target: { ...item.target, id } };
  },
  appliesToData: (_item, map) => map,
  touches: () => touchesNothing,
  accepted: (item, verdict) =>
    decorate(
      {
        kind: "note",
        id: item.id,
        target: item.target,
        text: item.text,
      } as const,
      verdict
    ),
  rejected: (item, reason) => ({
    kind: "note",
    id: item.id,
    target: item.target,
    text: item.text,
    reason,
  }),
  reopened: (item, newId, text) => ({
    ...item,
    id: newId,
    text: text ?? item.text,
  }),
};


type StructureItem = Extract<BatchItem, { kind: "structure" }>;

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

const structureKind: KindSpec<StructureItem> = {
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
  name: ({ change }) =>
    Match.value(change).pipe(
      Match.discriminatorsExhaustive("action")({
        add: () => "add structure",
        delete: () => "delete structure",
        rename: () => "rename structure",
        shape: () => "change shape",
        group: () => "change group",
        status: () => "change status",
      })
    ),
  targets: ({ change }) => [structureOf(change)],
  summary: ({ id, change }, nameOf) => {
    const target = quoteText(nameOf(structureOf(change)));

    return Match.value(change).pipe(
      Match.discriminatorsExhaustive("action")({
        add: ({ structure, at }) =>
          `add structure ${id}: ${quoteText(structure.name)}, shape ${structure.shape}, status ${structure.status}, group ${quoteText(structure.group)}, at x ${at.x}, y ${at.y}, provisional id ${structure.id}`,
        delete: () => `delete structure ${id}: ${target}`,
        rename: ({ name }) =>
          `rename structure ${id}: ${target} to ${quoteText(name)}`,
        shape: ({ shape }) => `change shape ${id}: ${target} to ${shape}`,
        group: ({ group }) =>
          `change group ${id}: ${target} to ${quoteText(group)}`,
        status: ({ status }) => `change status ${id}: ${target} to ${status}`,
      })
    );
  },
  facts: ({ change }, layout, data) => {
    const current = Arr.findFirst(
      data.structures,
      ({ id }) => id === structureOf(change)
    );

    const before = (key: "name" | "shape" | "group" | "status"): Facts =>
      Option.match(current, {
        onNone: () => null,
        onSome: (found) => structureFacts({ [key]: found[key] }),
      });

    return Match.value(change).pipe(
      Match.discriminatorsExhaustive("action")({
        add: ({ structure, at }) => ({
          before: null,
          after: structureFacts({
            id: structure.id,
            name: structure.name,
            shape: structure.shape,
            group: structure.group,
            status: structure.status,
            x: at.x,
            y: at.y,
            w: at.w,
            d: at.d,
          }),
        }),
        delete: () => ({
          before: Option.match(current, {
            onNone: () => null,
            onSome: (found) =>
              structureFacts({
                id: found.id,
                name: found.name,
                shape: found.shape,
                group: found.group,
                status: found.status,
                ...positionOf(layout, found.id),
              }),
          }),
          after: structureFacts({ deleted: true }),
        }),
        rename: ({ name }) => ({
          before: before("name"),
          after: structureFacts({ name }),
        }),
        shape: ({ shape }) => ({
          before: before("shape"),
          after: structureFacts({ shape }),
        }),
        group: ({ group }) => ({
          before: before("group"),
          after: structureFacts({ group }),
        }),
        status: ({ status }) => ({
          before: before("status"),
          after: structureFacts({ status }),
        }),
      })
    );
  },
  appliesToData: ({ change }, map) => ({
    data: structureChangeToData(map.data, change),
    layout: structureChangeToLayout(map.layout, change),
  }),
  touches: ({ change }) => {
    const marks = marksOfStructureChange(change);

    return {
      structures: [...marks.added, ...marks.removed, ...marks.changed],
      hops: [],
      removes: marks.removed,
    };
  },
  breakage: ({ change }, landing) => structureBreakage(change, landing),
  verdictRefusal: ({ change }, verdict) =>
    verdict.verdict === "changed" &&
    verdict.as !== undefined &&
    change.action !== "add"
      ? Option.some(
          "--as gives a new structure the id you used for it in data.mjs. This item does not add a structure."
        )
      : Option.none(),
  renames: (item, verdict) => {
    if (verdict.verdict === "rejected" || item.change.action !== "add") {
      return [];
    }

    const to = finalIdOf(item, verdict);

    return to === item.change.structure.id ? [] : [[item.change.structure.id, to]];
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
  accepted: (item, verdict) =>
    decorate(
      {
        kind: "structure",
        id: item.id,
        change: item.change,
        ...(item.change.action === "add" &&
        finalIdOf(item, verdict) !== item.change.structure.id
          ? { as: finalIdOf(item, verdict) }
          : {}),
      } as const,
      verdict
    ),
  rejected: (item, reason) => ({
    kind: "structure",
    id: item.id,
    change: item.change,
    reason,
  }),
  reopened: (item, newId) => ({ ...item, id: newId }),
};

/**
 * The table: one entry for every `kind` of `BatchItem`. It is typed by that
 * union, so a kind added there without an entry here fails to compile.
 */
export const kindTable = {
  // Structures come first: a layout change may act on a structure that a
  // structure item adds, so the list applies structure items before it.
  structure: structureKind,
  layout: layoutKind,
  note: noteKind,
} satisfies {
  readonly [K in BatchItem["kind"]]: KindSpec<Extract<BatchItem, { kind: K }>>;
};

/** The table seen through `BatchItem`, for code that handles any kind. */
const kinds: Readonly<Record<BatchItem["kind"], KindSpec<BatchItem>>> =
  kindTable;

/** The entry for `item`'s kind. */
export const specOf = (item: BatchItem): KindSpec<BatchItem> =>
  kinds[item.kind];

/** Every entry, in the order the page lists kinds. */
export const allKinds: readonly KindSpec<BatchItem>[] = Rec.values(kinds);
