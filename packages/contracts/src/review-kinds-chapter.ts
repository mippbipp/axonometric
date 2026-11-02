// oxlint-disable eslint/max-params -- KindSpec passes a kind the titles of groups and chapters as a fourth argument, after the names every kind gets.

import { Array as Arr, Match, Option } from "effect";
import { dual } from "effect/Function";

import {
  applyChapterChange,
  chapterBreakage,
  chapterHolds,
  hopsOfChange,
  structuresOfChange,
} from "./chapter-change.ts";
import type { ChapterChange } from "./chapter-change.ts";
import { hopLabelOf } from "./map-data.ts";
import type { Chapter, MapData } from "./map-data.ts";
import type { BatchItem, LayoutChange } from "./proposals.ts";
import { plain, touchesNothing } from "./review-kind-defaults.ts";
import type { KindSpec, Pointer } from "./review-kinds.ts";
import { decorate, quoteText } from "./review-quote.ts";

// The kind for a proposed change to one chapter's walkthrough: which
// structures it reveals, which hops it plays and in what order. It is a
// chapter proposal, listed apart from the diagram proposals, and it changes
// nothing about the diagram. It is one entry of the kind table;
// `review-kinds.ts` lists it.

type ChapterItem = Extract<BatchItem, { kind: "chapter" }>;

/** Said once, in the prompt and in `review`, when a batch holds a chapter item. */
const chapterNotice =
  "A chapter item changes one chapter in data.mjs, which only you edit: its reveals or its plays. Reveals are cumulative, so a chapter may play a hop only when it or an earlier chapter has revealed both of the hop's structures; review flags the ones that don't.";

/**
 * The name of the mark a chapter proposal puts on structures or hops in
 * chapter `chapter`, for `action`. The page reads the marks of the chapter it
 * shows, so a proposal looks pending in its chapter and in no other.
 */
export const chapterMark: {
  (chapter: string): (action: ChapterChange["action"]) => string;
  (action: ChapterChange["action"], chapter: string): string;
} = dual(
  2,
  (action: ChapterChange["action"], chapter: string): string =>
    `chapter:${action}:${chapter}`
);

/** The mark for a chapter whose plays a proposal reorders. */
export const orderMark = (chapter: string): string =>
  chapterMark("order", chapter);

const chapterOf = (data: Pick<MapData, "chapters">, id: string) =>
  Arr.findFirst(data.chapters, (chapter) => chapter.id === id);

const noChapter = (id: string) =>
  `No chapter in data.mjs has the id "${id}", so this item has nothing to act on.`;

/** What a chapter's own lists hold, as `review` prints them. */
const chapterFacts = (chapter: Chapter, change: ChapterChange) => {
  const fields: Readonly<Record<string, string | readonly string[]>> =
    change.action === "reveal" || change.action === "hide"
      ? { id: chapter.id, reveals: chapter.reveals }
      : { id: chapter.id, plays: chapter.plays };

  return { chapter: fields };
};

export const chapterKind: KindSpec<ChapterItem> = {
  ...plain<ChapterItem>(),
  section: "chapter",
  textLimit: Number.POSITIVE_INFINITY,
  listKey: "chapters",
  text: () => Option.none(),
  describe: ({ change }, nameOf, hopLabel, titles) => {
    const chapter = titles?.chapter(change.chapter) ?? change.chapter;

    return Option.some(
      Match.value(change).pipe(
        Match.discriminatorsExhaustive("action")({
          reveal: ({ structure }) => `Show ${nameOf(structure)} in ${chapter}`,
          hide: ({ structure }) => `Hide ${nameOf(structure)} from ${chapter}`,
          play: ({ hop }) => `Play ${hopLabel(hop)} in ${chapter}`,
          unplay: ({ hop }) => `Stop playing ${hopLabel(hop)} in ${chapter}`,
          order: ({ plays }) =>
            `Reorder the hops of ${chapter}: ${Arr.join(Arr.map(plays, hopLabel), ", ")}`,
        })
      )
    );
  },
  dangling: ({ change }, known) => {
    if (!known.chapters.has(change.chapter)) {
      return Option.some(
        `no chapter in data.mjs has the id "${change.chapter}"`
      );
    }

    const lostStructure = Arr.findFirst(
      structuresOfChange(change),
      (id) => !known.structures.has(id)
    );

    if (Option.isSome(lostStructure)) {
      return Option.some(
        `no structure in data.mjs has the id "${lostStructure.value}"`
      );
    }

    return Option.map(
      Arr.findFirst(hopsOfChange(change), (id) => !known.hops.has(id)),
      (id) => `no hop in data.mjs has the id "${id}"`
    );
  },
  notice: chapterNotice,
  open: (proposals) =>
    Arr.map(proposals.chapters ?? [], (proposal): ChapterItem => ({
      id: proposal.id,
      kind: "chapter",
      change: proposal.change,
    })),
  clear: (proposals) => ({ ...proposals, chapters: [] }),
  add: (proposals, { id, change }) => ({
    ...proposals,
    chapters: [...(proposals.chapters ?? []), { id, change }],
  }),
  name: ({ change }) =>
    Match.value(change).pipe(
      Match.discriminatorsExhaustive("action")({
        reveal: () => "reveal structure",
        hide: () => "hide structure",
        play: () => "play hop",
        unplay: () => "unplay hop",
        order: () => "reorder hops",
      })
    ),
  targets: ({ change }): readonly Pointer[] => [
    { kind: "chapter", id: change.chapter },
    ...Arr.map(structuresOfChange(change), (id): Pointer => ({
      kind: "structure",
      id,
    })),
    ...Arr.map(hopsOfChange(change), (id): Pointer => ({ kind: "hop", id })),
  ],
  summary: ({ id, change }, nameOf, hopLabel, titles) => {
    const chapter = `${quoteText(titles?.chapter(change.chapter) ?? change.chapter)} (${change.chapter})`;

    const structureLine = (structure: string) =>
      `${change.action} ${id}: ${quoteText(nameOf(structure))} (${structure}) in chapter ${chapter}`;

    const hopLine = (hop: string) =>
      `${change.action} ${id}: hop ${quoteText(hopLabel(hop))} (${hop}) in chapter ${chapter}`;

    return Match.value(change).pipe(
      Match.discriminatorsExhaustive("action")({
        reveal: ({ structure }) => structureLine(structure),
        hide: ({ structure }) => structureLine(structure),
        play: ({ hop }) => hopLine(hop),
        unplay: ({ hop }) => hopLine(hop),
        order: ({ plays }) =>
          `order ${id}: chapter ${chapter} plays ${Arr.join(
            Arr.map(plays, (hop) => `${quoteText(hopLabel(hop))} (${hop})`),
            ", "
          )}`,
      })
    );
  },
  facts: ({ change }, _layout, data) => {
    const found = Option.fromNullishOr(data).pipe(
      Option.flatMap((map) => chapterOf(map, change.chapter))
    );

    return Option.match(found, {
      onNone: () => ({
        before: null,
        after: { chapter: { id: change.chapter } },
      }),
      onSome: (chapter) => ({
        before: chapterFacts(chapter, change),
        after: chapterFacts(
          applyChapterChange({ chapters: [chapter], change })[0] ?? chapter,
          change
        ),
      }),
    });
  },
  appliesToData: ({ change }, map) => ({
    ...map,
    data: {
      ...map.data,
      // A hide or an unplay leaves the structure or hop in the chapter, as a
      // proposed deletion leaves a structure on the map: the page draws it in
      // the pending look.
      chapters: applyChapterChange({
        chapters: map.data.chapters,
        change,
        holdRemovals: true,
      }),
    },
  }),
  touches: ({ change }) => ({
    ...touchesNothing,
    marks: {
      [chapterMark(change.action, change.chapter)]:
        change.action === "order"
          ? [change.chapter]
          : [...structuresOfChange(change), ...hopsOfChange(change)],
    },
  }),
  breakage: (item, { structureIds, hops, data, siblings }) => {
    const { change } = item;

    if (data === undefined) {
      return Option.none();
    }

    if (Option.isNone(chapterOf(data, change.chapter))) {
      return Option.some(noChapter(change.chapter));
    }

    const lostStructure = Arr.findFirst(
      structuresOfChange(change),
      (id) => !structureIds.has(id)
    );

    if (Option.isSome(lostStructure)) {
      return Option.some(
        `No structure in data.mjs has the id "${lostStructure.value}", so this item has nothing to point at.`
      );
    }

    const lostHop = Arr.findFirst(
      hopsOfChange(change),
      (id) => !Arr.some(hops, (hop) => hop.id === id)
    );

    if (Option.isSome(lostHop)) {
      return Option.some(
        `No hop in data.mjs has the id "${lostHop.value}", so this item has nothing to point at.`
      );
    }

    // Reveals are cumulative and the batch's items land together, so a hop
    // counts as revealed when any chapter change of the batch reveals it.
    const together = Arr.flatMap(siblings ?? [item], (other) =>
      other.kind === "chapter" ? [other.change] : []
    );

    return chapterBreakage({
      change,
      changes: together,
      data,
      called: {
        structure: (id) =>
          Option.match(
            Arr.findFirst(data.structures, (structure) => structure.id === id),
            { onNone: () => id, onSome: ({ name }) => name }
          ),
        hop: hopLabelOf(data.hops),
      },
    });
  },
  applies: (): readonly LayoutChange[] => [],
  commitRefusal: (item, verdict, { data }) => {
    const { change } = item;

    return verdict.verdict === "accepted" &&
      !chapterHolds(data.chapters, change)
      ? Option.some(
          `data.mjs does not yet have what item ${item.id} proposes for chapter "${change.chapter}", so it can't be taken as accepted. Make the change in data.mjs, give the verdict changed, or reject the item.`
        )
      : Option.none();
  },
  retargeted: (item, renames) => {
    const { change } = item;

    if (change.action !== "reveal" && change.action !== "hide") {
      return item;
    }

    const to = renames.get(change.structure);

    return to === undefined
      ? item
      : { ...item, change: { ...change, structure: to } };
  },
  accepted: (item, verdict) =>
    decorate(
      { kind: "chapter", id: item.id, change: item.change } as const,
      verdict
    ),
  rejected: (item, reason) => ({
    kind: "chapter",
    id: item.id,
    change: item.change,
    reason,
  }),
  reopened: (item, newId) => ({ ...item, id: newId }),
};
