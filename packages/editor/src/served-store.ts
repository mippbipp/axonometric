import {
  emptyProposals,
  LayoutChangeRefused,
  MapFilesUnreadable,
  PendingLayoutWrite,
  Proposals,
  ServedPage,
  servedPageElementId,
  ServerEvent,
  StaleProposals,
} from "@axonometric/contracts";
import type {
  LayoutChange,
  MapProblem,
  MapState,
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

const decodeSaved = Schema.decodeUnknownOption(
  Schema.fromJsonString(Proposals)
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
}

export interface ServedStore {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => ServedView;
  /**
   * Shows `layout` as the pending layout changes at once, and saves it to
   * `proposals.json`. Writes go one at a time, each based on the revision
   * the one before it saved.
   */
  readonly writeLayout: (layout: readonly LayoutChange[]) => void;
}

/** How long to wait before reconnecting a stream the browser gave up on. */
const retryDelay = Duration.seconds(2);

/** What `connectServed` starts from. */
export interface ServedSource {
  /** The map inlined into the page. */
  readonly initial: MapState;
  readonly served: ServedPage;
}

const savedLayout = (state: MapState) =>
  (state.proposals ?? emptyProposals).layout;

const conflictMessage =
  "The pending changes changed on disk before this edit saved, so it wasn't saved. The page now shows what's saved. Make the edit again.";

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
      message: conflictMessage,
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
  };

  /** How many writes have been asked for and not answered. */
  let writing = 0;

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
    writing === 0 ? savedLayout(state) : view.pending;

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

  const one = Semaphore.makeUnsafe(1);

  /** Takes what `proposals.json` holds after a write or a refused one. */
  const saved = (proposals: Proposals, notice: EditNotice | null) => {
    writing -= 1;

    const state = { ...view.state, proposals };

    update({ state, pending: pendingAfter(state), notice });
  };

  const failed = (message: string) => {
    writing -= 1;
    update({
      pending: pendingAfter(view.state),
      notice: { kind: "failed", message },
    });
  };

  const send = (layout: readonly LayoutChange[]) =>
    Effect.gen(function* () {
      const body = yield* encodeWrite({
        baseRevision: (view.state.proposals ?? emptyProposals).revision,
        layout,
      });

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
        return Option.match(decodeSaved(text), {
          onNone: () => {
            failed("The server's answer didn't make sense. Reload the page.");
          },
          onSome: (proposals) => {
            saved(proposals, null);
          },
        });
      }

      return Option.match(decodeRefusal(text), {
        onNone: () => {
          failed(`The server refused the edit (${status}): ${text.trim()}`);
        },
        onSome: (refusal) => {
          if (Predicate.isTagged(refusal, "MapFilesUnreadable")) {
            failed(noticeOf(refusal).message);
          } else {
            saved(refusal.proposals, noticeOf(refusal));
          }
        },
      });
    }).pipe(
      Effect.catch(() =>
        Effect.sync(() => {
          failed(
            "The edit wasn't saved: the server didn't answer. It may have stopped."
          );
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
    writeLayout: (layout) => {
      writing += 1;
      update({ pending: layout, notice: null });
      Effect.runFork(
        one
          .withPermit(send(layout))
          // oxlint-disable-next-line effecttsgo/strict-effect-provide -- each write runs on its own, so this is its entry point.
          .pipe(Effect.provide(FetchHttpClient.layer))
      );
    },
  };
};
