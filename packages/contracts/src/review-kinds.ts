import { Array as Arr, Match, Option, Record as Rec } from "effect";

import type { HopEnds } from "./layout-checks.ts";
import type { Layout } from "./layout.ts";
import type { MapData } from "./map-data.ts";
import {
  applyLayoutChanges,
  layoutRefusal,
  maxNoteLength,
  hopsOf,
  structuresOf,
} from "./proposals.ts";
import type {
  BatchItem,
  ChangeId,
  LayoutChange,
  Proposals,
  Verdict,
} from "./proposals.ts";
import {
  answerKind,
  questionKind,
  suggestionKind,
} from "./review-kinds-text.ts";
import { decorate, oneLine, quoteText } from "./review-quote.ts";
import type { Facts } from "./review-report.ts";
import type { AcceptedItem, RejectedItem } from "./revisions.ts";

export { oneLine, quoteText } from "./review-quote.ts";

/** A structure or a hop, named by its id. */
export interface Pointer {
  readonly kind: "structure" | "hop";
  readonly id: string;
}

/** The ids of what data.mjs has, for an item to check its pointers against. */
export interface Existing {
  readonly structures: ReadonlySet<string>;
  readonly hops: ReadonlySet<string>;
}

/** An item still waiting on the agent, and the batch it is in, if any. */
export interface Waiting {
  readonly item: BatchItem;
  /** The number of the batch holding the item, or nothing while it is open. */
  readonly batch: number | undefined;
}

/** What a kind of item needs to know about the map. */
export interface Landing {
  /** The layout the item lands on. */
  readonly layout: Layout;
  /** The ids of the structures data.mjs has. */
  readonly structureIds: ReadonlySet<string>;
  /** The hops data.mjs has, which say where a reroute's ends belong. */
  readonly hops: readonly HopEnds[];
  /**
   * The map as data.mjs has it now, for the kinds that point into its text,
   * such as a suggestion or an answer. Left out where the caller has only
   * the ids; those kinds then check what they can.
   */
  readonly data?: MapData | undefined;
}

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
  /** What the item acts on or points at: structures and hops, each told apart by kind. */
  targets(item: I): readonly Pointer[];
  /** The key of the kind's open list in `proposals.json`, for a warning's path. */
  readonly listKey: string;
  /** The text the engineer wrote in the item, or nothing for a kind with none. */
  text(item: I): Option.Option<string>;
  /**
   * The item in a few words for the Pending tab, or nothing for a kind the
   * page describes itself, such as a layout change.
   */
  describe(
    item: I,
    nameOf: (id: string) => string,
    hopLabelOf: (id: string) => string
  ): Option.Option<string>;
  /**
   * Why the item points at a structure or hop that data.mjs lacks, or
   * nothing. `check` warns with it for the item.
   */
  dangling(item: I, known: Existing): Option.Option<string>;
  /**
   * One line for the prompt. Text the engineer wrote goes through
   * `quoteText`. `hopLabelOf` gives a hop's label, for a reroute.
   */
  summary(
    item: I,
    nameOf: (id: string) => string,
    hopLabelOf: (id: string) => string
  ): string;
  /**
   * What the item changes, from `layout` and, for the kinds that point into
   * its text, `data`, for `review`.
   */
  facts(
    item: I,
    layout: Layout,
    data?: MapData
  ): { before: Facts; after: Facts };
  /** Why accepting the item would break the map, or nothing. */
  breakage(item: I, landing: Landing): Option.Option<string>;
  /** The layout changes that take effect when the item gets `verdict`. */
  applies(item: I, verdict: Verdict): readonly LayoutChange[];
  /** The item as a revision records it when taken: accepted or changed. */
  accepted(item: I, verdict: Verdict): AcceptedItem;
  /** The item as a revision records it when rejected. */
  rejected(item: I, reason: string): RejectedItem;
  /** The item again under a new id, for an engineer who edits it after a rejection. */
  reopened(item: I, newId: ChangeId, text: string | undefined): I;
  /** The most characters the kind's text holds. */
  readonly textLimit: number;
  /**
   * Why the item was written against something data.mjs no longer says, or
   * nothing. Unlike `breakage`, accepting it would not break the map; the
   * agent should know before it judges the item.
   */
  outOfDate?(item: I, data: MapData): Option.Option<string>;
  /**
   * Why `item` can't join the items still waiting on the agent (`waiting`:
   * open, or in a batch with no commit), or nothing. One answer per question,
   * say.
   */
  clash?(item: I, waiting: readonly Waiting[]): Option.Option<string>;
  /**
   * A line for the prompt and for `review` that tells the agent how to
   * fold this kind in, said once when the batch holds an item of the kind.
   */
  notice?: string;
}

type LayoutItem = Extract<BatchItem, { kind: "layout" }>;

type NoteItem = Extract<BatchItem, { kind: "note" }>;

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
  textLimit: Number.POSITIVE_INFINITY,
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
  listKey: "layout",
  text: () => Option.none(),
  describe: () => Option.none(),
  // `check` already warns about layout changes, with the change's own wording.
  dangling: () => Option.none(),
  targets: ({ change }) => [
    ...Arr.map(structuresOf(change), (id): Pointer => ({
      kind: "structure",
      id,
    })),
    ...Arr.map(hopsOf(change), (id): Pointer => ({ kind: "hop", id })),
  ],
  summary: (item, nameOf, hopLabelOf) => {
    const { change } = item;

    if (change.kind === "reroute") {
      return `reroute ${item.id} on ${quoteText(hopLabelOf(change.target.id))}`;
    }

    const names = Arr.map(structuresOf(change), (id) => quoteText(nameOf(id)));

    return `${change.kind} ${item.id}: ${Arr.join(names, ", ")}`;
  },
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
  textLimit: maxNoteLength,
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
  listKey: "notes",
  text: ({ text }) => Option.some(text),
  describe: ({ target, text }, nameOf, hopLabelOf) =>
    Option.some(
      Match.value(target).pipe(
        Match.discriminatorsExhaustive("kind")({
          structure: ({ id }) => `Note on ${nameOf(id)}: ${text}`,
          hop: ({ id }) => `Note on hop ${hopLabelOf(id)}: ${text}`,
          spot: ({ x, y }) => `Note at the spot ${x}, ${y}: ${text}`,
        })
      )
    ),
  dangling: ({ target }, known) =>
    Match.value(target).pipe(
      Match.discriminatorsExhaustive("kind")({
        structure: ({ id }) =>
          known.structures.has(id)
            ? Option.none()
            : Option.some(`no structure in data.mjs has the id "${id}"`),
        hop: ({ id }) =>
          known.hops.has(id)
            ? Option.none()
            : Option.some(`no hop in data.mjs has the id "${id}"`),
        spot: () => Option.none(),
      })
    ),
  targets: ({ target }): readonly Pointer[] =>
    Match.value(target).pipe(
      Match.discriminatorsExhaustive("kind")({
        structure: ({ id }): readonly Pointer[] => [{ kind: "structure", id }],
        hop: ({ id }): readonly Pointer[] => [{ kind: "hop", id }],
        spot: (): readonly Pointer[] => [],
      })
    ),
  summary: ({ id, target, text }, nameOf, hopLabelOf) => {
    const said = quoteText(oneLine(text, 80));

    return Match.value(target).pipe(
      Match.discriminatorsExhaustive("kind")({
        structure: ({ id: on }) =>
          `note ${id} on ${quoteText(nameOf(on))}: ${said}`,
        hop: ({ id: on }) =>
          `note ${id} on hop ${quoteText(hopLabelOf(on))}: ${said}`,
        spot: ({ x, y }) => `note ${id} at the spot ${x}, ${y}: ${said}`,
      })
    );
  },
  facts: ({ target, text }) => ({
    before: null,
    after:
      target.kind === "spot"
        ? { text, spot: { x: target.x, y: target.y } }
        : { text },
  }),
  breakage: ({ target, text }, { structureIds, hops }) => {
    if (text.length > maxNoteLength) {
      return Option.some(
        `The note is ${text.length} characters, over the limit of ${maxNoteLength}.`
      );
    }

    return Match.value(target).pipe(
      Match.discriminatorsExhaustive("kind")({
        structure: ({ id }) =>
          structureIds.has(id)
            ? Option.none()
            : Option.some(
                `No structure in data.mjs has the id "${id}", so this note has nothing to point at.`
              ),
        hop: ({ id }) =>
          Arr.some(hops, (hop) => hop.id === id)
            ? Option.none()
            : Option.some(
                `No hop in data.mjs has the id "${id}", so this note has nothing to point at.`
              ),
        spot: () => Option.none(),
      })
    );
  },
  applies: () => [],
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

/**
 * The table: one entry for every `kind` of `BatchItem`. It is typed by that
 * union, so a kind added there without an entry here fails to compile.
 */
export const kindTable = {
  layout: layoutKind,
  note: noteKind,
  suggestion: suggestionKind,
  answer: answerKind,
  question: questionKind,
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
