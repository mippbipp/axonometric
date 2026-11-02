import { Array as Arr, Match, Option, Order, Schema } from "effect";
import { dual } from "effect/Function";

import { objectMessages } from "./fields.ts";
import type { Chapter, Hop, Structure } from "./map-data.ts";
import { quoteText } from "./review-quote.ts";
import { StructureId } from "./structure-change.ts";

const chapterFix = "expected the id of one of the map's chapters, on one line.";

const lineBreak = /[\r\n\u0085\u2028\u2029]/u;

/** The id of a chapter data.mjs has. */
export const ChapterId = Schema.String.annotate({ message: chapterFix }).check(
  Schema.isNonEmpty({ message: chapterFix }),
  Schema.isMaxLength(200, { message: chapterFix }),
  Schema.makeFilter((id: string) => !lineBreak.test(id), {
    message: chapterFix,
  })
);

const hopFix = "expected the id of one of the map's hops, on one line.";

/** The id of a hop data.mjs has. */
export const HopId = Schema.String.annotate({ message: hopFix }).check(
  Schema.isNonEmpty({ message: hopFix }),
  Schema.isMaxLength(200, { message: hopFix }),
  Schema.makeFilter((id: string) => !lineBreak.test(id), { message: hopFix })
);

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

export const sameChapterChange: {
  (b: ChapterChange): (a: ChapterChange) => boolean;
  (a: ChapterChange, b: ChapterChange): boolean;
} = dual(2, (a: ChapterChange, b: ChapterChange): boolean => equivalent(a, b));

/** What a change is about, so a second change to the same thing replaces or undoes the first. */
export const subjectOf = (change: ChapterChange): string =>
  Match.value(change).pipe(
    Match.discriminatorsExhaustive("action")({
      reveal: ({ chapter, structure }) => `reveals ${chapter} ${structure}`,
      hide: ({ chapter, structure }) => `reveals ${chapter} ${structure}`,
      play: ({ chapter, hop }) => `plays ${chapter} ${hop}`,
      unplay: ({ chapter, hop }) => `plays ${chapter} ${hop}`,
      order: ({ chapter }) => `order ${chapter}`,
    })
  );

/** The structures a change names. */
export const structuresOfChange = (change: ChapterChange): readonly string[] =>
  change.action === "reveal" || change.action === "hide"
    ? [change.structure]
    : [];

/** The hops a change names. */
export const hopsOfChange = (change: ChapterChange): readonly string[] =>
  Match.value(change).pipe(
    Match.discriminatorsExhaustive("action")({
      reveal: () => [],
      hide: () => [],
      play: ({ hop }) => [hop],
      unplay: ({ hop }) => [hop],
      order: ({ plays }) => plays,
    })
  );

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

/**
 * `chapters` with `change` taken as proposed: what data.mjs holds once the
 * agent folds it in. A chapter that `change` doesn't name is untouched.
 *
 * With `holdRemovals`, a hide and an unplay change nothing, which is how the
 * page draws them: the structure or hop stays in the chapter in the pending
 * look, as a structure proposed for deletion does, until the agent decides.
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
  Arr.map(chapters, (chapter): Chapter =>
    chapter.id === change.chapter
      ? Match.value(change).pipe(
          Match.discriminatorsExhaustive("action")({
            reveal: ({ structure }) =>
              chapter.reveals.includes(structure)
                ? chapter
                : { ...chapter, reveals: [...chapter.reveals, structure] },
            hide: ({ structure }) =>
              holdRemovals
                ? chapter
                : {
                    ...chapter,
                    reveals: Arr.filter(
                      chapter.reveals,
                      (id) => id !== structure
                    ),
                  },
            play: ({ hop }) =>
              chapter.plays.includes(hop)
                ? chapter
                : { ...chapter, plays: [...chapter.plays, hop] },
            unplay: ({ hop }) =>
              holdRemovals
                ? chapter
                : { ...chapter, plays: withoutHop(chapter.plays, hop) },
            order: ({ plays }) => ({
              ...chapter,
              plays: resequenced(chapter.plays, plays),
            }),
          })
        )
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
      onSome: ({ reveals, plays }) =>
        Match.value(change).pipe(
          Match.discriminatorsExhaustive("action")({
            reveal: ({ structure }) =>
              revealedUpTo(chapters, change.chapter).has(structure),
            hide: ({ structure }) => !reveals.includes(structure),
            play: ({ hop }) => plays.includes(hop),
            unplay: ({ hop }) => !plays.includes(hop),
            order: ({ plays: wanted }) => {
              const sorted = resequenced(plays, wanted);

              return Arr.every(plays, (hop, index) => sorted[index] === hop);
            },
          })
        ),
    }
  )
);

/** What a chapter's walkthrough gets wrong once changes are folded in. */
export type ChapterProblem =
  | {
      readonly kind: "unrevealed-hop";
      readonly chapter: string;
      readonly hop: string;
      /** The hop's ends that no chapter up to this one has revealed. */
      readonly missing: readonly string[];
    }
  | { readonly kind: "never-revealed"; readonly structure: string };

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

const sameProblem = (a: ChapterProblem, b: ChapterProblem): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

/** What a message calls the structures and hops of the map. */
export interface Called {
  readonly structure: (id: string) => string;
  readonly hop: (id: string) => string;
}

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
