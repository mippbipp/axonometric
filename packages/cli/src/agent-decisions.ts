import type {
  AgentDecision,
  LayoutChange,
  ServerStatus,
} from "@axonometric/contracts";
import { Array as Arr, Clock, DateTime, Effect, Option, Ref } from "effect";
import type { Scope } from "effect";

/** How many decisions the server keeps. Older ones are dropped. */
export const maxDecisions = 50;

/**
 * What the server knows about the engineer's side: how many pages are
 * watching and what they decided on the agent's changes. It lives in memory,
 * so a restart empties it.
 */
export interface AgentDecisions {
  /** Counts a page for as long as the scope stays open. */
  readonly connected: Effect.Effect<void, never, Scope.Scope>;
  /** Logs `changes` as decided, all at one time. Call it once the files are saved. */
  readonly record: (
    changes: ReadonlyArray<LayoutChange>,
    decision: AgentDecision["decision"]
  ) => Effect.Effect<void>;
  /** The page count, the time to pass next, and the decisions after `since`. */
  readonly status: (since?: DateTime.Utc) => Effect.Effect<ServerStatus>;
}

/**
 * Times come from one stamp that only rises, so a decision recorded after a
 * `now` was handed out is always later than it. Asking again `since` that
 * `now` neither misses a decision nor repeats one.
 */
export const makeAgentDecisions = Effect.gen(function* () {
  // `droppedAt` is when the newest decision cut for the cap was recorded.
  // Decisions only rise in time, so one was lost after `since` exactly when
  // `droppedAt` is later than `since`.
  const log = yield* Ref.make<{
    readonly droppedAt: number;
    readonly held: ReadonlyArray<AgentDecision>;
  }>({ droppedAt: Number.NEGATIVE_INFINITY, held: [] });
  const pages = yield* Ref.make(0);
  const last = yield* Ref.make(Number.NEGATIVE_INFINITY);

  const stamp = Effect.gen(function* () {
    const clock = yield* Clock.currentTimeMillis;

    return yield* Ref.modify(last, (before) => {
      const next = Math.max(clock, before + 1);

      return [DateTime.makeUnsafe(next), next] as const;
    });
  });

  const connected = Effect.acquireRelease(
    Ref.update(pages, (count) => count + 1),
    () => Ref.update(pages, (count) => count - 1)
  ).pipe(Effect.asVoid);

  const record: AgentDecisions["record"] = Effect.fnUntraced(
    function* (changes, decision) {
      const agent = Arr.filter(changes, ({ by }) => by === "agent");

      if (agent.length === 0) {
        return;
      }

      const at = yield* stamp;

      yield* Ref.update(log, ({ droppedAt, held }) => {
        const all = [
          ...held,
          ...Arr.map(agent, (change) => ({ at, change, decision })),
        ];

        const [dropped, kept] = Arr.splitAt(
          all,
          Math.max(0, all.length - maxDecisions)
        );

        return {
          droppedAt: Option.match(Arr.last(dropped), {
            onNone: () => droppedAt,
            onSome: (cut) => DateTime.toEpochMillis(cut.at),
          }),
          held: kept,
        };
      });
    }
  );

  const status: AgentDecisions["status"] = Effect.fnUntraced(function* (since) {
    const now = yield* stamp;
    const { droppedAt, held } = yield* Ref.get(log);

    return {
      decisions:
        since === undefined
          ? []
          : Arr.filter(held, ({ at }) => DateTime.isGreaterThan(at, since)),
      now,
      pages: yield* Ref.get(pages),
      truncated:
        since !== undefined && droppedAt > DateTime.toEpochMillis(since),
    };
  });

  return { connected, record, status } satisfies AgentDecisions;
});
