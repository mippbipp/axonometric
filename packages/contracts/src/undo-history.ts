import { Array as Arr, Option, Schema } from "effect";

import { LayoutChange, sameLayoutChanges, targetKeysOf } from "./proposals.ts";

const sameChange = Schema.toEquivalence(LayoutChange);

const holds = Arr.containsWith(sameChange);

/**
 * One edit the engineer made, as the pending lists it went between. Undo
 * and redo replay it on the list as it is then, so a change someone else
 * made since on other targets stays.
 */
export interface UndoStep {
  readonly after: ReadonlyArray<LayoutChange>;
  readonly before: ReadonlyArray<LayoutChange>;
  /**
   * The targets whose changes differ between the lists, as `structure:<id>`
   * and `hop:<id>` keys. Never empty.
   */
  readonly keys: ReadonlyArray<string>;
}

/** Which way a step is taken: back to its `before`, or on to its `after`. */
export type StepDirection = "undo" | "redo";

/**
 * The edits the engineer can undo and redo.
 *
 * - `past` ends with the latest edit.
 * - `future` ends with the step the latest undo took back.
 */
export interface UndoHistory {
  readonly future: ReadonlyArray<UndoStep>;
  readonly past: ReadonlyArray<UndoStep>;
}

export const emptyHistory: UndoHistory = { future: [], past: [] };

/** The changes in `list` that act on any of `keys`, in list order. */
const project = (
  list: ReadonlyArray<LayoutChange>,
  keys: ReadonlyArray<string>
) =>
  Arr.filter(list, (change) =>
    Arr.some(targetKeysOf(change), (key) => keys.includes(key))
  );

/**
 * The step an edit from `before` to `after` made, or none when no target's
 * changes differ. A target's changes differ when they aren't the same
 * changes in the same order, since a later change on a target wins.
 */
export const stepOf = ({
  after,
  before,
}: {
  readonly after: ReadonlyArray<LayoutChange>;
  readonly before: ReadonlyArray<LayoutChange>;
}): Option.Option<UndoStep> => {
  const keys = Arr.filter(
    Arr.dedupe(Arr.flatMap([...before, ...after], targetKeysOf)),
    (key) => !sameLayoutChanges(project(before, [key]), project(after, [key]))
  );

  return Arr.isReadonlyArrayNonEmpty(keys)
    ? Option.some({ after, before, keys })
    : Option.none();
};

/** The history after a new edit: it forgets what could be redone, and the oldest steps past `cap`. */
export const pushStep = ({
  cap,
  history,
  step,
}: {
  readonly cap: number;
  readonly history: UndoHistory;
  readonly step: UndoStep;
}): UndoHistory => ({
  future: [],
  past: [...history.past, step].slice(-cap),
});

/** What an undo or redo takes: the step, and the history once it's taken. */
export interface Stepped {
  readonly history: UndoHistory;
  readonly step: UndoStep;
}

/** The step an undo takes back: the latest edit, which moves to redo. */
export const undoStep = (history: UndoHistory): Option.Option<Stepped> =>
  Option.map(Arr.last(history.past), (step) => ({
    history: {
      future: [...history.future, step],
      past: history.past.slice(0, -1),
    },
    step,
  }));

/** The step a redo puts back: the latest undone, which moves to undo. */
export const redoStep = (history: UndoHistory): Option.Option<Stepped> =>
  Option.map(Arr.last(history.future), (step) => ({
    history: {
      future: history.future.slice(0, -1),
      past: [...history.past, step],
    },
    step,
  }));

/**
 * The list `current` becomes when `step` is undone (`after` back to
 * `before`) or redone (`before` on to `after`), keeping what others wrote
 * since. Nothing when they changed one of the step's targets.
 *
 * The result starts from the list the step goes to, so with nothing written
 * since it is exactly that list. A change others removed or replaced goes,
 * and a change they added goes in after the change before it in `current`.
 * Only the order of changes on one target matters, and theirs are all on
 * other targets.
 */
export const replayStep = ({
  current,
  direction,
  step,
}: {
  readonly current: ReadonlyArray<LayoutChange>;
  readonly direction: StepDirection;
  readonly step: UndoStep;
}): Option.Option<ReadonlyArray<LayoutChange>> => {
  const [from, to] =
    direction === "undo"
      ? [step.after, step.before]
      : [step.before, step.after];

  if (
    !sameLayoutChanges(project(current, step.keys), project(from, step.keys))
  ) {
    return Option.none();
  }

  const kept = Arr.filter(
    to,
    (change) => !holds(from, change) || holds(current, change)
  );

  return Option.some(
    Arr.reduce(current, kept, (so, change, index) => {
      if (holds(from, change)) {
        return so;
      }

      const anchor = Arr.findLast(current.slice(0, index), (earlier) =>
        holds(so, earlier)
      );

      const at = Option.match(anchor, {
        onNone: () => 0,
        onSome: (earlier) =>
          Arr.findFirstIndex(so, (held) => sameChange(held, earlier)).pipe(
            Option.getOrElse(() => -1)
          ) + 1,
      });

      return [...so.slice(0, at), change, ...so.slice(at)];
    })
  );
};

/**
 * `history` once undoing or redoing `step` conflicted. The step goes from
 * the stack it was taken from, with each older step there that shares a
 * target with it or with a step dropped before, since those expect the
 * target as the dropped step left it. The other steps stay.
 */
export const dropConflicted = ({
  direction,
  history,
  step,
}: {
  readonly direction: StepDirection;
  readonly history: UndoHistory;
  readonly step: UndoStep;
}): UndoHistory => {
  const stack = direction === "undo" ? history.past : history.future;

  const { kept } = Arr.reduceRight(
    stack,
    { dropped: step.keys, kept: [] as ReadonlyArray<UndoStep> },
    ({ dropped, kept: so }, older) =>
      Arr.some(older.keys, (key) => dropped.includes(key))
        ? { dropped: [...dropped, ...older.keys], kept: so }
        : { dropped, kept: [older, ...so] }
  );

  return direction === "undo"
    ? { ...history, past: kept }
    : { ...history, future: kept };
};

/** What `observeFile` decides. */
export interface Observed {
  /** Whether the history had steps that were just thrown away. */
  readonly cleared: boolean;
  readonly history: UndoHistory;
}

/**
 * The history after the page hears of the file. When the accepted layout
 * changed, accepting made a revision, and undo doesn't reach past that: the
 * history ends. `cleared` says whether it had steps to lose, which the page
 * tells the engineer.
 */
export const observeFile = ({
  acceptedChanged,
  history,
}: {
  readonly acceptedChanged: boolean;
  readonly history: UndoHistory;
}): Observed =>
  acceptedChanged
    ? {
        cleared: history.past.length > 0 || history.future.length > 0,
        history: emptyHistory,
      }
    : { cleared: false, history };
