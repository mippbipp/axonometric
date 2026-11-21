/* oxlint-disable perfectionist/sort-objects -- schema and table field order sets encoded JSON key order, message order and listing order, so it stays as written */
import {
  Accepted,
  AcceptWrite,
  ChapterWrite,
  emptyProposals,
  FlowWrite,
  FreezeAnswer,
  FreezeWrite,
  GroupWrite,
  HopWrite,
  isQueued,
  ItemEdit,
  ItemWrite,
  LayoutChangeRefused,
  MapFilesUnreadable,
  newChangeId,
  NoteAdd,
  QuestionAdd,
  SuggestionAdd,
  AnswerAdd,
  PendingLayoutWrite,
  pendingRefusal,
  pendingView,
  ProposalRefused,
  Proposals,
  proposedMap,
  proposeFlow,
  proposeHop,
  proposeStructure,
  ReopenWrite,
  ServedPage,
  servedPageElementId,
  ServerEvent,
  StaleProposals,
  startPending,
  stepPending,
  StructureWrite,
} from "@axonometric/contracts";
import type {
  Arrangement,
  ChangeId,
  ChapterChange,
  FlowChange,
  GroupChange,
  GridPoint,
  HistoryList,
  HopChange,
  LayoutWrite,
  MapProblem,
  MapSnapshot,
  MapState,
  NoteTarget,
  PendingEdit,
  PendingInput,
  PendingView,
  Placement,
  StructureChange,
  StructureMove,
  TextField,
  WriteAnswer,
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

import { loadRevision } from "./history-client.ts";
import type { LoadedRevision } from "./history-client.ts";

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
  ProposalRefused,
]);

const ReviewRefusal = Schema.Union([
  StaleProposals,
  ProposalRefused,
  MapFilesUnreadable,
]);

const decodeReviewRefusal = Schema.decodeUnknownOption(
  Schema.fromJsonString(ReviewRefusal)
);

const decodeFrozen = Schema.decodeUnknownOption(
  Schema.fromJsonString(FreezeAnswer)
);

const encodeNoteAdd = Schema.encodeEffect(Schema.fromJsonString(NoteAdd));

const encodeSuggestionAdd = Schema.encodeEffect(
  Schema.fromJsonString(SuggestionAdd)
);

const encodeAnswerAdd = Schema.encodeEffect(Schema.fromJsonString(AnswerAdd));

const encodeQuestionAdd = Schema.encodeEffect(
  Schema.fromJsonString(QuestionAdd)
);

const encodeItemEdit = Schema.encodeEffect(Schema.fromJsonString(ItemEdit));

const encodeItem = Schema.encodeEffect(Schema.fromJsonString(ItemWrite));

const encodeStructure = Schema.encodeEffect(
  Schema.fromJsonString(StructureWrite)
);

const encodeHop = Schema.encodeEffect(Schema.fromJsonString(HopWrite));

const encodeFlow = Schema.encodeEffect(Schema.fromJsonString(FlowWrite));

const encodeGroup = Schema.encodeEffect(Schema.fromJsonString(GroupWrite));

const encodeChapter = Schema.encodeEffect(Schema.fromJsonString(ChapterWrite));

const encodeFreeze = Schema.encodeEffect(Schema.fromJsonString(FreezeWrite));

const encodeReopen = Schema.encodeEffect(Schema.fromJsonString(ReopenWrite));

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
  readonly problems: ReadonlyArray<MapProblem>;
  readonly summary: string;
}

/** The revision an accept just saved, shown for a few seconds. */
export interface SavedRevision {
  readonly message: string;
  readonly revision: number;
}

/** What a served page shows: the pending changes, and how the server is. */
export interface ServedView extends PendingView {
  /** The revisions, newest first, or null until the server has said. */
  readonly history: HistoryList | null;
  /** Why the map files on disk don't make a map, or null when they do. */
  readonly rejection: Rejection | null;
  /** The revision the last accept saved, for a few seconds. */
  readonly saved: SavedRevision | null;
  /** Whether the page has lost its connection to the server. */
  readonly stopped: boolean;
}

export interface ServedStore {
  /**
   * Accepts the pending layout changes with these ids, or all of them, as one
   * revision, once the saves already on their way are done. An empty
   * `message` has the server write one.
   */
  readonly accept: (
    ids: "all" | Arr.NonEmptyReadonlyArray<ChangeId>,
    message: string
  ) => void;
  /**
   * Moves, nudges, aligns or distributes a set as one pending change: `plan`
   * is given where the structures sit once every pending change is applied,
   * and returns the moves. It runs on the latest list each time, so quick
   * repeats add up. A refusal also shows as a notice. Returns why it was
   * refused, or `undefined`.
   */
  readonly arrange: (plan: Arrangement) => string | undefined;
  /** Proposals to change what a chapter reveals and plays. */
  readonly chapters: ChapterStoreOps;
  /**
   * Removes the pending changes with `ids`, as one write and one undo step.
   * Returns why it was refused, or `undefined`.
   */
  readonly discard: (
    ids: Arr.NonEmptyReadonlyArray<ChangeId>
  ) => string | undefined;
  /** Proposals to create and rename flows, and to order their hops and the flows. */
  readonly flows: FlowOps;
  readonly getSnapshot: () => ServedView;
  /** Proposals to create and rename groups. */
  readonly groups: GroupStoreOps;
  /** Proposals to draw, delete or relabel hops. */
  readonly hops: HopOps;
  /** Reads revision `n` from the server. */
  readonly loadRevision: (n: number) => Effect.Effect<LoadedRevision>;
  /**
   * Puts structure `id` at `next` as pending changes, shown at once and
   * saved to `proposals.json`. A refusal also shows as a notice. Returns why
   * it was refused, or `undefined`.
   */
  readonly place: (id: string, next: Placement) => string | undefined;
  /** Redoes the edit that `undo` took back. */
  readonly redo: () => void;
  /**
   * Why putting structure `id` at `next` would be refused, or `undefined`
   * when it wouldn't.
   */
  readonly refusalOf: (id: string, next: Placement) => string | undefined;
  /**
   * Why moving several structures together as `moves` would be refused, or
   * `undefined` when it wouldn't.
   */
  readonly refusalOfMoves: (
    moves: ReadonlyArray<StructureMove>
  ) => string | undefined;
  /** Why `reroute` would refuse `points` for `hop`, without saving anything. */
  readonly refusalOfReroute: (
    hop: string,
    points: ReadonlyArray<GridPoint> | null
  ) => string | undefined;
  /**
   * Gives hop `hop` the route override `points` as a pending change, or puts
   * it back on automatic routing with `null`. A refusal also shows as a
   * notice. Returns why it was refused, or `undefined`.
   */
  readonly reroute: (
    hop: string,
    points: ReadonlyArray<GridPoint> | null
  ) => string | undefined;
  /**
   * Puts every structure where `revision` has it, as any other edit: shown
   * at once, saved, and one undo step. An edit that changes nothing is not a
   * step. Returns why it was refused, or `undefined`. A refusal is not a
   * notice: the caller says it.
   */
  readonly restore: (revision: MapSnapshot) => string | undefined;
  /** Notes and the review loop. */
  readonly review: ReviewOps;
  /** Proposals to add, delete or change structures. */
  readonly structures: StructureOps;
  readonly subscribe: (listener: () => void) => () => void;
  /**
   * Puts the pending changes back as they were before the last edit. A
   * refusal shows as a notice; the step is kept.
   */
  readonly undo: () => void;
}

/** Proposing groups, sent like the review writes. `done` runs when it ends. */
export interface GroupStoreOps {
  /** Removes an open group proposal. */
  readonly discard: (id: ChangeId, done: ReviewDone<ChangeId>) => void;
  /**
   * Proposes a new group or a new title. `members` are the structures that
   * go into a new group, each with the id of its group change, which the
   * server adds in the same write.
   */
  readonly propose: (
    change: GroupChange,
    members: ReadonlyArray<{
      readonly id: ChangeId;
      readonly structure: string;
    }>,
    done: ReviewDone<ChangeId>
  ) => void;
}

/** Proposing chapter changes, sent like the review writes. */
export interface ChapterStoreOps {
  /** Removes an open chapter proposal. */
  readonly discard: (id: ChangeId, done: ReviewDone<ChangeId>) => void;
  readonly propose: (change: ChapterChange, done: ReviewDone<ChangeId>) => void;
}

/**
 * Proposing changes to hops. Like the structure writes, each goes after the
 * layout writes already on their way, is based on the latest file revision,
 * and is sent again on a fresher file when another writer got in first.
 */
export interface HopOps {
  /**
   * Proposes `change`: a new hop, a deletion or a relabel. The server keeps
   * one proposal per hop and kind of change, and edits the proposal of a new
   * hop instead of adding another. `done` gets the id of the proposal.
   */
  readonly propose: (change: HopChange, done: ReviewDone<ChangeId>) => void;
  /** Why `change` would be refused, without sending it. */
  readonly refusalOf: (change: HopChange) => string | undefined;
}

/** Proposing changes to flows; see `HopOps`. */
export interface FlowOps {
  /** Proposes `change`; `done` gets the id of the proposal. */
  readonly propose: (change: FlowChange, done: ReviewDone<ChangeId>) => void;
  /** Why `change` would be refused, without sending it. */
  readonly refusalOf: (change: FlowChange) => string | undefined;
}

/**
 * Proposing changes to structures. Like the review writes, each goes after
 * the layout writes already on their way, is based on the latest file
 * revision, and is sent again on a fresher file when another writer got in
 * first. `done` runs when it ends.
 */
export interface StructureOps {
  /** Removes an open proposal. */
  readonly discard: (id: ChangeId, done: ReviewDone<ChangeId>) => void;
  /** Whether structure `id` is a new structure in an open proposal. */
  readonly isOpenAdd: (id: string) => boolean;
  /**
   * Puts a structure the engineer proposed, and has not sent yet, at
   * `next`. Returns why it was refused, or `undefined`; `done` runs when the
   * write ends.
   */
  readonly place: (
    id: string,
    next: Placement,
    done: ReviewDone<ChangeId>
  ) => string | undefined;
  /**
   * Proposes `change`: a new structure, a deletion, a rename, or a change of
   * shape, group or status. The server keeps one proposal per structure and
   * kind of change, and edits the proposal of a new structure instead of
   * adding another. `done` gets the id of the proposal.
   */
  readonly propose: (
    change: StructureChange,
    done: ReviewDone<ChangeId>
  ) => void;
  /**
   * Why `change` would be refused, without sending it. The server checks
   * again when it is sent.
   */
  readonly refusalOf: (change: StructureChange) => string | undefined;
  /**
   * Why putting the proposed structure `id` at `next` would be refused, or
   * `undefined` when it wouldn't, or when `id` isn't one the engineer proposed.
   */
  readonly refusalOfPlace: (id: string, next: Placement) => string | undefined;
}

/** Why a check failed, or `undefined` when it passed. */
const reasonOf = <A>(checked: Result.Result<A, string>): string | undefined =>
  Option.getOrUndefined(Result.getFailure(checked));

/** What a review write answers: the id of what it made or changed, or why it was refused. */
export type ReviewOutcome<A> = Result.Result<A, string>;

/** Called once with how a review write ended. */
export type ReviewDone<A> = (outcome: ReviewOutcome<A>) => void;

/**
 * What the engineer adds: one of the kinds of proposal that carries text,
 * without the id the page makes.
 */
export type NewItem =
  | {
      readonly kind: "note";
      readonly target: NoteTarget;
      readonly text: string;
    }
  | {
      readonly after: string;
      readonly before: string;
      readonly field: TextField;
      readonly kind: "suggestion";
      readonly structureId: string;
    }
  | {
      readonly answeredOn: string;
      readonly kind: "answer";
      readonly question: string;
      readonly structureId: string;
      readonly text: string;
    }
  | {
      readonly kind: "question";
      readonly structureId: string;
      readonly text: string;
    };

/**
 * The review loop's writes. Each goes after the layout writes already on
 * their way, is based on the latest file revision, and is sent again on a
 * fresher file when another writer got in first, such as the agent's commit,
 * so a note typed meanwhile is not lost. `done` runs when it ends.
 */
export interface ReviewOps {
  /**
   * Adds a note, text suggestion, answer or raised question as an open
   * proposal, and returns its id. The page makes the id, so a retry can't
   * add it twice.
   */
  readonly add: (item: NewItem, done: ReviewDone<ChangeId>) => void;
  /** Removes an open note, suggestion, answer or raised question. */
  readonly discardProposal: (id: ChangeId, done: ReviewDone<ChangeId>) => void;
  /** Takes a reviewed item off the page. */
  readonly dismiss: (id: ChangeId, done: ReviewDone<ChangeId>) => void;
  /** Changes the text of an open note, suggestion, answer or raised question. */
  readonly editProposal: (
    id: ChangeId,
    text: string,
    done: ReviewDone<ChangeId>
  ) => void;
  /** Freezes every open change and note into the next batch. */
  readonly freeze: (done: ReviewDone<FreezeAnswer>) => void;
  /**
   * Reopens a rejected item as a new open item, and returns its id. For a
   * note, `text` replaces the old text.
   */
  readonly reopen: (
    id: ChangeId,
    text: string | undefined,
    done: ReviewDone<ChangeId>
  ) => void;
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

const problemsText = (problems: ReadonlyArray<MapProblem>) =>
  Arr.join(
    Arr.map(problems, (problem) => problem.message),
    " "
  );

/** Where an item of this kind is added, on the page `served` describes. */
const urlOfNew = (served: ServedPage, item: NewItem): string =>
  Match.value(item).pipe(
    Match.discriminatorsExhaustive("kind")({
      note: () => served.notes,
      suggestion: () => served.suggestions,
      answer: () => served.answers,
      question: () => served.questions,
    })
  );

/** The body that adds `item` as `id`, on the file revision `base`. */
const encodeNew = (item: NewItem, id: ChangeId, base: number) =>
  Match.value(item).pipe(
    Match.discriminatorsExhaustive("kind")({
      note: ({ target, text }) =>
        encodeNoteAdd({ baseFileRevision: base, id, target, text }),
      suggestion: ({ structureId, field, before, after }) =>
        encodeSuggestionAdd({
          baseFileRevision: base,
          id,
          target: { kind: "structure", id: structureId },
          field,
          before,
          after,
        }),
      answer: ({ structureId, question, text, answeredOn }) =>
        encodeAnswerAdd({
          baseFileRevision: base,
          id,
          target: { kind: "structure", id: structureId },
          question,
          text,
          answeredOn,
        }),
      question: ({ structureId, text }) =>
        encodeQuestionAdd({
          baseFileRevision: base,
          id,
          target: { kind: "structure", id: structureId },
          text,
        }),
    })
  );

/**
 * Sends a write with `body` to `url`, and reads the answer as `decode` and
 * `decodeRefusal` say.
 */
const send = <A>({
  body,
  decode,
  method,
  url,
}: {
  readonly body: Effect.Effect<string>;
  readonly decode: (text: string) => Option.Option<A>;
  readonly method: "put" | "post";
  readonly url: string;
}): Effect.Effect<WriteAnswer<A>, never, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const text = yield* body;
    const client = yield* HttpClient.HttpClient;

    const response = yield* client.execute(
      HttpClientRequest[method](new URL(url, document.baseURI)).pipe(
        HttpClientRequest.bodyText(text, "application/json")
      )
    );

    const { status } = response;
    const answer = yield* response.text;

    if (status >= 200 && status < 300) {
      return Option.match(decode(answer), {
        onNone: (): WriteAnswer<A> => ({ _tag: "Garbled" }),
        onSome: (value): WriteAnswer<A> => ({ _tag: "Saved", value }),
      });
    }

    return Option.match(decodeRefusal(answer), {
      onNone: (): WriteAnswer<A> => ({
        _tag: "Unexplained",
        status,
        text: answer,
      }),
      onSome: (refusal): WriteAnswer<A> => ({ _tag: "Refused", refusal }),
    });
  }).pipe(
    Effect.catchTag("HttpClientError", () =>
      Effect.succeed<WriteAnswer<A>>({ _tag: "Unreachable" })
    )
  );

/**
 * Connects to the server's events and keeps the latest map. The browser
 * reconnects a dropped stream on its own. It gives up instead after an error
 * response, such as a reverse proxy's 502 while the server is down, and then
 * the store starts a new stream.
 *
 * The pending layout changes, undo and redo are a `PendingSession` from
 * contracts. The store feeds it what the engineer does and what the server
 * says, and sends the writes it asks for, one at a time.
 */
export const connectServed = ({
  initial,
  served,
}: ServedSource): ServedStore => {
  const listeners = new Set<() => void>();

  let session = startPending({ initial, newId: newChangeId });

  let view: ServedView = {
    ...pendingView(session),
    rejection: null,
    stopped: false,
    saved: null,
    history: null,
  };

  const publish = (next: Partial<ServedView> = {}) => {
    view = { ...view, ...next, ...pendingView(session) };

    for (const listener of listeners) {
      listener();
    }
  };

  /** Writes go to the server one at a time, in the order they were made. */
  const writeTurn = Semaphore.makeUnsafe(1);

  /** Steps the session, publishes it, and starts the writes it asks for. */
  const dispatch = (input: PendingInput, next: Partial<ServedView> = {}) => {
    const stepped = stepPending(session, input);
    const changed = stepped.session !== session;

    ({ session } = stepped);

    if (changed || Object.keys(next).length > 0) {
      publish(next);
    }

    for (const write of stepped.writes) {
      Effect.runFork(
        writeTurn
          .withPermit(
            Match.valueTags(write, {
              Layout: ({ write: layout }) => sendLayout(layout),
              Accept: ({ ids, message }) => sendAccept(ids, message),
            })
          )
          .pipe(Effect.provide(FetchHttpClient.layer))
      );
    }

    return stepped.refusal;
  };

  const apply = (edit: PendingEdit) => dispatch({ _tag: "Apply", edit });

  const connect = () => {
    const source = new EventSource(new URL(served.events, document.baseURI));

    source.addEventListener("open", () => {
      if (view.stopped) {
        publish({ stopped: false });
      }
    });

    source.addEventListener("message", (message) => {
      const decoded = decodeEvent(message.data);

      if (Result.isFailure(decoded)) {
        return;
      }

      ServerEvent.match(decoded.success, {
        MapUpdated: ({ state }) => {
          dispatch(
            { _tag: "Receive", state },
            { rejection: null, stopped: false }
          );
        },
        MapRejected: ({ summary, problems }) => {
          publish({ rejection: { summary, problems }, stopped: false });
        },
        PendingUpdated: ({ proposals }) => {
          dispatch({ _tag: "ReceiveProposals", proposals });
        },
        HistoryUpdated: ({ history: revisions }) => {
          publish({ history: revisions });
        },
        Heartbeat: () => {},
      });
    });

    source.addEventListener("error", () => {
      if (!view.stopped) {
        publish({ stopped: true });
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

  const sendLayout = (write: LayoutWrite) =>
    Effect.gen(function* () {
      // A failure or conflict dropped the queue while this one waited.
      if (!isQueued(session, write)) {
        return;
      }

      const answer = yield* send({
        body: encodeWrite({
          baseFileRevision: write.base,
          layout: write.layout,
        }).pipe(Effect.orDie),
        decode: decodeSaved,
        method: "put",
        url: served.pendingLayout,
      });

      dispatch({ _tag: "Written", answer, write });
    });

  /** Shows the revision just saved, and takes it down after a few seconds. */
  const showSaved = (saved: SavedRevision) => {
    publish({ saved });

    const takeDown = Effect.sync(() => {
      if (view.saved === saved) {
        publish({ saved: null });
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
        baseFileRevision: proposalsOf(session.state).revision,
        changeIds: ids,
      };

      const answer = yield* send({
        body: encodeAccept(
          text === "" ? base : { ...base, message: text }
        ).pipe(Effect.orDie),
        decode: decodeAccepted,
        method: "post",
        url: served.accept,
      });

      dispatch({ _tag: "Accepted", answer });

      if (Predicate.isTagged(answer, "Saved")) {
        showSaved({
          revision: answer.value.revision,
          message: answer.value.message,
        });
      }
    });

  /** One review write: where it goes, and how to send it and read the answer. */
  interface ReviewCall<A> {
    readonly encode: (base: number) => Effect.Effect<string>;
    /** Whether the write moves layout changes, which ends undo. */
    readonly endsUndo: boolean;
    readonly read: (text: string) => Option.Option<{
      readonly proposals: Proposals;
      readonly value: A;
    }>;
    readonly url: string;
  }

  /** Shows `proposals` as what the server holds, after one of our writes. */
  const adoptReviewed = (proposals: Proposals, endsUndo: boolean) => {
    dispatch({ _tag: "Reviewed", endsUndo, proposals });
  };

  /** The most times a review write is sent again on a fresher file. */
  const reviewTries = 3;

  const attemptReview = <A>(
    call: ReviewCall<A>,
    tries: number
  ): Effect.Effect<ReviewOutcome<A>, never, HttpClient.HttpClient> =>
    Effect.gen(function* () {
      const body = yield* call.encode(proposalsOf(view.state).revision);
      const client = yield* HttpClient.HttpClient;

      const response = yield* client.execute(
        HttpClientRequest.post(new URL(call.url, document.baseURI)).pipe(
          HttpClientRequest.bodyText(body, "application/json")
        )
      );

      const { status } = response;
      const text = yield* response.text;

      if (status >= 200 && status < 300) {
        return Option.match(call.read(text), {
          onNone: () =>
            Result.fail(
              "The server's answer didn't make sense. Reload the page."
            ),
          onSome: ({ value, proposals }) => {
            adoptReviewed(proposals, call.endsUndo);

            return Result.succeed(value);
          },
        });
      }

      return yield* Option.match(decodeReviewRefusal(text), {
        onNone: () =>
          Effect.succeed(
            Result.fail<string>(
              `The server refused the write (${status}): ${text.trim()}`
            )
          ),
        onSome: (refusal) => {
          if (Predicate.isTagged(refusal, "StaleProposals")) {
            // Someone else wrote the file first, such as the agent's commit.
            // Show their file, then send this write again on top of it.
            adoptReviewed(refusal.proposals, false);

            return tries + 1 < reviewTries
              ? attemptReview(call, tries + 1)
              : Effect.succeed(
                  Result.fail<string>(
                    "The map changed on disk while this was saving. The page now shows what's saved. Try again."
                  )
                );
          }

          if (Predicate.isTagged(refusal, "ProposalRefused")) {
            adoptReviewed(refusal.proposals, false);

            return Effect.succeed(Result.fail<string>(refusal.reason));
          }

          return Effect.succeed(
            Result.fail<string>(problemsText(refusal.problems))
          );
        },
      });
    }).pipe(
      Effect.catchTag("HttpClientError", () =>
        Effect.succeed(
          Result.fail<string>(
            "Nothing was saved: the server didn't answer. It may have stopped."
          )
        )
      )
    );

  /** Sends a review write once the layout writes before it are done. */
  const callReview = <A>(call: ReviewCall<A>, done: ReviewDone<A>) => {
    Effect.runFork(
      writeTurn.withPermit(attemptReview(call, 0)).pipe(
        Effect.tap((outcome) =>
          Effect.sync(() => {
            done(outcome);
          })
        ),
        Effect.provide(FetchHttpClient.layer)
      )
    );
  };

  const readProposalsWith =
    (id: ChangeId) =>
    (answer: string): ReturnType<ReviewCall<ChangeId>["read"]> =>
      Option.map(decodeSaved(answer), (proposals) => ({
        value: id,
        proposals,
      }));

  const writeItem = (id: ChangeId, url: string, done: ReviewDone<ChangeId>) => {
    callReview<ChangeId>(
      {
        url,
        encode: (base) =>
          encodeItem({ baseFileRevision: base, id }).pipe(Effect.orDie),
        read: readProposalsWith(id),
        endsUndo: false,
      },
      done
    );
  };

  const review: ReviewOps = {
    add: (item, done) => {
      const id = newChangeId();

      callReview<ChangeId>(
        {
          url: urlOfNew(served, item),
          encode: (base) => encodeNew(item, id, base).pipe(Effect.orDie),
          read: readProposalsWith(id),
          endsUndo: false,
        },
        done
      );
    },
    editProposal: (id, text, done) => {
      callReview<ChangeId>(
        {
          url: served.editItem,
          encode: (base) =>
            encodeItemEdit({ baseFileRevision: base, id, text }).pipe(
              Effect.orDie
            ),
          read: readProposalsWith(id),
          endsUndo: false,
        },
        done
      );
    },
    discardProposal: (id, done) => {
      writeItem(id, served.discardItem, done);
    },
    dismiss: (id, done) => {
      writeItem(id, served.dismiss, done);
    },
    freeze: (done) => {
      callReview<FreezeAnswer>(
        {
          url: served.freeze,
          encode: (base) =>
            encodeFreeze({ baseFileRevision: base }).pipe(Effect.orDie),
          read: (answer) =>
            Option.map(decodeFrozen(answer), (frozen) => ({
              value: frozen,
              proposals: frozen.proposals,
            })),
          // Freezing moves the open layout changes into the batch, so the
          // lists undo would put back no longer exist.
          endsUndo: true,
        },
        done
      );
    },
    reopen: (id, text, done) => {
      const newId = newChangeId();

      callReview<ChangeId>(
        {
          url: served.reopen,
          encode: (base) => {
            const write = { baseFileRevision: base, id, newId };

            return encodeReopen(
              text === undefined ? write : { ...write, text }
            ).pipe(Effect.orDie);
          },
          read: readProposalsWith(newId),
          endsUndo: true,
        },
        done
      );
    },
  };

  /** The open proposal that adds structure `id`, if there is one. */
  const openAddOf = (id: string) =>
    Arr.findFirst(
      proposalsOf(view.state).structures ?? [],
      ({ change }) => change.action === "add" && change.structure.id === id
    );

  /**
   * What a structure proposal is checked against on the page: the map with
   * every pending change shown, as the server checks it.
   */
  const structureWorld = () => ({
    data: view.state.data,
    layout: proposedMap({
      state: view.state,
      proposals: { ...proposalsOf(view.state), layout: view.pending },
    }).state.layout,
  });

  const proposed = (id: string, change: StructureChange) =>
    proposeStructure({
      proposals: proposalsOf(view.state),
      id,
      change,
      world: structureWorld(),
    });

  const structureRefusal = (
    id: string,
    change: StructureChange
  ): string | undefined =>
    Option.getOrUndefined(Result.getFailure(proposed(id, change)));

  const sendStructure = (
    id: ChangeId,
    change: StructureChange,
    done: ReviewDone<ChangeId>
  ) => {
    callReview<ChangeId>(
      {
        url: served.structure,
        encode: (base) =>
          encodeStructure({ baseFileRevision: base, id, change }).pipe(
            Effect.orDie
          ),
        read: readProposalsWith(id),
        endsUndo: false,
      },
      done
    );
  };

  const structures: StructureOps = {
    propose: (change, done) => {
      sendStructure(newChangeId(), change, done);
    },
    refusalOf: (change) => structureRefusal(newChangeId(), change),
    isOpenAdd: (id) => Option.isSome(openAddOf(id)),
    refusalOfPlace: (id, next) => {
      const found = openAddOf(id);

      return Option.isSome(found) && found.value.change.action === "add"
        ? structureRefusal(found.value.id, { ...found.value.change, at: next })
        : undefined;
    },
    place: (id, next, done) => {
      const found = openAddOf(id);

      if (Option.isNone(found) || found.value.change.action !== "add") {
        return `"${id}" isn't a structure you proposed.`;
      }

      const change: StructureChange = { ...found.value.change, at: next };
      const refusal = structureRefusal(found.value.id, change);

      if (refusal === undefined) {
        sendStructure(found.value.id, change, done);
      }

      return refusal;
    },
    discard: (id, done) => {
      review.discardProposal(id, done);
    },
  };

  const sendHop = (
    id: ChangeId,
    change: HopChange,
    done: ReviewDone<ChangeId>
  ) => {
    callReview<ChangeId>(
      {
        url: served.hop,
        encode: (base) =>
          encodeHop({ baseFileRevision: base, id, change }).pipe(Effect.orDie),
        read: readProposalsWith(id),
        endsUndo: false,
      },
      done
    );
  };

  const sendFlow = (
    id: ChangeId,
    change: FlowChange,
    done: ReviewDone<ChangeId>
  ) => {
    callReview<ChangeId>(
      {
        url: served.flow,
        encode: (base) =>
          encodeFlow({ baseFileRevision: base, id, change }).pipe(Effect.orDie),
        read: readProposalsWith(id),
        endsUndo: false,
      },
      done
    );
  };

  /**
   * What a hop or flow proposal is checked against on the page: the map as
   * proposed with every pending change shown, and the map the frozen items
   * alone make, as the server checks them.
   */
  const connectionWorld = () => {
    const proposals = proposalsOf(view.state);

    return {
      data: proposedMap({
        state: view.state,
        proposals: { ...proposals, layout: view.pending },
      }).state.data,
      base: proposedMap({ state: view.state, proposals, open: false }).state
        .data,
    };
  };

  const hops: HopOps = {
    propose: (change, done) => {
      sendHop(newChangeId(), change, done);
    },
    refusalOf: (change) =>
      reasonOf(
        proposeHop({
          proposals: proposalsOf(view.state),
          id: newChangeId(),
          change,
          world: connectionWorld(),
        })
      ),
  };

  const flows: FlowOps = {
    propose: (change, done) => {
      sendFlow(newChangeId(), change, done);
    },
    refusalOf: (change) =>
      reasonOf(
        proposeFlow({
          proposals: proposalsOf(view.state),
          id: newChangeId(),
          change,
          world: connectionWorld(),
        })
      ),
  };

  const groups: GroupStoreOps = {
    propose: (change, members, done) => {
      const id = newChangeId();

      callReview<ChangeId>(
        {
          url: served.group,
          encode: (base) =>
            encodeGroup({
              baseFileRevision: base,
              id,
              change,
              members,
            }).pipe(Effect.orDie),
          read: readProposalsWith(id),
          endsUndo: false,
        },
        done
      );
    },
    discard: (id, done) => {
      review.discardProposal(id, done);
    },
  };

  const chapters: ChapterStoreOps = {
    propose: (change, done) => {
      const id = newChangeId();

      callReview<ChangeId>(
        {
          url: served.chapter,
          encode: (base) =>
            encodeChapter({ baseFileRevision: base, id, change }).pipe(
              Effect.orDie
            ),
          read: readProposalsWith(id),
          endsUndo: false,
        },
        done
      );
    },
    discard: (id, done) => {
      review.discardProposal(id, done);
    },
  };

  connect();

  return {
    review,
    structures,
    hops,
    flows,
    groups,
    chapters,
    subscribe: (listener) => {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => view,
    refusalOf: (structure, next) =>
      pendingRefusal(session, { _tag: "Place", next, structure }),
    place: (structure, next) => apply({ _tag: "Place", next, structure }),
    discard: (changes) => apply({ _tag: "Discard", changes }),
    refusalOfMoves: (moves) =>
      pendingRefusal(session, { _tag: "Arrange", plan: () => moves }),
    arrange: (plan) => apply({ _tag: "Arrange", plan }),
    reroute: (hop, points) => apply({ _tag: "Reroute", hop, points }),
    refusalOfReroute: (hop, points) =>
      pendingRefusal(session, { _tag: "Reroute", hop, points }),
    undo: () => {
      dispatch({ _tag: "Undo" });
    },
    redo: () => {
      dispatch({ _tag: "Redo" });
    },
    restore: (revision) => apply({ _tag: "Restore", revision }),
    loadRevision: (n) => loadRevision({ served, n }),
    accept: (ids, message) => {
      dispatch({ _tag: "Accept", ids, message });
    },
  };
};
