import {
  Accepted,
  AcceptWrite,
  discardChange,
  emptyProposals,
  LayoutChangeRefused,
  layoutRefusal,
  MapFilesUnreadable,
  newChangeId,
  PendingLayoutWrite,
  placeStructure,
  Proposals,
  ServedPage,
  servedPageElementId,
  ServerEvent,
  StaleProposals,
} from "@axonometric/contracts";
import type {
  ChangeId,
  Layout,
  LayoutChange,
  MapProblem,
  MapState,
  Placement,
} from "@axonometric/contracts";
import {
  Array as Arr,
  Duration,
  Effect,
  Match,
  Option,
  Predicate,
  Result,
  Schema,
  Semaphore,
} from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";

const decodeServed = Schema.decodeUnknownOption(
  Schema.fromJsonString(ServedPage)
);

const decodeEvent = Schema.decodeUnknownResult(
  Schema.fromJsonString(ServerEvent)
);

const encodeWrite = Schema.encodeEffect(
  Schema.fromJsonString(PendingLayoutWrite)
);

const encodeAccept = Schema.encodeEffect(Schema.fromJsonString(AcceptWrite));

const decodeSaved = Schema.decodeUnknownOption(
  Schema.fromJsonString(Proposals)
);

const decodeAccepted = Schema.decodeUnknownOption(
  Schema.fromJsonString(Accepted)
);

const WriteRefusal = Schema.Union([
  StaleProposals,
  LayoutChangeRefused,
  MapFilesUnreadable,
]);

const decodeRefusal = Schema.decodeUnknownOption(
  Schema.fromJsonString(WriteRefusal)
);

/**
 * Where the server's events are, when `axonometric serve` served this page.
 * The read-only file from `build` has none.
 */
export const readServedPage = (document: Document): Option.Option<ServedPage> =>
  Option.flatMap(
    Option.fromNullOr(document.querySelector(`#${servedPageElementId}`)),
    (element) => decodeServed(element.textContent)
  );

/** What the server said is wrong with the map files. */
export interface Rejection {
  readonly summary: string;
  readonly problems: readonly MapProblem[];
}

/** Why the last edit didn't save, as the page tells the engineer. */
export interface EditNotice {
  readonly kind: "conflict" | "refused" | "failed";
  readonly message: string;
}

/** The revision an accept just saved, shown for a few seconds. */
export interface SavedRevision {
  readonly revision: number;
  readonly message: string;
}

/** What a served page shows. */
export interface ServedView {
  /** The last good map, with what `proposals.json` held at last word. */
  readonly state: MapState;
  /** Why the map files on disk don't make a map, or null when they do. */
  readonly rejection: Rejection | null;
  /** Whether the page has lost its connection to the server. */
  readonly stopped: boolean;
  /**
   * The pending layout changes the page shows: those saved, with any edit
   * still on its way to the server.
   */
  readonly pending: readonly LayoutChange[];
  /** Why the last edit didn't save, until the next edit. */
  readonly notice: EditNotice | null;
  /** The revision the last accept saved, for a few seconds. */
  readonly saved: SavedRevision | null;
  /**
   * Whether an accept is waiting for the saves before it, or on its way to
   * the server. Edits are refused meanwhile, because they'd be saved over
   * the changes the accept takes.
   */
  readonly accepting: boolean;
}

/**
 * An edit to the pending layout changes: the list it makes from `changes`,
 * given the accepted layout. It must give the same answer each time it's
 * run, ids included, so it can be run again on a fresher list.
 */
export type Edit = (
  changes: readonly LayoutChange[],
  accepted: Layout
) => readonly LayoutChange[];

export interface ServedStore {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => ServedView;
  /**
   * Why putting structure `id` at `next` would be refused, or `undefined`
   * when it wouldn't.
   */
  readonly refusalOf: (id: string, next: Placement) => string | undefined;
  /**
   * Puts structure `id` at `next` as pending changes, shown at once and
   * saved to `proposals.json`. Returns why it was refused, or `undefined`.
   */
  readonly place: (id: string, next: Placement) => string | undefined;
  /**
   * Removes the pending change with `id`. Returns why it was refused, or
   * `undefined`.
   */
  readonly discard: (id: ChangeId) => string | undefined;
  /**
   * Accepts the pending layout changes with these ids, or all of them, as one
   * revision, once the saves already on their way are done. An empty
   * `message` has the server write one.
   */
  readonly accept: (
    ids: "all" | Arr.NonEmptyReadonlyArray<ChangeId>,
    message: string
  ) => void;
}

/** The edits run again on a fresh list: the list so far, or why one failed. */
interface Rerun {
  readonly layout: readonly LayoutChange[];
  readonly reason: Option.Option<string>;
}

/** An edit that puts `id` at `next`, with change ids fixed up front. */
const placing = (id: string, next: Placement): Edit => {
  const ids = [newChangeId(), newChangeId()];

  return (changes, accepted) => {
    let used = 0;

    return placeStructure({
      changes,
      accepted,
      id,
      next,
      newId: () => {
        const made = ids[used] ?? newChangeId();

        used += 1;

        return made;
      },
    });
  };
};

/** A write waiting its turn to be sent. */
interface Queued {
  /** The edit, to run again on a fresher list. */
  readonly edit: Edit;
  /** The file revision the write is based on, fixed when it was made. */
  readonly base: number;
  /** The whole list the write sets. */
  readonly layout: readonly LayoutChange[];
  /** Whether this is the write sent again after a conflict. */
  readonly retried: boolean;
}

/** How long to wait before reconnecting a stream the browser gave up on. */
const retryDelay = Duration.seconds(2);

/** How long "Saved revision n" stays on the page. */
const savedShown = Duration.seconds(4);

/** What `connectServed` starts from. */
export interface ServedSource {
  /** The map inlined into the page. */
  readonly initial: MapState;
  readonly served: ServedPage;
}

/** What `proposals.json` held when `state` was sent. */
const proposalsOf = (state: MapState): Proposals =>
  state.proposals ?? emptyProposals;

const savedLayout = (state: MapState) => proposalsOf(state).layout;

const conflictMessage = (reason: Option.Option<string>) =>
  `The pending changes changed on disk before this edit saved. The page now shows what's saved. ${Option.match(
    reason,
    {
      onNone: () => "Make the edit again.",
      onSome: (why) => `Your edit no longer fits: ${why}`,
    }
  )}`;

const problemsText = (problems: readonly MapProblem[]) =>
  Arr.join(
    Arr.map(problems, (problem) => problem.message),
    " "
  );

/** What the page says when the server refuses a write. */
const noticeOf = Match.type<typeof WriteRefusal.Type>().pipe(
  Match.tagsExhaustive({
    StaleProposals: (): EditNotice => ({
      kind: "conflict",
      message: conflictMessage(Option.none()),
    }),
    LayoutChangeRefused: ({ reason }): EditNotice => ({
      kind: "refused",
      message: reason,
    }),
    MapFilesUnreadable: ({ problems }): EditNotice => ({
      kind: "failed",
      message: `The edit wasn't saved: ${problemsText(problems)}`,
    }),
  })
);

/**
 * Connects to the server's events and keeps the latest map. The browser
 * reconnects a dropped stream on its own. It gives up instead after an error
 * response, such as a reverse proxy's 502 while the server is down, and then
 * the store starts a new stream.
 */
export const connectServed = ({
  initial,
  served,
}: ServedSource): ServedStore => {
  const listeners = new Set<() => void>();

  let view: ServedView = {
    state: initial,
    rejection: null,
    stopped: false,
    pending: savedLayout(initial),
    notice: null,
    saved: null,
    accepting: false,
  };

  /**
   * The writes asked for and not answered, oldest first. Each holds the
   * file revision it was made against and the list it makes, both fixed
   * when the edit was made, so a write can't be sent against a revision it
   * wasn't built on.
   */
  let queue: readonly Queued[] = [];

  /** Goes up when the queue is dropped, so waiting writes know to skip. */
  let generation = 0;

  const update = (next: Partial<ServedView>) => {
    view = { ...view, ...next };

    for (const listener of listeners) {
      listener();
    }
  };

  /**
   * The pending changes to show once `state` is the latest word: what it
   * saved, unless a write is still on its way.
   */
  const pendingAfter = (state: MapState) =>
    queue.length === 0 ? savedLayout(state) : view.pending;

  /** Takes the map the server holds. */
  const receive = (state: MapState) => {
    update({
      state,
      rejection: null,
      stopped: false,
      pending: pendingAfter(state),
    });
  };

  const connect = () => {
    const source = new EventSource(new URL(served.events, document.baseURI));

    source.addEventListener("open", () => {
      if (view.stopped) {
        update({ stopped: false });
      }
    });

    source.addEventListener("message", (message) => {
      const decoded = decodeEvent(message.data);

      if (Result.isFailure(decoded)) {
        return;
      }

      ServerEvent.match(decoded.success, {
        MapUpdated: ({ state }) => {
          receive(state);
        },
        MapRejected: ({ summary, problems }) => {
          update({ rejection: { summary, problems }, stopped: false });
        },
        PendingUpdated: ({ proposals }) => {
          const state = { ...view.state, proposals };

          update({ state, pending: pendingAfter(state) });
        },
        Heartbeat: () => {},
      });
    });

    source.addEventListener("error", () => {
      if (!view.stopped) {
        update({ stopped: true });
      }

      if (source.readyState === EventSource.CLOSED) {
        source.close();
        Effect.runFork(reconnect);
      }
    });
  };

  const reconnect = Effect.sleep(retryDelay).pipe(
    Effect.andThen(Effect.sync(connect))
  );

  /** Writes go to the server one at a time, in the order they were made. */
  const writeTurn = Semaphore.makeUnsafe(1);

  /** Shows `proposals` as what's saved, with `notice`, and drops the queue. */
  const adopt = (proposals: Proposals, notice: EditNotice | null) => {
    generation += 1;
    queue = [];
    update({
      state: { ...view.state, proposals },
      pending: proposals.layout,
      notice,
    });
  };

  const failed = (message: string) => {
    generation += 1;
    queue = [];
    update({
      pending: savedLayout(view.state),
      notice: { kind: "failed", message },
    });
  };

  /** The write at the front of the queue went through. */
  const confirm = (sent: Queued, proposals: Proposals) => {
    queue = Arr.filter(queue, (queued) => queued !== sent);

    const state = { ...view.state, proposals };

    update({ state, pending: pendingAfter(state), notice: null });
  };

  /**
   * The server's file moved on before a write was sent. Drops the queue, and
   * runs the edits again on `fresh`, the file as it is now. When they all
   * still fit, they're sent once more, based on `fresh`'s revision; when one
   * doesn't, or that write is refused too, the page keeps `fresh` and says
   * the edit conflicted.
   */
  const recover = (stale: Queued, fresh: Proposals) => {
    const edits = Arr.map(queue, ({ edit }) => edit);
    const accepted = view.state.layout;

    const start: Rerun = { layout: fresh.layout, reason: Option.none() };

    const rerun = Arr.reduce(edits, start, (so, edit): Rerun => {
      if (Option.isSome(so.reason)) {
        return so;
      }

      const after = edit(so.layout, accepted);

      const refusal = layoutRefusal({ accepted, before: so.layout, after });

      return Option.isNone(refusal)
        ? { layout: after, reason: Option.none() }
        : { layout: so.layout, reason: refusal };
    });

    if (stale.retried || Option.isSome(rerun.reason)) {
      adopt(fresh, {
        kind: "conflict",
        message: conflictMessage(rerun.reason),
      });

      return;
    }

    adopt(fresh, null);
    enqueue({
      edit: (changes) => changes,
      base: fresh.revision,
      layout: rerun.layout,
      retried: true,
    });
  };

  const send = (sent: Queued, turn: number) =>
    Effect.gen(function* () {
      if (turn !== generation) {
        return;
      }

      const body = yield* encodeWrite({
        baseRevision: sent.base,
        layout: sent.layout,
      }).pipe(Effect.orDie);

      const client = yield* HttpClient.HttpClient;

      const response = yield* client.execute(
        HttpClientRequest.put(
          new URL(served.pendingLayout, document.baseURI)
        ).pipe(HttpClientRequest.bodyText(body, "application/json"))
      );

      const { status } = response;
      const ok = status >= 200 && status < 300;
      const text = yield* response.text;

      if (ok) {
        Option.match(decodeSaved(text), {
          onNone: () => {
            failed("The server's answer didn't make sense. Reload the page.");
          },
          onSome: (proposals) => {
            confirm(sent, proposals);
          },
        });

        return;
      }

      Option.match(decodeRefusal(text), {
        onNone: () => {
          failed(`The server refused the edit (${status}): ${text.trim()}`);
        },
        onSome: (refusal) => {
          if (Predicate.isTagged(refusal, "StaleProposals")) {
            recover(sent, refusal.proposals);
          } else if (Predicate.isTagged(refusal, "LayoutChangeRefused")) {
            adopt(refusal.proposals, noticeOf(refusal));
          } else {
            failed(noticeOf(refusal).message);
          }
        },
      });
    }).pipe(
      Effect.catchTag("HttpClientError", () =>
        Effect.sync(() => {
          failed(
            "The edit wasn't saved: the server didn't answer. It may have stopped."
          );
        })
      )
    );

  /** Queues a write and starts it when the ones before it are done. */
  const enqueue = (queued: Queued) => {
    queue = [...queue, queued];
    update({ pending: queued.layout });

    const turn = generation;

    Effect.runFork(
      writeTurn
        .withPermit(send(queued, turn))
        // oxlint-disable-next-line effecttsgo/strict-effect-provide -- each write runs on its own, so this is its entry point.
        .pipe(Effect.provide(FetchHttpClient.layer))
    );
  };

  /** Why `edit` would be refused, and the list it would make. */
  const tryEdit = (edit: Edit) => {
    const accepted = view.state.layout;
    const before = view.pending;
    const after = edit(before, accepted);

    return { after, refusal: layoutRefusal({ accepted, before, after }) };
  };

  /** Runs `edit`, queues its write, or returns why it was refused. */
  const run = (edit: Edit): string | undefined => {
    if (view.accepting) {
      return "Accepting the pending changes. Make this edit once that's saved.";
    }

    const { after, refusal } = tryEdit(edit);

    if (Option.isSome(refusal)) {
      return refusal.value;
    }

    // The next write is built on the one before it, so it's based on the
    // revision that one will make. If someone else writes first, the server
    // refuses it as stale instead.
    const last = queue.at(-1);

    enqueue({
      edit,
      base:
        last === undefined ? proposalsOf(view.state).revision : last.base + 1,
      layout: after,
      retried: false,
    });
    update({ notice: null });

    return undefined;
  };

  /** Shows the revision just saved, and takes it down after a few seconds. */
  const showSaved = (saved: SavedRevision) => {
    update({ saved });

    const takeDown = Effect.sync(() => {
      if (view.saved === saved) {
        update({ saved: null });
      }
    });

    Effect.runFork(Effect.sleep(savedShown).pipe(Effect.andThen(takeDown)));
  };

  /** Sends an accept once the writes before it are done. */
  const sendAccept = (
    ids: "all" | Arr.NonEmptyReadonlyArray<ChangeId>,
    message: string
  ) =>
    Effect.gen(function* () {
      const text = message.trim();

      const base = {
        baseRevision: proposalsOf(view.state).revision,
        changeIds: ids,
      };

      const body = yield* encodeAccept(
        text === "" ? base : { ...base, message: text }
      ).pipe(Effect.orDie);

      const client = yield* HttpClient.HttpClient;

      const response = yield* client.execute(
        HttpClientRequest.post(new URL(served.accept, document.baseURI)).pipe(
          HttpClientRequest.bodyText(body, "application/json")
        )
      );

      const { status } = response;
      const answer = yield* response.text;

      if (status >= 200 && status < 300) {
        Option.match(decodeAccepted(answer), {
          onNone: () => {
            failed("The server's answer didn't make sense. Reload the page.");
          },
          onSome: ({ revision, message: saved, layout, proposals }) => {
            update({
              state: { ...view.state, layout, proposals },
              pending: proposals.layout,
              notice: null,
            });
            showSaved({ revision, message: saved });
          },
        });

        return;
      }

      Option.match(decodeRefusal(answer), {
        onNone: () => {
          failed(`The server refused the accept (${status}): ${answer.trim()}`);
        },
        onSome: (refusal) => {
          if (Predicate.isTagged(refusal, "StaleProposals")) {
            adopt(refusal.proposals, {
              kind: "conflict",
              message:
                "The pending changes changed on disk before this accept. The page now shows what's pending. Accept again if the changes are still right.",
            });
          } else if (Predicate.isTagged(refusal, "LayoutChangeRefused")) {
            adopt(refusal.proposals, noticeOf(refusal));
          } else {
            failed(noticeOf(refusal).message);
          }
        },
      });
    }).pipe(
      Effect.catchTag("HttpClientError", () =>
        Effect.sync(() => {
          failed(
            "The accept wasn't saved: the server didn't answer. It may have stopped."
          );
        })
      ),
      Effect.ensuring(
        Effect.sync(() => {
          update({ accepting: false });
        })
      )
    );

  connect();

  return {
    subscribe: (listener) => {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => view,
    refusalOf: (id, next) =>
      Option.getOrUndefined(tryEdit(placing(id, next)).refusal),
    place: (id, next) => run(placing(id, next)),
    discard: (id) => run((changes) => discardChange(changes, id)),
    accept: (ids, message) => {
      if (view.accepting || view.pending.length === 0) {
        return;
      }

      update({ accepting: true, notice: null });

      Effect.runFork(
        writeTurn
          .withPermit(sendAccept(ids, message))
          // oxlint-disable-next-line effecttsgo/strict-effect-provide -- each write runs on its own, so this is its entry point.
          .pipe(Effect.provide(FetchHttpClient.layer))
      );
    },
  };
};
