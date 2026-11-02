import {
  Array as Arr,
  Match,
  Option,
  pipe,
  Record as Rec,
  Result,
  Schema,
  String as Str,
} from "effect";
import { dual } from "effect/Function";

import type { HopEnds } from "./layout-checks.ts";
import type { Layout } from "./layout.ts";
import {
  applyLayoutChanges,
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
import type { Facts } from "./review-report.ts";
import type { AcceptedItem, RejectedItem } from "./revisions.ts";

const encodeString = Schema.encodeResult(Schema.fromJsonString(Schema.String));

/**
 * `text` as a JSON string literal on one line. The quotes and escapes keep
 * whatever the engineer typed inside its own literal, so it can't pass for
 * a line of the prompt. The line separators JSON leaves bare are escaped
 * too.
 */
export const quoteText = (text: string): string =>
  pipe(
    Result.getOrElse(encodeString(text), () => '""'),
    Str.replaceAll("\u0085", String.raw`\u0085`),
    Str.replaceAll("\u2028", String.raw`\u2028`),
    Str.replaceAll("\u2029", String.raw`\u2029`)
  );

/** `text` on one line, cut to `limit` characters. */
export const oneLine: {
  (limit: number): (text: string) => string;
  (text: string, limit: number): string;
} = dual(2, (text: string, limit: number): string => {
  const flat = Arr.join(Str.split(/[\s\u0085]+/u)(Str.trim(text)), " ");

  return flat.length <= limit ? flat : `${Str.slice(0, limit - 1)(flat)}…`;
});

/** What a kind of item needs to know about the map. */
export interface Landing {
  /** The layout the item lands on. */
  readonly layout: Layout;
  /** The ids of the structures data.mjs has. */
  readonly structureIds: ReadonlySet<string>;
  /** The hops data.mjs has, which say where a reroute's ends belong. */
  readonly hops: readonly HopEnds[];
}

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
  /** What the item changes, from `layout`, for `review`. */
  facts(item: I, layout: Layout): { before: Facts; after: Facts };
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
