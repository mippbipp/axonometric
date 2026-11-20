import { Array as Arr, Match, Option, Predicate, Result } from "effect";

import {
  acceptLayoutChanges,
  agentHeldWriteRefusal,
  emptyProposals,
  agentChangeRefusal,
  frozenLayoutChanges,
  frozenWriteRefusal,
  isQueued,
  LayoutChangeRefused,
  layoutRefusal,
  layoutUnderProposals,
  pendingView,
  proposeAgentChange,
  sameLayoutChanges,
  StaleProposals,
  startPending,
  stepPending,
} from "../src/index.ts";
import type {
  Accepted,
  AgentProposal,
  ChangeId,
  LayoutChange,
  MapState,
  PendingInput,
  PendingView,
  PendingWrite,
  Proposals,
  WriteAnswer,
} from "../src/index.ts";

/** A layout write the page sent, as the server got it. */
export interface Sent {
  readonly baseFileRevision: number;
  readonly layout: ReadonlyArray<LayoutChange>;
}

/**
 * A served page and its server, in memory. The page is the pending changes
 * session the served store drives; the server holds the map files, answers
 * writes as `serve` does, and tells the page of every change, as the events
 * stream does. Writes wait until `settle`, one at a time in the order the
 * page asked for them, so a test can write from outside in between.
 */
export interface InMemoryPage {
  /** The page's input, as the engineer or the events stream gives it. */
  readonly dispatch: (input: PendingInput) => string | undefined;
  /** What the server holds. */
  readonly server: {
    /**
     * The agent proposes `proposal` for `reason`, as `layout --propose`
     * does, and the page hears of it. Returns why it was refused, when it
     * was, and then writes nothing.
     */
    readonly propose: (
      proposal: AgentProposal,
      reason: string
    ) => string | undefined;
    /**
     * `proposals.json` is replaced on disk by `proposals`. With `mapBroken`,
     * the map files don't make a map, so the page is sent the proposals alone.
     */
    readonly replaceProposals: (
      proposals: Proposals,
      { mapBroken }: { readonly mapBroken: boolean }
    ) => void;
    /** The layout writes the page sent, oldest first. */
    readonly sent: () => ReadonlyArray<Sent>;
    /** The accepted map, with what `proposals.json` holds. */
    readonly state: () => MapState;
    /** Another process writes the pending layout changes, which the page hears of. */
    readonly writeLayout: (layout: ReadonlyArray<LayoutChange>) => void;
  };
  /** Sends the writes waiting their turn, and every write they lead to. */
  readonly settle: () => void;
  readonly view: () => PendingView;
}

/** Change ids "c1", "c2", ... in the order the page asks for them. */
export const countingIds = (): (() => ChangeId) => {
  let made = 0;

  return () => {
    made += 1;

    return `c${made}`;
  };
};

const proposalsOf = (state: MapState) => state.proposals ?? emptyProposals;

/** A page that `serve` served for `initial`. */
export const inMemoryPage = (initial: MapState): InMemoryPage => {
  let server: MapState = initial;
  let session = startPending({ initial, newId: countingIds() });
  const waiting: Array<PendingWrite> = [];
  const sent: Array<Sent> = [];

  const dispatch = (input: PendingInput) => {
    const stepped = stepPending(session, input);

    ({ session } = stepped);
    waiting.push(...stepped.writes);

    return stepped.refusal;
  };

  const tell = () => {
    dispatch({ _tag: "Receive", state: server });
  };

  const putLayout = (write: Sent): WriteAnswer<Proposals> => {
    const current = proposalsOf(server);

    if (write.baseFileRevision !== current.revision) {
      return {
        _tag: "Refused",
        refusal: StaleProposals.make({ proposals: current }),
      };
    }

    const listed = { after: write.layout, before: current.layout };

    const asAgent = Option.orElse(agentChangeRefusal(listed), () =>
      agentHeldWriteRefusal(listed)
    );

    const refusal = Option.orElse(
      Option.orElse(asAgent, () =>
        frozenWriteRefusal({ after: write.layout, proposals: current })
      ),
      () =>
        layoutRefusal({
          accepted: layoutUnderProposals({
            data: server.data,
            layout: server.layout,
            proposals: current,
          }),
          after: write.layout,
          before: current.layout,
          hops: server.data.hops,
        })
    );

    if (Option.isSome(refusal)) {
      return {
        _tag: "Refused",
        refusal: LayoutChangeRefused.make({
          proposals: current,
          reason: refusal.value,
        }),
      };
    }

    const next = {
      ...current,
      layout: write.layout,
      revision: current.revision + 1,
    };

    server = { ...server, proposals: next };

    return { _tag: "Saved", value: next };
  };

  const accept = (
    ids: "all" | ReadonlyArray<ChangeId>
  ): WriteAnswer<Accepted> => {
    const current = proposalsOf(server);

    const result = acceptLayoutChanges({
      hops: server.data.hops,
      ids,
      layout: server.layout,
      pending: current.layout,
    });

    if (Result.isFailure(result)) {
      return {
        _tag: "Refused",
        refusal: LayoutChangeRefused.make({
          proposals: current,
          reason: result.failure,
        }),
      };
    }

    const { layout, remaining } = result.success;

    const proposals = {
      ...current,
      layout: remaining,
      revision: current.revision + 1,
    };

    server = { ...server, layout, proposals };

    return {
      _tag: "Saved",
      value: { layout, message: "Accepted", proposals, revision: 1 },
    };
  };

  /** Sends one write and gives the page the answer, after telling it of the change. */
  const send = (write: PendingWrite) =>
    Match.valueTags(write, {
      Accept: ({ ids }) => {
        const answer = accept(ids);

        if (Predicate.isTagged(answer, "Saved")) {
          tell();
        }

        dispatch({ _tag: "Accepted", answer });
      },
      Layout: ({ write: layout }) => {
        // A failure or conflict dropped it from the queue while it waited.
        if (!isQueued(session, layout)) {
          return;
        }

        const body = { baseFileRevision: layout.base, layout: layout.layout };

        sent.push(body);

        const answer = putLayout(body);

        // The server tells every page of a write before it answers.
        if (Predicate.isTagged(answer, "Saved")) {
          tell();
        }

        dispatch({ _tag: "Written", answer, write: layout });
      },
    });

  const settle = () => {
    for (
      let next = waiting.shift();
      next !== undefined;
      next = waiting.shift()
    ) {
      send(next);
    }
  };

  const agentIds = countingIds();

  const propose = (
    proposal: AgentProposal,
    reason: string
  ): string | undefined => {
    const current = proposalsOf(server);

    const base = layoutUnderProposals({
      data: server.data,
      layout: server.layout,
      proposals: current,
    });

    const proposed = Result.flatMap(
      proposeAgentChange({
        base,
        changes: current.layout,
        frozen: frozenLayoutChanges(current),
        newId: () => `agent-${agentIds()}`,
        proposal,
        reason,
      }),
      (after) =>
        Option.match(
          Option.orElse(frozenWriteRefusal({ after, proposals: current }), () =>
            layoutRefusal({
              accepted: base,
              after,
              before: current.layout,
              hops: server.data.hops,
            })
          ),
          {
            onNone: () => Result.succeed(after),
            onSome: (why) => Result.fail(why),
          }
        )
    );

    if (
      Result.isSuccess(proposed) &&
      !sameLayoutChanges(proposed.success, current.layout)
    ) {
      server = {
        ...server,
        proposals: {
          ...current,
          layout: proposed.success,
          revision: current.revision + 1,
        },
      };
      tell();
    }

    return Option.getOrUndefined(Result.getFailure(proposed));
  };

  return {
    dispatch,
    server: {
      propose,
      replaceProposals: (proposals, { mapBroken }) => {
        server = { ...server, proposals };

        if (mapBroken) {
          dispatch({ _tag: "ReceiveProposals", proposals });
        } else {
          tell();
        }
      },
      sent: () => sent,
      state: () => server,
      writeLayout: (layout) => {
        const current = proposalsOf(server);

        server = {
          ...server,
          proposals: { ...current, layout, revision: current.revision + 1 },
        };
        tell();
      },
    },
    settle,
    view: () => pendingView(session),
  };
};

/** The ids of `changes`, for comparing lists without their content. */
export const idsOf = (changes: ReadonlyArray<LayoutChange>) =>
  Arr.map(changes, ({ id }) => id);
