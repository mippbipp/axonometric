import { Option } from "effect";

/**
 * The lists the session has been through, as the page keeps them for undo.
 * `A` is whatever one step holds, such as a list of pending changes.
 *
 * - `past` ends with the list before the latest edit.
 * - `future` ends with the list the latest undo left.
 * - `revision` is the file revision the steps are good for: the one the
 *   session's last write made. A step re-sends a whole list, so it is only
 *   valid while the file is still as the session left it.
 */
export interface UndoHistory<A> {
  readonly past: readonly A[];
  readonly future: readonly A[];
  readonly revision: number;
}

/** A history with no steps, good for file revision `revision`. */
export const emptyHistory = <A>(revision: number): UndoHistory<A> => ({
  past: [],
  future: [],
  revision,
});

const hasSteps = <A>({ past, future }: UndoHistory<A>) =>
  past.length > 0 || future.length > 0;

/**
 * The history after an edit made from the list `before`, with the file at
 * `fileRevision`. A new edit forgets what could be redone, and the oldest
 * steps past `cap`. When someone else wrote the file since the session's
 * last write, the earlier steps would put back a list that lacks their
 * change, so the history starts again.
 */
export const pushStep = <A>({
  history,
  before,
  fileRevision,
  cap,
}: {
  readonly history: UndoHistory<A>;
  readonly before: A;
  readonly fileRevision: number;
  readonly cap: number;
}): UndoHistory<A> => {
  const kept =
    history.revision === fileRevision ? history : emptyHistory<A>(fileRevision);

  return {
    past: [...kept.past, before].slice(-cap),
    future: [],
    revision: kept.revision,
  };
};

/** What an undo or redo gives: the list to set, and the history after it. */
export interface Stepped<A> {
  readonly target: A;
  readonly history: UndoHistory<A>;
}

/** Undo from the list `current`: the last list before it, if any. */
export const undoStep = <A>({
  history,
  current,
}: {
  readonly history: UndoHistory<A>;
  readonly current: A;
}): Option.Option<Stepped<A>> => {
  const target = history.past.at(-1);

  return target === undefined
    ? Option.none()
    : Option.some({
        target,
        history: {
          ...history,
          past: history.past.slice(0, -1),
          future: [...history.future, current],
        },
      });
};

/** Redo from the list `current`: the list the last undo left, if any. */
export const redoStep = <A>({
  history,
  current,
}: {
  readonly history: UndoHistory<A>;
  readonly current: A;
}): Option.Option<Stepped<A>> => {
  const target = history.future.at(-1);

  return target === undefined
    ? Option.none()
    : Option.some({
        target,
        history: {
          ...history,
          past: [...history.past, current],
          future: history.future.slice(0, -1),
        },
      });
};

/** The history once the session's own write made file revision `revision`. */
export const wroteFile = <A>({
  history,
  revision,
}: {
  readonly history: UndoHistory<A>;
  readonly revision: number;
}): UndoHistory<A> => ({ ...history, revision });

/** What `observeFile` decides. */
export interface Observed<A> {
  readonly history: UndoHistory<A>;
  /** Whether the history had steps that were just thrown away. */
  readonly cleared: boolean;
}

/**
 * The history after the page hears of the file at `fileRevision`.
 *
 * - When the accepted layout changed, accepting made a revision, and undo
 *   doesn't reach past that: the history ends. `cleared` says whether it
 *   had steps to lose, which the page tells the engineer.
 * - With no steps to protect, the history follows the file's revision.
 * - Otherwise it is kept as it is, and the next edit decides whether
 *   someone else's write made it stale.
 */
export const observeFile = <A>({
  history,
  fileRevision,
  acceptedChanged,
}: {
  readonly history: UndoHistory<A>;
  readonly fileRevision: number;
  readonly acceptedChanged: boolean;
}): Observed<A> => {
  if (acceptedChanged) {
    return {
      history: emptyHistory<A>(fileRevision),
      cleared: hasSteps(history),
    };
  }

  return {
    history: hasSteps(history) ? history : emptyHistory<A>(fileRevision),
    cleared: false,
  };
};
