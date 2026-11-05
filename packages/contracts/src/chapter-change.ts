import { Array as Arr, Match, Option, Order, Schema } from "effect";
import { dual } from "effect/Function";

import { objectMessages } from "./fields.ts";
import type { Chapter, Hop, Structure } from "./map-data.ts";
import { quoteText } from "./review-quote.ts";
import { StructureId } from "./structure-change.ts";
import { idText } from "./text-schemas.ts";

/** The id of a chapter data.mjs has. */
export const ChapterId = idText("chapter");

/** The id of a hop data.mjs has. */
export const HopId = idText("hop");

const action = <const A extends string>(name: A) => Schema.Literal(name);

const noRepeats = (hops: readonly string[]) =>
  new Set(hops).size === hops.length;

/** The most hops one chapter proposal orders. */
export const maxPlayedHops = 200;

const orderFix = `expected the hops the chapter plays, in the new order: 2 to ${maxPlayedHops} hop ids, each once.`;

const orderMinimum = Schema.isMinLength(2, { message: orderFix });

const orderMaximum = Schema.isMaxLength(maxPlayedHops, { message: orderFix });

const orderOnce = Schema.makeFilter(noRepeats, { message: orderFix });

/**
 * A proposed change to one chapter's walkthrough, without changing the
 * diagram. `reveal` and `hide` act on the structures the chapter reveals
 * itself, and `play` and `unplay` on the hops it plays. `order` lists every
 * hop the chapter plays, in the order wanted.
 */
export const ChapterChange = Schema.Union([
  Schema.Struct({
    action: action("reveal"),
    chapter: ChapterId,
    structure: StructureId,
  }).annotate(
    objectMessages("A reveal has only action, chapter and structure.")
  ),
  Schema.Struct({
    action: action("hide"),
    chapter: ChapterId,
    structure: StructureId,
  }).annotate(objectMessages("A hide has only action, chapter and structure.")),
  Schema.Struct({
    action: action("play"),
    chapter: ChapterId,
    hop: HopId,
  }).annotate(objectMessages("A play has only action, chapter and hop.")),
  Schema.Struct({
    action: action("unplay"),
    chapter: ChapterId,
    hop: HopId,
  }).annotate(objectMessages("An unplay has only action, chapter and hop.")),
  Schema.Struct({
    action: action("order"),
    chapter: ChapterId,
    plays: Schema.Array(HopId)
      .annotate({ message: orderFix })
      .check(orderMinimum, orderMaximum, orderOnce),
  }).annotate(objectMessages("An order has only action, chapter and plays.")),
]).annotate({
  message:
    'expected a chapter change: { action: "reveal" | "hide", chapter, structure }, { action: "play" | "unplay", chapter, hop } or { action: "order", chapter, plays: [hop, ...] }.',
});

export type ChapterChange = typeof ChapterChange.Type;

const equivalent = Schema.toEquivalence(ChapterChange);

/** Whether two chapter changes are the same change. */
export const sameChapterChange: {
  (b: ChapterChange): (a: ChapterChange) => boolean;
  (a: ChapterChange, b: ChapterChange): boolean;
} = dual(2, (a: ChapterChange, b: ChapterChange): boolean => equivalent(a, b));

/** The change for one action. */
type Of<A extends ChapterChange["action"]> = Extract<
  ChapterChange,
  { action: A }
>;

const withoutHop = (plays: readonly string[], hop: string) =>
  Arr.filter(plays, (other) => other !== hop);

/**
 * `plays` in the order `wanted` lists them. A hop `wanted` doesn't list keeps
 * its place after the listed ones, and a listed hop the chapter doesn't play
 * is left out, so an order stays right when a play or unplay lands beside it.
 */
export const resequenced: {
  (wanted: readonly string[]): (plays: readonly string[]) => readonly string[];
  (plays: readonly string[], wanted: readonly string[]): readonly string[];
} = dual(
  2,
  (plays: readonly string[], wanted: readonly string[]): readonly string[] => [
    ...Arr.filter(wanted, (hop) => plays.includes(hop)),
    ...Arr.filter(plays, (hop) => !wanted.includes(hop)),
  ]
);

/** What a message calls the structures, hops and chapters of the map. */
export interface Called {
  readonly structure: (id: string) => string;
  readonly hop: (id: string) => string;
  readonly chapter: (id: string) => string;
}

/**
 * Everything the map does with one action of a chapter change. A new action
 * adds one entry here, and `ChapterChange` a member, so none of the code that
 * handles an action by name has to change: the kind, the proposals, the page
 * and `review` all read this table, as they read `structureActions`.
 */
export interface ChapterAction<A extends ChapterChange["action"]> {
  /** A word for the kind of item, as `review` lists it. */
  readonly label: string;
  /**
   * What makes two changes about the same thing, so a second change to it
   * replaces or undoes the first.
   */
  readonly subject: (change: Of<A>) => string;
  /** The structures the change names. */
  readonly structures: (change: Of<A>) => readonly string[];
  /** The hops the change names. */
  readonly hops: (change: Of<A>) => readonly string[];
  /**
   * `chapter` once the change is taken. With `holdRemovals`, a hide and an
   * unplay leave it as it is, which is how the page draws them: the structure
   * or hop stays in the chapter in the pending look, as a proposed deletion
   * leaves a structure on the map.
   */
  readonly apply: (
    change: Of<A>,
    chapter: Chapter,
    holdRemovals: boolean
  ) => Chapter;
  /** Whether the chapter, among `chapters`, already has what the change proposes. */
  readonly holds: (
    change: Of<A>,
    chapter: Chapter,
    chapters: readonly Chapter[]
  ) => boolean;
  /** What the Pending list says, in plain words. */
  readonly describe: (change: Of<A>, called: Called) => string;
  /** The chapter's `reveals` or `plays` for `review`'s before and after. */
  readonly facts: (
    chapter: Chapter
  ) => Readonly<Record<string, readonly string[]>>;
  /** What the change puts a pending look on in its chapter: structures or hops. */
  readonly marks: (change: Of<A>) => readonly string[];
}

const revealsOf = (chapter: Chapter) => ({ reveals: chapter.reveals });

const playsOf = (chapter: Chapter) => ({ plays: chapter.plays });

const hasRevealed = (
  chapters: readonly Chapter[],
  chapter: string,
  id: string
) => revealedUpTo(chapters, chapter).has(id);

/** The table: one entry for every action of a chapter change. */
/** The table's type: one entry per action, each typed by its own action's change. */
type ChapterActions = {
  readonly [A in ChapterChange["action"]]: ChapterAction<A>;
};

const chapterActions: ChapterActions = {
  reveal: {
    label: "reveal structure",
    subject: ({ chapter, structure }) => `reveals ${chapter} ${structure}`,
    structures: ({ structure }) => [structure],
    hops: () => [],
    apply: ({ structure }, chapter) =>
      chapter.reveals.includes(structure)
        ? chapter
        : { ...chapter, reveals: [...chapter.reveals, structure] },
    holds: ({ chapter, structure }, _chapter, chapters) =>
      hasRevealed(chapters, chapter, structure),
    describe: ({ chapter, structure }, called) =>
      `Show ${called.structure(structure)} in ${called.chapter(chapter)}`,
    facts: revealsOf,
    marks: ({ structure }) => [structure],
  },
  hide: {
    label: "hide structure",
    subject: ({ chapter, structure }) => `reveals ${chapter} ${structure}`,
    structures: ({ structure }) => [structure],
    hops: () => [],
    apply: ({ structure }, chapter, holdRemovals) =>
      holdRemovals
        ? chapter
        : {
            ...chapter,
            reveals: Arr.filter(chapter.reveals, (id) => id !== structure),
          },
    holds: ({ structure }, chapter) => !chapter.reveals.includes(structure),
    describe: ({ chapter, structure }, called) =>
      `Hide ${called.structure(structure)} from ${called.chapter(chapter)}`,
    facts: revealsOf,
    marks: ({ structure }) => [structure],
  },
  play: {
    label: "play hop",
    subject: ({ chapter, hop }) => `plays ${chapter} ${hop}`,
    structures: () => [],
    hops: ({ hop }) => [hop],
    apply: ({ hop }, chapter) =>
      chapter.plays.includes(hop)
        ? chapter
        : { ...chapter, plays: [...chapter.plays, hop] },
    holds: ({ hop }, chapter) => chapter.plays.includes(hop),
    describe: ({ chapter, hop }, called) =>
      `Play ${called.hop(hop)} in ${called.chapter(chapter)}`,
    facts: playsOf,
    marks: ({ hop }) => [hop],
  },
  unplay: {
    label: "unplay hop",
    subject: ({ chapter, hop }) => `plays ${chapter} ${hop}`,
    structures: () => [],
    hops: ({ hop }) => [hop],
    apply: ({ hop }, chapter, holdRemovals) =>
      holdRemovals
        ? chapter
        : { ...chapter, plays: withoutHop(chapter.plays, hop) },
    holds: ({ hop }, chapter) => !chapter.plays.includes(hop),
    describe: ({ chapter, hop }, called) =>
      `Stop playing ${called.hop(hop)} in ${called.chapter(chapter)}`,
    facts: playsOf,
    marks: ({ hop }) => [hop],
  },
  order: {
    label: "reorder hops",
    subject: ({ chapter }) => `order ${chapter}`,
    structures: () => [],
    hops: ({ plays }) => plays,
    apply: ({ plays }, chapter) => ({
      ...chapter,
      plays: resequenced(chapter.plays, plays),
    }),
    holds: ({ plays: wanted }, chapter) => {
      const sorted = resequenced(chapter.plays, wanted);

      return Arr.every(chapter.plays, (hop, index) => sorted[index] === hop);
    },
    describe: ({ chapter, plays }, called) =>
      `Reorder the hops of ${called.chapter(chapter)}: ${Arr.join(Arr.map(plays, called.hop), ", ")}`,
    facts: playsOf,
    marks: ({ chapter }) => [chapter],
  },
};

/** The entry for `change`'s action, bound to `change`. */
export const actionOf = (change: ChapterChange): BoundAction => ({
  label: chapterActions[change.action].label,
  subject: subjectBy(change),
  structures: structuresBy(change),
  hops: hopsBy(change),
  apply: (chapter, holdRemovals) => applyBy(change, chapter, holdRemovals),
  holds: (chapter, chapters) => holdsBy(change, chapter, chapters),
  describe: (called) => describeBy(change, called),
  facts: (chapter) => factsBy(change, chapter),
  marks: marksBy(change),
});

/** The table's entry for one change, bound to it. */
export interface BoundAction {
  readonly label: string;
  readonly subject: string;
  readonly structures: readonly string[];
  readonly hops: readonly string[];
  readonly apply: (chapter: Chapter, holdRemovals: boolean) => Chapter;
  readonly holds: (chapter: Chapter, chapters: readonly Chapter[]) => boolean;
  readonly describe: (called: Called) => string;
  readonly facts: (
    chapter: Chapter
  ) => Readonly<Record<string, readonly string[]>>;
  readonly marks: readonly string[];
}

const subjectBy = (change: ChapterChange): string =>
  Match.value(change).pipe(
    Match.discriminatorsExhaustive("action")({
      reveal: (found) => chapterActions.reveal.subject(found),
      hide: (found) => chapterActions.hide.subject(found),
      play: (found) => chapterActions.play.subject(found),
      unplay: (found) => chapterActions.unplay.subject(found),
      order: (found) => chapterActions.order.subject(found),
    })
  );

const structuresBy = (change: ChapterChange): readonly string[] =>
  Match.value(change).pipe(
    Match.discriminatorsExhaustive("action")({
      reveal: (found) => chapterActions.reveal.structures(found),
      hide: (found) => chapterActions.hide.structures(found),
      play: (found) => chapterActions.play.structures(found),
      unplay: (found) => chapterActions.unplay.structures(found),
      order: (found) => chapterActions.order.structures(found),
    })
  );

const hopsBy = (change: ChapterChange): readonly string[] =>
  Match.value(change).pipe(
    Match.discriminatorsExhaustive("action")({
      reveal: (found) => chapterActions.reveal.hops(found),
      hide: (found) => chapterActions.hide.hops(found),
      play: (found) => chapterActions.play.hops(found),
      unplay: (found) => chapterActions.unplay.hops(found),
      order: (found) => chapterActions.order.hops(found),
    })
  );

const applyBy = (
  change: ChapterChange,
  chapter: Chapter,
  holdRemovals: boolean
): Chapter =>
  Match.value(change).pipe(
    Match.discriminatorsExhaustive("action")({
      reveal: (found) =>
        chapterActions.reveal.apply(found, chapter, holdRemovals),
      hide: (found) => chapterActions.hide.apply(found, chapter, holdRemovals),
      play: (found) => chapterActions.play.apply(found, chapter, holdRemovals),
      unplay: (found) =>
        chapterActions.unplay.apply(found, chapter, holdRemovals),
      order: (found) =>
        chapterActions.order.apply(found, chapter, holdRemovals),
    })
  );

const holdsBy = (
  change: ChapterChange,
  chapter: Chapter,
  chapters: readonly Chapter[]
): boolean =>
  Match.value(change).pipe(
    Match.discriminatorsExhaustive("action")({
      reveal: (found) => chapterActions.reveal.holds(found, chapter, chapters),
      hide: (found) => chapterActions.hide.holds(found, chapter, chapters),
      play: (found) => chapterActions.play.holds(found, chapter, chapters),
      unplay: (found) => chapterActions.unplay.holds(found, chapter, chapters),
      order: (found) => chapterActions.order.holds(found, chapter, chapters),
    })
  );

const describeBy = (change: ChapterChange, called: Called): string =>
  Match.value(change).pipe(
    Match.discriminatorsExhaustive("action")({
      reveal: (found) => chapterActions.reveal.describe(found, called),
      hide: (found) => chapterActions.hide.describe(found, called),
      play: (found) => chapterActions.play.describe(found, called),
      unplay: (found) => chapterActions.unplay.describe(found, called),
      order: (found) => chapterActions.order.describe(found, called),
    })
  );

const factsBy = (change: ChapterChange, chapter: Chapter) =>
  Match.value(change).pipe(
    Match.discriminatorsExhaustive("action")({
      reveal: () => chapterActions.reveal.facts(chapter),
      hide: () => chapterActions.hide.facts(chapter),
      play: () => chapterActions.play.facts(chapter),
      unplay: () => chapterActions.unplay.facts(chapter),
      order: () => chapterActions.order.facts(chapter),
    })
  );

const marksBy = (change: ChapterChange): readonly string[] =>
  Match.value(change).pipe(
    Match.discriminatorsExhaustive("action")({
      reveal: (found) => chapterActions.reveal.marks(found),
      hide: (found) => chapterActions.hide.marks(found),
      play: (found) => chapterActions.play.marks(found),
      unplay: (found) => chapterActions.unplay.marks(found),
      order: (found) => chapterActions.order.marks(found),
    })
  );

/** What a change is about, so a second change to the same thing replaces or undoes the first. */
export const subjectOf = (change: ChapterChange): string => subjectBy(change);

/** The structures a change names. */
export const structuresOfChange = (change: ChapterChange): readonly string[] =>
  structuresBy(change);

/** The hops a change names. */
export const hopsOfChange = (change: ChapterChange): readonly string[] =>
  hopsBy(change);

/**
 * `chapters` with `change` taken as proposed: what data.mjs holds once the
 * agent folds it in. A chapter that `change` doesn't name is untouched.
 *
 * With `holdRemovals`, a hide and an unplay change nothing, which is how the
 * page draws them; see `ChapterAction.apply`.
 */
export const applyChapterChange = ({
  chapters,
  change,
  holdRemovals = false,
}: {
  readonly chapters: readonly Chapter[];
  readonly change: ChapterChange;
  readonly holdRemovals?: boolean;
}): readonly Chapter[] =>
  Arr.map(chapters, (chapter) =>
    chapter.id === change.chapter
      ? applyBy(change, chapter, holdRemovals)
      : chapter
  );

/** `chapters` with every change taken as proposed, in order. */
export const chaptersAfter = ({
  chapters,
  changes,
  holdRemovals = false,
}: {
  readonly chapters: readonly Chapter[];
  readonly changes: readonly ChapterChange[];
  readonly holdRemovals?: boolean;
}): readonly Chapter[] =>
  Arr.reduce(changes, chapters, (held, change) =>
    applyChapterChange({ chapters: held, change, holdRemovals })
  );

/**
 * The structures the chapters up to and including `chapter` have revealed.
 * Reveals are cumulative.
 */
export const revealedUpTo: {
  (chapter: string): (chapters: readonly Chapter[]) => ReadonlySet<string>;
  (chapters: readonly Chapter[], chapter: string): ReadonlySet<string>;
} = dual(
  2,
  (chapters: readonly Chapter[], chapter: string): ReadonlySet<string> => {
    const at = Arr.findFirstIndex(chapters, ({ id }) => id === chapter);

    return new Set(
      Option.match(at, {
        onNone: () => [],
        onSome: (index) =>
          Arr.flatMap(chapters.slice(0, index + 1), ({ reveals }) => reveals),
      })
    );
  }
);

/** Whether `chapters` already hold what `change` proposes. */
export const chapterHolds: {
  (change: ChapterChange): (chapters: readonly Chapter[]) => boolean;
  (chapters: readonly Chapter[], change: ChapterChange): boolean;
} = dual(2, (chapters: readonly Chapter[], change: ChapterChange): boolean =>
  Option.match(
    Arr.findFirst(chapters, ({ id }) => id === change.chapter),
    {
      onNone: () => false,
      onSome: (chapter) => holdsBy(change, chapter, chapters),
    }
  )
);

/** What a chapter's walkthrough gets wrong once changes are folded in. */
export const ChapterProblem = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("unrevealed-hop"),
    chapter: Schema.String,
    hop: Schema.String,
    /** The hop's ends that no chapter up to this one has revealed. */
    missing: Schema.Array(Schema.String),
  }),
  Schema.Struct({
    kind: Schema.Literal("never-revealed"),
    structure: Schema.String,
  }),
]);

export type ChapterProblem = typeof ChapterProblem.Type;

/**
 * The walkthrough problems of `chapters`, as `check` finds them: a chapter
 * plays a hop whose ends no chapter up to it has revealed, and the last
 * chapter leaves a structure unrevealed. `data` says which hops and
 * structures exist.
 */
export const chapterProblems = ({
  chapters,
  hops,
  structures,
}: {
  readonly chapters: readonly Chapter[];
  readonly hops: readonly Pick<Hop, "id" | "from" | "to">[];
  readonly structures: readonly Pick<Structure, "id">[];
}): readonly ChapterProblem[] => {
  if (!Arr.isReadonlyArrayNonEmpty(chapters)) {
    return [];
  }

  const byId = new Map(Arr.map(hops, (hop) => [hop.id, hop]));
  const revealed = new Set<string>();

  const unrevealed = Arr.flatMap(chapters, (chapter) => {
    for (const id of chapter.reveals) {
      revealed.add(id);
    }

    return Arr.flatMap(chapter.plays, (hopId): readonly ChapterProblem[] => {
      const hop = byId.get(hopId);

      if (hop === undefined) {
        return [];
      }

      const missing = Arr.dedupe(
        Arr.filter([hop.from, hop.to], (end) => !revealed.has(end))
      );

      return missing.length === 0
        ? []
        : [
            {
              kind: "unrevealed-hop",
              chapter: chapter.id,
              hop: hopId,
              missing,
            },
          ];
    });
  });

  const never = Arr.flatMap(structures, ({ id }): readonly ChapterProblem[] =>
    revealed.has(id) ? [] : [{ kind: "never-revealed", structure: id }]
  );

  return [...unrevealed, ...never];
};

const sameProblem = Schema.toEquivalence(ChapterProblem);

const listed = (ids: readonly string[], called: Called): string =>
  Arr.join(
    Arr.map(ids, (id) => `${quoteText(called.structure(id))} (${id})`),
    " and "
  );

/**
 * Why taking `change`, with the other `changes` of its batch, would break the
 * walkthrough, or nothing. Only a problem the chapters did not already have
 * counts.
 *
 * - A play breaks when the chapter hasn't revealed the hop's ends: the
 *   message names the hop and the structures it is missing.
 * - A hide breaks when it leaves a played hop with an end unrevealed, or
 *   leaves the structure revealed by no chapter at all.
 * - A reveal, an unplay and an order never break the walkthrough.
 */
export const chapterBreakage = ({
  change,
  changes,
  data,
  called,
}: {
  readonly change: ChapterChange;
  /** Every chapter change taken together with it, in order. */
  readonly changes: readonly ChapterChange[];
  readonly data: {
    readonly chapters: readonly Chapter[];
    readonly hops: readonly Hop[];
    readonly structures: readonly Pick<Structure, "id">[];
  };
  readonly called: Called;
}): Option.Option<string> => {
  if (change.action !== "play" && change.action !== "hide") {
    return Option.none();
  }

  const frame = { hops: data.hops, structures: data.structures };
  const before = chapterProblems({ chapters: data.chapters, ...frame });

  const after = Arr.filter(
    chapterProblems({
      chapters: chaptersAfter({ chapters: data.chapters, changes }),
      ...frame,
    }),
    (problem) => !Arr.some(before, (was) => sameProblem(was, problem))
  );

  const hopWords = (id: string) => `${quoteText(called.hop(id))} (${id})`;

  if (change.action === "play") {
    return Option.map(
      Arr.findFirst(
        after,
        (problem) =>
          problem.kind === "unrevealed-hop" &&
          problem.chapter === change.chapter &&
          problem.hop === change.hop
      ),
      (problem) =>
        problem.kind === "unrevealed-hop"
          ? `Chapter ${quoteText(change.chapter)} would play hop ${hopWords(problem.hop)}, but no chapter up to it has revealed ${listed(problem.missing, called)}. Reveal ${problem.missing.length === 1 ? "it" : "them"} in this chapter or an earlier one, or leave the hop out.`
          : ""
    );
  }

  const unrevealed = Arr.flatMap(after, (problem) =>
    problem.kind === "unrevealed-hop" &&
    problem.missing.includes(change.structure)
      ? [
          `hop ${hopWords(problem.hop)} is still played in chapter ${quoteText(problem.chapter)}, which would no longer have revealed ${listed([change.structure], called)}`,
        ]
      : []
  );

  const never = Arr.some(
    after,
    (problem) =>
      problem.kind === "never-revealed" &&
      problem.structure === change.structure
  )
    ? [
        `no chapter would reveal ${listed([change.structure], called)} any more, and the last chapter must leave every structure revealed`,
      ]
    : [];

  const reasons = [...unrevealed, ...never];

  return reasons.length === 0
    ? Option.none()
    : Option.some(
        `Hiding ${listed([change.structure], called)} from chapter ${quoteText(change.chapter)} would break the walkthrough: ${Arr.join(reasons, "; ")}.`
      );
};

/** The order chapters come in, as the walkthrough has them. */
export const byChapterOrder = (chapters: readonly Chapter[]) =>
  Order.mapInput(Order.Number, (change: ChapterChange) =>
    Arr.findFirstIndex(chapters, ({ id }) => id === change.chapter).pipe(
      Option.getOrElse(() => Number.POSITIVE_INFINITY)
    )
  );
