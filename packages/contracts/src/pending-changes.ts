import { Array as Arr, Match, Option, Predicate, String as Str } from "effect";
import { dual } from "effect/Function";

import { engineerTakesOver } from "./agent-changes.ts";
import { appendMove } from "./arrange.ts";
import type { Placements } from "./arrange.ts";
import { restoreChanges } from "./diff.ts";
import type { MapSnapshot } from "./diff.ts";
import type { GridPoint, Layout, Placement } from "./layout.ts";
import type { MapState } from "./map-state.ts";
import type { MapProblem } from "./problems.ts";
import {
  agentChangeMade,
  applyLayoutChanges,
  discardChanges,
  emptyProposals,
  layoutRefusal,
  placeRoute,
  placeStructure,
  sameLayoutChanges,
  withCarriedRoutes,
} from "./proposals.ts";
import type {
  ChangeId,
  LayoutChange,
  Proposals,
  StructureMove,
} from "./proposals.ts";
import { layoutUnderProposals } from "./proposed-map.ts";
import type { ProposalRefused } from "./review-server.ts";
import { frozenRefusal, frozenWriteRefusal } from "./review.ts";
import type {
  Accepted,
  LayoutChangeRefused,
  MapFilesUnreadable,
  StaleProposals,
} from "./server.ts";
import {
  emptyHistory,
  observeFile,
  pushStep,
  redoStep,
  undoStep,
  wroteFile,
} from "./undo-history.ts";
import type { UndoHistory } from "./undo-history.ts";

/** Why the last edit didn't save, as the page tells the engineer. */
export interface EditNotice {
  readonly kind: "conflict" | "refused" | "failed" | "info";
  readonly message: string;
}

/** The moves that arrange a set, given where its structures sit now. */
export type Arrangement = (
  placements: Placements
) => ReadonlyArray<StructureMove>;

/** An edit the engineer makes to the pending layout changes. */
export type PendingEdit =
  /** Puts a structure at a new placement. */
  | {
      readonly _tag: "Place";
      readonly next: Placement;
      readonly structure: string;
    }
  /** Moves, nudges, aligns or distributes a set as one change. */
  | { readonly _tag: "Arrange"; readonly plan: Arrangement }
  /** Gives a hop a route override, or puts it back on automatic with `null`. */
  | {
      readonly _tag: "Reroute";
      readonly hop: string;
      readonly points: ReadonlyArray<GridPoint> | null;
    }
  /** Removes pending changes, such as one change or an agent group, as one step. */
  | {
      readonly _tag: "Discard";
      readonly changes: Arr.NonEmptyReadonlyArray<ChangeId>;
    }
  /** Puts every structure where a past revision has it. */
  | { readonly _tag: "Restore"; readonly revision: MapSnapshot };

/**
 * How the server answered a write, in the page's terms: what it saved, or
 * why it didn't.
 */
export type WriteAnswer<A> =
  | { readonly _tag: "Saved"; readonly value: A }
  /** A success whose body didn't decode. */
  | { readonly _tag: "Garbled" }
  | {
      readonly _tag: "Refused";
      readonly refusal:
        | StaleProposals
        | LayoutChangeRefused
        | MapFilesUnreadable
        | ProposalRefused;
    }
  /** A failure the page doesn't know. */
  | {
      readonly _tag: "Unexplained";
      readonly status: number;
      readonly text: string;
    }
  /** The server didn't answer. */
  | { readonly _tag: "Unreachable" };

/**
 * An edit to the list: the list it makes from `changes`, given the layout
 * open changes land on. It gives the same answer each time it's run, ids
 * included, so a stale write can run it again on a fresher list.
 */
type Edit = (
  changes: ReadonlyArray<LayoutChange>,
  accepted: Layout
) => ReadonlyArray<LayoutChange>;

/** The pending lists the session has been through, for undo and redo. */
type History = UndoHistory<ReadonlyArray<LayoutChange>>;

/**
 * A write of the whole pending list, asked for and not answered. The page
 * sends `layout` based on file revision `base`.
 */
export interface LayoutWrite {
  /** The file revision the write is based on, fixed when it was made. */
  readonly base: number;
  /** The edit, to run again on a fresher list. */
  readonly edit: Edit;
  /** The history as it was before this write, to put back if it fails. */
  readonly historyBefore: History;
  /** The whole list the write sets. */
  readonly layout: ReadonlyArray<LayoutChange>;
  /**
   * What made it: an edit, an undo or redo, whose list is never rebuilt, or
   * the edits sent again after another writer got in first.
   */
  readonly origin: "edit" | "step" | "retry";
}

/** A write the page sends to the server, one at a time in this order. */
export type PendingWrite =
  | { readonly _tag: "Layout"; readonly write: LayoutWrite }
  /**
   * Accepts the pending changes with these ids, or all of them. It is based
   * on the file revision the session holds when its turn comes.
   */
  | {
      readonly _tag: "Accept";
      readonly ids: "all" | Arr.NonEmptyReadonlyArray<ChangeId>;
      readonly message: string;
    };

/**
 * The served page's pending layout changes: the last good map, what it
 * shows, the undo history and the writes on their way.
 */
export interface PendingSession {
  /**
   * Whether an accept is waiting for the saves before it, or on its way.
   * Edits are refused meanwhile, because they'd be saved over the changes
   * the accept takes.
   */
  readonly accepting: boolean;
  readonly history: History;
  /** Makes the id of each change an edit adds. */
  readonly newId: () => ChangeId;
  /** Why the last edit didn't save, until the next edit. */
  readonly notice: EditNotice | null;
  /** What the page shows: what's saved, with any write still on its way. */
  readonly pending: ReadonlyArray<LayoutChange>;
  /** The layout writes asked for and not answered, oldest first. */
  readonly queue: ReadonlyArray<LayoutWrite>;
  /**
   * The last good map, with what `proposals.json` held at last word. Its
   * layout is the accepted layout the history last heard of.
   */
  readonly state: MapState;
}

/** What happened to the session, or what reached it from the server. */
export type PendingInput =
  | { readonly _tag: "Apply"; readonly edit: PendingEdit }
  | { readonly _tag: "Undo" }
  | { readonly _tag: "Redo" }
  /** A map from the server. */
  | { readonly _tag: "Receive"; readonly state: MapState }
  /**
   * A new `proposals.json` from the server, which sends it alone while the
   * map files don't make a map.
   */
  | { readonly _tag: "ReceiveProposals"; readonly proposals: Proposals }
  /** The server's answer to a layout write. */
  | {
      readonly _tag: "Written";
      readonly answer: WriteAnswer<Proposals>;
      readonly write: LayoutWrite;
    }
  | {
      readonly _tag: "Accept";
      readonly ids: "all" | Arr.NonEmptyReadonlyArray<ChangeId>;
      readonly message: string;
    }
  /** The server's answer to an accept. */
  | { readonly _tag: "Accepted"; readonly answer: WriteAnswer<Accepted> }
  /**
   * What `proposals.json` holds after one of the page's other writes, such
   * as a note. `endsUndo` when it moved layout changes, as a freeze does.
   */
  | {
      readonly _tag: "Reviewed";
      readonly endsUndo: boolean;
      readonly proposals: Proposals;
    };

/** What a step gives: the session after it, the writes to send, and why an edit was refused. */
export interface PendingOutcome {
  readonly refusal: string | undefined;
  readonly session: PendingSession;
  readonly writes: ReadonlyArray<PendingWrite>;
}

/** What the page shows of the session. */
export interface PendingView {
  readonly accepting: boolean;
  /** Whether there is an undone edit to redo. */
  readonly canRedo: boolean;
  /** Whether there is an edit to undo. */
  readonly canUndo: boolean;
  readonly notice: EditNotice | null;
  /**
   * The pending layout changes the page shows: those saved, with any edit
   * still on its way to the server.
   */
  readonly pending: ReadonlyArray<LayoutChange>;
  readonly state: MapState;
}

/** How many edits the session remembers. */
const historyDepth = 100;

const proposalsOf = (state: MapState): Proposals =>
  state.proposals ?? emptyProposals;

const savedLayout = (state: MapState) => proposalsOf(state).layout;

const fileRevision = (state: MapState) => proposalsOf(state).revision;

/** A session on the map the page was served with. */
export const startPending = ({
  initial,
  newId,
}: {
  readonly initial: MapState;
  readonly newId: () => ChangeId;
}): PendingSession => ({
  accepting: false,
  history: emptyHistory(fileRevision(initial)),
  newId,
  notice: null,
  pending: savedLayout(initial),
  queue: [],
  state: initial,
});

export const pendingView = (session: PendingSession): PendingView => ({
  accepting: session.accepting,
  canRedo: session.history.future.length > 0,
  canUndo: session.history.past.length > 0,
  notice: session.notice,
  pending: session.pending,
  state: session.state,
});

/**
 * Whether `write` is still to be sent. A failure or conflict drops the
 * queue, and a write waiting for its turn then has nothing to send.
 */
export const isQueued: {
  (write: LayoutWrite): (session: PendingSession) => boolean;
  (session: PendingSession, write: LayoutWrite): boolean;
} = dual(2, (session: PendingSession, write: LayoutWrite) =>
  session.queue.includes(write)
);

const clearedHistoryMessage =
  "Accepted changes can't be undone. Edits before this point are cleared from undo.";

const stepConflictMessage =
  "The pending changes changed on disk since your last edit, so nothing was undone or redone. The page shows what's saved, and your steps are kept. Make an edit to start the history again.";

const acceptingMessage =
  "Accepting the pending changes. Make this edit once that's saved.";

const acceptConflictMessage =
  "The pending changes changed on disk before this accept. The page now shows what's pending. Accept again if the changes are still right.";

const conflictMessage = (reason: Option.Option<string>) =>
  `The pending changes changed on disk before this edit saved. The page now shows what's saved. ${Option.match(
    reason,
    {
      onNone: () => "Make the edit again.",
      onSome: (why) => `Your edit no longer fits: ${why}`,
    }
  )}`;

const problemsText = (problems: ReadonlyArray<MapProblem>) =>
  Arr.join(
    Arr.map(problems, (problem) => problem.message),
    " "
  );

type Refusal = Extract<WriteAnswer<unknown>, { _tag: "Refused" }>["refusal"];

/** What the page says when the server refuses a write. */
const noticeOf = Match.type<Refusal>().pipe(
  Match.tagsExhaustive({
    LayoutChangeRefused: ({ reason }): EditNotice => ({
      kind: "refused",
      message: reason,
    }),
    MapFilesUnreadable: ({ problems }): EditNotice => ({
      kind: "failed",
      message: `The edit wasn't saved: ${problemsText(problems)}`,
    }),
    ProposalRefused: ({ reason }): EditNotice => ({
      kind: "refused",
      message: reason,
    }),
    StaleProposals: (): EditNotice => ({
      kind: "conflict",
      message: conflictMessage(Option.none()),
    }),
  })
);

/**
 * `incoming`, unless the file it carries is older than the one `current`
 * holds. Events and answers can arrive out of order, and an older file must
 * not take the page back.
 */
const withFreshestProposals = (
  current: MapState,
  incoming: MapState
): MapState =>
  fileRevision(incoming) < fileRevision(current)
    ? { ...incoming, proposals: proposalsOf(current) }
    : incoming;

/**
 * The layout open changes land on: the accepted layout with the items
 * frozen in batches applied and the structures the engineer proposed
 * placed, as the server checks them.
 */
const baseLayout = ({ state }: PendingSession) =>
  layoutUnderProposals({
    data: state.data,
    layout: state.layout,
    proposals: proposalsOf(state),
  });

/** `session` with nothing to send and nothing refused. */
const settled = (session: PendingSession): PendingOutcome => ({
  refusal: undefined,
  session,
  writes: [],
});

/**
 * `session` showing `next`. Whenever it brings a map, the history hears of
 * it: accepting a change moves the accepted layout's revision, undo doesn't
 * reach past that, and the engineer is told unless `next` says something
 * else. A notice left out stays as it was.
 */
const show = (
  session: PendingSession,
  next: {
    readonly notice?: EditNotice | null;
    readonly pending?: ReadonlyArray<LayoutChange>;
    readonly state?: MapState;
  }
): PendingSession => {
  const observed = Option.map(Option.fromUndefinedOr(next.state), (state) =>
    observeFile({
      acceptedChanged: state.layout.revision !== session.state.layout.revision,
      fileRevision: fileRevision(state),
      history: session.history,
    })
  );

  const cleared = Option.exists(observed, ({ cleared: was }) => was);

  const notice: EditNotice | null =
    cleared && (next.notice ?? null) === null
      ? { kind: "info", message: clearedHistoryMessage }
      : next.notice === undefined
        ? session.notice
        : next.notice;

  return {
    ...session,
    history: Option.match(observed, {
      onNone: () => session.history,
      onSome: ({ history }) => history,
    }),
    notice,
    pending: next.pending ?? session.pending,
    state: next.state ?? session.state,
  };
};

/**
 * The pending changes to show once `state` is the latest word: what it
 * saved, unless a write is still on its way.
 */
const pendingAfter = (session: PendingSession, state: MapState) =>
  session.queue.length === 0 ? savedLayout(state) : session.pending;

/** Whether someone else has written the file since the session's last write. */
const outdated = (session: PendingSession) =>
  session.queue.length === 0 &&
  fileRevision(session.state) !== session.history.revision;

const receive = (session: PendingSession, incoming: MapState) => {
  const state = withFreshestProposals(session.state, incoming);

  return show(session, { pending: pendingAfter(session, state), state });
};

/** Shows `proposals` as what's saved, with `notice`, and drops the queue. */
const adopt = ({
  notice,
  proposals,
  session,
  restore = session.history,
}: {
  readonly notice: EditNotice | null;
  readonly proposals: Proposals;
  /** The history to keep: as it is, unless given. */
  readonly restore?: History;
  readonly session: PendingSession;
}) =>
  show(
    { ...session, history: restore, queue: [] },
    {
      notice,
      pending: proposals.layout,
      state: { ...session.state, proposals },
    }
  );

const failed = (session: PendingSession, message: string, restore: History) =>
  show(
    { ...session, history: restore, queue: [] },
    { notice: { kind: "failed", message }, pending: savedLayout(session.state) }
  );

/** Queues `write`, and shows the list it sets. */
const enqueue = (
  session: PendingSession,
  write: LayoutWrite
): PendingOutcome => ({
  refusal: undefined,
  session: show(
    { ...session, queue: [...session.queue, write] },
    { pending: write.layout }
  ),
  writes: [{ _tag: "Layout", write }],
});

/**
 * The edits run again on a fresh list: the list so far, or why one failed.
 * `trail` holds the list before each edit that went through.
 */
interface Rerun {
  readonly layout: ReadonlyArray<LayoutChange>;
  readonly reason: Option.Option<string>;
  readonly trail: ReadonlyArray<ReadonlyArray<LayoutChange>>;
}

/**
 * The server's file moved on before `stale` was sent. Drops the queue, and
 * runs its edits again on `fresh`, the file as it is now. When they all
 * still fit, they're sent once more, based on `fresh`'s revision; when one
 * doesn't, or that write was already a retry, the page keeps `fresh` and
 * says the edit conflicted.
 */
const recover = (
  session: PendingSession,
  stale: LayoutWrite,
  fresh: Proposals
): PendingOutcome => {
  const accepted = baseLayout(session);

  const start: Rerun = {
    layout: fresh.layout,
    reason: Option.none(),
    trail: [],
  };

  const rerun = Arr.reduce(session.queue, start, (so, { edit }): Rerun => {
    if (Option.isSome(so.reason)) {
      return so;
    }

    const after = edit(so.layout, accepted);

    const refusal = layoutRefusal({
      accepted,
      after,
      before: so.layout,
      hops: session.state.data.hops,
    });

    return Option.isNone(refusal)
      ? {
          layout: after,
          reason: Option.none(),
          trail: [...so.trail, so.layout],
        }
      : { ...so, reason: refusal };
  });

  // An undo or redo sets a whole earlier list, so run on a fresher file it
  // would erase what the other writer did. It never reruns.
  if (Arr.some(session.queue, ({ origin }) => origin === "step")) {
    return settled(
      adopt({
        notice: { kind: "conflict", message: stepConflictMessage },
        proposals: fresh,
        restore: stale.historyBefore,
        session,
      })
    );
  }

  if (stale.origin === "retry" || Option.isSome(rerun.reason)) {
    return settled(
      adopt({
        notice: { kind: "conflict", message: conflictMessage(rerun.reason) },
        proposals: fresh,
        restore: stale.historyBefore,
        session,
      })
    );
  }

  // The steps before the other writer's change no longer fit the file, so
  // the history starts again from the file as it is now.
  const rebuilt: History = {
    future: [],
    past: rerun.trail.slice(-historyDepth),
    revision: fresh.revision,
  };

  return enqueue(
    adopt({ notice: null, proposals: fresh, restore: rebuilt, session }),
    {
      base: fresh.revision,
      edit: (changes) => changes,
      historyBefore: rebuilt,
      layout: rerun.layout,
      origin: "retry",
    }
  );
};

const written = (
  session: PendingSession,
  write: LayoutWrite,
  answer: WriteAnswer<Proposals>
): PendingOutcome => {
  const fail = (message: string) =>
    settled(failed(session, message, write.historyBefore));

  return Match.valueTags(answer, {
    Garbled: () =>
      fail("The server's answer didn't make sense. Reload the page."),
    Refused: ({ refusal }) =>
      Match.valueTags(refusal, {
        LayoutChangeRefused: (refused) =>
          settled(
            adopt({
              notice: noticeOf(refused),
              proposals: refused.proposals,
              restore: write.historyBefore,
              session,
            })
          ),
        MapFilesUnreadable: (refused) => fail(noticeOf(refused).message),
        ProposalRefused: (refused) => fail(noticeOf(refused).message),
        StaleProposals: ({ proposals }) => recover(session, write, proposals),
      }),
    Saved: ({ value: proposals }) => {
      const queue = Arr.filter(session.queue, (queued) => queued !== write);

      // The events stream can deliver a later revision before this answer
      // does. The older file must not replace it.
      const state = withFreshestProposals(session.state, {
        ...session.state,
        proposals,
      });

      const kept = {
        ...session,
        history: wroteFile({
          history: session.history,
          revision: proposals.revision,
        }),
        queue,
      };

      // The notice stays: a late answer to an earlier write must not wipe a
      // refusal shown since. The next edit clears it.
      return settled(show(kept, { pending: pendingAfter(kept, state), state }));
    },
    Unexplained: ({ status, text }) =>
      fail(`The server refused the edit (${status}): ${Str.trim(text)}`),
    Unreachable: () =>
      fail(
        "The edit wasn't saved: the server didn't answer. It may have stopped."
      ),
  });
};

const accepted = (
  session: PendingSession,
  answer: WriteAnswer<Accepted>
): PendingSession => {
  const fail = (message: string) => failed(session, message, session.history);

  return Match.valueTags(answer, {
    Garbled: () =>
      fail("The server's answer didn't make sense. Reload the page."),
    Refused: ({ refusal }) =>
      Match.valueTags(refusal, {
        LayoutChangeRefused: (refused) =>
          adopt({
            notice: noticeOf(refused),
            proposals: refused.proposals,
            session,
          }),
        MapFilesUnreadable: (refused) => fail(noticeOf(refused).message),
        ProposalRefused: (refused) => fail(noticeOf(refused).message),
        StaleProposals: ({ proposals }) =>
          adopt({
            notice: { kind: "conflict", message: acceptConflictMessage },
            proposals,
            session,
          }),
      }),
    Saved: ({ value: { layout, proposals } }) =>
      show(session, {
        // The events stream may already have said the history was cleared
        // by this accept. That notice stays.
        notice: session.notice?.kind === "info" ? session.notice : null,
        pending: proposals.layout,
        state: { ...session.state, layout, proposals },
      }),
    Unexplained: ({ status, text }) =>
      fail(`The server refused the accept (${status}): ${Str.trim(text)}`),
    Unreachable: () =>
      fail(
        "The accept wasn't saved: the server didn't answer. It may have stopped."
      ),
  });
};

/** Shows `proposals` as what the server holds, after one of the page's other writes. */
const reviewed = (
  session: PendingSession,
  proposals: Proposals,
  endsUndo: boolean
) => {
  const state = withFreshestProposals(session.state, {
    ...session.state,
    proposals,
  });

  const kept = {
    ...session,
    history: endsUndo
      ? emptyHistory<ReadonlyArray<LayoutChange>>(fileRevision(state))
      : wroteFile({ history: session.history, revision: fileRevision(state) }),
  };

  return show(kept, {
    notice: null,
    pending: pendingAfter(kept, state),
    state,
  });
};

/**
 * An edit that arranges a set as one change, with its id fixed up front. The
 * moves are planned from the list the edit runs on, and a route override
 * travels with its hop when both ends move together.
 */
const arranging = (session: PendingSession, plan: Arrangement): Edit => {
  const { newId } = session;
  const { hops } = session.state.data;
  const id = newId();
  const reroutes = new Map<string, ChangeId>();

  const rerouteId = (hop: string) => {
    const made = reroutes.get(hop) ?? newId();

    reroutes.set(hop, made);

    return made;
  };

  return (changes, base) => {
    const shown = applyLayoutChanges(base, changes);
    const moves = plan(shown.structures);

    const carried = Arr.filter(
      withCarriedRoutes({
        changes: appendMove({ changes: [], id, moves }),
        hops,
        id: rerouteId,
        layout: shown,
      }),
      (change) => change.kind === "reroute"
    );

    return Arr.reduce(
      carried,
      appendMove({ changes, id, moves }),
      (so, change) =>
        change.kind === "reroute"
          ? placeRoute({
              accepted: base,
              changes: so,
              hop: change.target.id,
              newId: () => change.id,
              points: change.points,
            })
          : so
    );
  };
};

/** An edit that puts `structure` at `next`, with change ids fixed up front. */
const placing = (
  { newId }: PendingSession,
  structure: string,
  next: Placement
): Edit => {
  const ids = [newId(), newId()];

  return (changes, base) => {
    let used = 0;

    return placeStructure({
      accepted: base,
      changes,
      id: structure,
      newId: () => {
        const made = ids[used] ?? newId();

        used += 1;

        return made;
      },
      next,
    });
  };
};

/** An edit that gives `hop` the route override `points`, or none. */
const rerouting = (
  { newId }: PendingSession,
  hop: string,
  points: ReadonlyArray<GridPoint> | null
): Edit => {
  const id = newId();

  return (changes, base) =>
    placeRoute({ accepted: base, changes, hop, newId: () => id, points });
};

/**
 * The edit that restores `revision`: it puts every structure where the
 * revision has it. The ids of the changes it adds are built from one fresh
 * id, so running it again on a fresher list gives the same answer.
 */
const restoring = (session: PendingSession, revision: MapSnapshot): Edit => {
  const base = session.newId();
  const current = session.state.data;

  return (changes, layout) => {
    let used = 0;

    return restoreChanges({
      accepted: layout,
      changes,
      current,
      newId: () => {
        used += 1;

        return `${base}-${used}`;
      },
      revision,
    });
  };
};

/**
 * Change ids made by `newId` the first time an edit asks for them and kept,
 * so each run of the edit is given the same ids in the same order.
 */
const reservedIds = (newId: () => ChangeId) => {
  const made: Array<ChangeId> = [];

  return () => {
    let used = 0;

    return () => {
      const id = made[used] ?? newId();

      made[used] = id;
      used += 1;

      return id;
    };
  };
};

/**
 * `edit`, after which the engineer takes over the agent's changes on what it
 * touched. Rerun on a fresher list, it takes over again, with the same ids.
 */
const takingOver = (session: PendingSession, edit: Edit): Edit => {
  const ids = reservedIds(session.newId);

  return (changes, base) =>
    engineerTakesOver({
      after: edit(changes, base),
      base,
      before: changes,
      newId: ids(),
    });
};

/**
 * How an edit runs: the list it makes, whether one that changes nothing is
 * still written, and whether a refusal is also a notice.
 */
interface EditPlan {
  readonly edit: Edit;
  readonly showsRefusal: boolean;
  /** An edit that changes nothing is neither a write nor an undo step. */
  readonly skipUnchanged: boolean;
}

const planOf = (session: PendingSession, input: PendingEdit): EditPlan =>
  Match.valueTags(input, {
    Arrange: ({ plan }) => ({
      edit: takingOver(session, arranging(session, plan)),
      showsRefusal: true,
      skipUnchanged: true,
    }),
    Discard: ({ changes: ids }) => ({
      edit: (changes: ReadonlyArray<LayoutChange>) =>
        discardChanges(changes, ids),
      showsRefusal: false,
      skipUnchanged: false,
    }),
    Place: ({ next, structure }) => ({
      edit: takingOver(session, placing(session, structure, next)),
      showsRefusal: false,
      skipUnchanged: false,
    }),
    Reroute: ({ hop, points }) => ({
      edit: takingOver(session, rerouting(session, hop, points)),
      showsRefusal: true,
      skipUnchanged: true,
    }),
    Restore: ({ revision }) => ({
      edit: takingOver(session, restoring(session, revision)),
      showsRefusal: false,
      skipUnchanged: true,
    }),
  });

/**
 * Why the list `after` is refused: the server's check of a frozen item
 * first, so every edit that would touch one gets the server's answer before
 * it is sent, then the layout's.
 */
const refusalOfList = (
  session: PendingSession,
  {
    accepted: base,
    after,
    before,
  }: {
    readonly accepted: Layout;
    readonly after: ReadonlyArray<LayoutChange>;
    readonly before: ReadonlyArray<LayoutChange>;
  }
) =>
  Option.orElse(
    frozenWriteRefusal({ after, proposals: proposalsOf(session.state) }),
    () =>
      layoutRefusal({
        accepted: base,
        after,
        before,
        hops: session.state.data.hops,
      })
  );

/** The list `edit` makes, and why it would be refused. */
const tryEdit = (session: PendingSession, edit: Edit) => {
  const base = baseLayout(session);
  const before = session.pending;
  const after = edit(before, base);

  return {
    after,
    refusal: refusalOfList(session, { accepted: base, after, before }),
  };
};

/** Why a discard can't touch a change: it waits in a batch for the agent. */
const frozenOf = (session: PendingSession, edit: PendingEdit) =>
  Predicate.isTagged(edit, "Discard")
    ? Arr.findFirst(edit.changes, (id) =>
        frozenRefusal(proposalsOf(session.state), id)
      )
    : Option.none();

/**
 * Why `edit` would be refused, or `undefined` when it wouldn't, without
 * changing anything.
 */
export const pendingRefusal: {
  (edit: PendingEdit): (session: PendingSession) => string | undefined;
  (session: PendingSession, edit: PendingEdit): string | undefined;
} = dual(2, (session: PendingSession, edit: PendingEdit): string | undefined =>
  Option.getOrUndefined(
    Option.orElse(
      frozenOf(session, edit),
      () => tryEdit(session, planOf(session, edit).edit).refusal
    )
  )
);

/** Queues the write of list `after`, based on the revision the queue ends at. */
const submit = (
  session: PendingSession,
  {
    after,
    edit,
    next,
    origin,
  }: {
    readonly after: ReadonlyArray<LayoutChange>;
    readonly edit: Edit;
    /** The history once this write is made. */
    readonly next: History;
    readonly origin: "edit" | "step";
  }
): PendingOutcome => {
  // The next write is built on the one before it, so it's based on the
  // revision that one will make. If someone else writes first, the server
  // refuses it as stale instead.
  const last = session.queue.at(-1);

  const queued = enqueue(
    { ...session, history: next },
    {
      base: last === undefined ? fileRevision(session.state) : last.base + 1,
      edit,
      historyBefore: session.history,
      layout: after,
      origin,
    }
  );

  return { ...queued, session: show(queued.session, { notice: null }) };
};

const refused = (session: PendingSession, refusal: string): PendingOutcome => ({
  refusal,
  session,
  writes: [],
});

const apply = (session: PendingSession, input: PendingEdit): PendingOutcome => {
  const frozen = frozenOf(session, input);

  if (Option.isSome(frozen)) {
    return refused(session, frozen.value);
  }

  const { edit, showsRefusal, skipUnchanged } = planOf(session, input);
  const { after, refusal } = tryEdit(session, edit);
  const same = sameLayoutChanges(session.pending, after);

  if (skipUnchanged && same) {
    return settled(session);
  }

  const why = session.accepting ? Option.some(acceptingMessage) : refusal;

  if (Option.isSome(why)) {
    return refused(
      showsRefusal
        ? show(session, { notice: { kind: "refused", message: why.value } })
        : session,
      why.value
    );
  }

  // An edit after someone else's write starts the history again: the
  // earlier steps would put back a list that lacks their change.
  const next = same
    ? session.history
    : pushStep({
        before: session.pending,
        cap: historyDepth,
        fileRevision:
          session.queue.length === 0
            ? fileRevision(session.state)
            : session.history.revision,
        history: session.history,
      });

  return submit(session, { after, edit, next, origin: "edit" });
};

/** Undoes or redoes one step: sets the pending list to the one it holds. */
const stepThrough = (
  session: PendingSession,
  direction: "undo" | "redo"
): PendingOutcome => {
  const before = session.pending;

  const stepped = (direction === "undo" ? undoStep : redoStep)({
    current: before,
    history: session.history,
  });

  if (Option.isNone(stepped)) {
    return settled(session);
  }

  if (outdated(session)) {
    return settled(
      show(session, {
        notice: { kind: "conflict", message: stepConflictMessage },
      })
    );
  }

  const { history: next, target } = stepped.value;

  // The server refuses an agent change from the page, so a step that would
  // bring one back is refused here, and nothing is sent.
  const broughtBack = agentChangeMade({
    after: target,
    before: savedLayout(session.state),
  });

  const refusal = Option.orElse(
    Option.map(
      broughtBack,
      ({ id }) =>
        `This step would bring back the agent's change ${id}, which only the agent can propose. Nothing was undone or redone.`
    ),
    () =>
      refusalOfList(session, {
        accepted: baseLayout(session),
        after: target,
        before,
      })
  );

  if (Option.isSome(refusal)) {
    return settled(
      show(session, { notice: { kind: "refused", message: refusal.value } })
    );
  }

  return submit(session, {
    after: target,
    edit: () => target,
    next,
    origin: "step",
  });
};

const accept = (
  session: PendingSession,
  ids: "all" | Arr.NonEmptyReadonlyArray<ChangeId>,
  message: string
): PendingOutcome =>
  session.accepting || session.pending.length === 0
    ? settled(session)
    : {
        refusal: undefined,
        session: show({ ...session, accepting: true }, { notice: null }),
        writes: [{ _tag: "Accept", ids, message }],
      };

/**
 * The session after `input`, with the writes it asks the page to send, in
 * order and one at a time, and why an edit was refused.
 *
 * Undo restores the list before the edit it takes back. Steps are only good
 * while the file is as the session's last write left it: once someone else
 * writes it, undo is refused with a conflict, and the next edit starts the
 * history again. Accepting a change ends the history.
 */
export const stepPending: {
  (input: PendingInput): (session: PendingSession) => PendingOutcome;
  (session: PendingSession, input: PendingInput): PendingOutcome;
} = dual(2, (session: PendingSession, input: PendingInput): PendingOutcome =>
  Match.valueTags(input, {
    Accept: ({ ids, message }) => accept(session, ids, message),
    Accepted: ({ answer }) =>
      settled({ ...accepted(session, answer), accepting: false }),
    Apply: ({ edit }) => apply(session, edit),
    Receive: ({ state }) => settled(receive(session, state)),
    ReceiveProposals: ({ proposals }) =>
      settled(receive(session, { ...session.state, proposals })),
    Redo: () => stepThrough(session, "redo"),
    Reviewed: ({ endsUndo, proposals }) =>
      settled(reviewed(session, proposals, endsUndo)),
    Undo: () => stepThrough(session, "undo"),
    Written: ({ answer, write }) => written(session, write, answer),
  })
);
