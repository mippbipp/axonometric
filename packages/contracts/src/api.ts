import { Schema } from "effect";
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
  HttpApiSchema,
} from "effect/http-api";

import { MapState } from "./map-state.ts";
import { Proposals } from "./proposals.ts";
import {
  AnswerAdd,
  FlowWrite,
  FreezeWrite,
  FreezeAnswer,
  HopWrite,
  ItemWrite,
  NoteAdd,
  ItemEdit,
  ProposalRefused,
  ChapterWrite,
  GroupWrite,
  QuestionAdd,
  ReopenWrite,
  StructureWrite,
  SuggestionAdd,
} from "./review-server.ts";
import { Revision } from "./revisions.ts";
import {
  Accepted,
  AcceptWrite,
  HistoryList,
  LayoutChangeRefused,
  PendingLayoutWrite,
  MapFilesUnreadable,
  RevisionNotFound,
  RevisionNumber,
  ServerEvent,
  serverPaths,
  ServerStatus,
  StaleProposals,
} from "./server.ts";

/** An HTML page, sent as text. */
const Html = Schema.String.pipe(
  HttpApiSchema.asText({ contentType: "text/html; charset=utf-8" })
);

/** Reading the map: the page with the map inlined, the map as JSON, and a stream of changes. */
export class MapApiGroup extends HttpApiGroup.make("map").add(
  HttpApiEndpoint.get("page", serverPaths.page, { success: Html }),
  HttpApiEndpoint.get("state", serverPaths.state, {
    success: MapState,
  }),
  HttpApiEndpoint.get("events", serverPaths.events, {
    query: { by: Schema.optionalKey(Schema.String) },
    success: HttpApiSchema.StreamSse({ data: ServerEvent }),
  }),
  HttpApiEndpoint.get("status", serverPaths.status, {
    query: { since: Schema.optionalKey(Schema.DateTimeUtcFromString) },
    success: ServerStatus,
  })
) {}

/**
 * Reading the history. The list has a line per revision, newest first. A
 * revision's path takes a whole number from 1 and nothing else; anything
 * else is a 400 before the handler runs, and a number with no revision is a
 * 404. The server reads `history/` through `revisionFileName(n)` only.
 */
export class HistoryApiGroup extends HttpApiGroup.make("history").add(
  HttpApiEndpoint.get("list", serverPaths.history, { success: HistoryList }),
  HttpApiEndpoint.get("revision", serverPaths.revision, {
    error: RevisionNotFound,
    params: { n: RevisionNumber },
    success: Revision,
  })
) {}

/**
 * Guards every write: the request must come from the server's own origin,
 * carry a JSON content type and stay under the body size limit. The server
 * answers 403, 415 or 413 without running the write otherwise.
 */
export class WriteGuard extends HttpApiMiddleware.Service<WriteGuard>()(
  "@axonometric/contracts/api/WriteGuard"
) {}

/**
 * Writing the map's pending changes. Each write names the file revision it
 * was based on, and the server takes the lock, checks it, and writes
 * `proposals.json` atomically. Accepting changes is its own endpoint, and
 * undo will join this group as another.
 *
 * A write replaces the whole list of open layout changes, because undo needs
 * to put an earlier list back. Frozen items live in `batches`, which this
 * write never touches, so a page can't rewrite what the agent is reviewing.
 */
export class ProposalsApiGroup extends HttpApiGroup.make("proposals")
  .add(
    HttpApiEndpoint.put("putLayout", serverPaths.pendingLayout, {
      error: [StaleProposals, LayoutChangeRefused, MapFilesUnreadable],
      payload: PendingLayoutWrite,
      success: Proposals,
    }),
    HttpApiEndpoint.post("accept", serverPaths.accept, {
      error: [StaleProposals, LayoutChangeRefused, MapFilesUnreadable],
      payload: AcceptWrite,
      success: Accepted,
    })
  )
  .middleware(WriteGuard) {}

/**
 * Notes, text suggestions, answers, questions and the review loop. Every write names the file revision it was
 * based on, goes through the write guard, and takes the same lock as the
 * CLI's `verdict` and `commit`. Editing or discarding an item in a frozen
 * batch is refused with `ProposalRefused`.
 */
export class ReviewApiGroup extends HttpApiGroup.make("review")
  .add(
    HttpApiEndpoint.post("addNote", serverPaths.notes, {
      error: [StaleProposals, ProposalRefused, MapFilesUnreadable],
      payload: NoteAdd,
      success: Proposals,
    }),
    HttpApiEndpoint.post("editItem", serverPaths.editItem, {
      error: [StaleProposals, ProposalRefused, MapFilesUnreadable],
      payload: ItemEdit,
      success: Proposals,
    }),
    HttpApiEndpoint.post("discardItem", serverPaths.discardItem, {
      error: [StaleProposals, ProposalRefused, MapFilesUnreadable],
      payload: ItemWrite,
      success: Proposals,
    }),
    HttpApiEndpoint.post("addSuggestion", serverPaths.suggestions, {
      error: [StaleProposals, ProposalRefused, MapFilesUnreadable],
      payload: SuggestionAdd,
      success: Proposals,
    }),
    HttpApiEndpoint.post("addAnswer", serverPaths.answers, {
      error: [StaleProposals, ProposalRefused, MapFilesUnreadable],
      payload: AnswerAdd,
      success: Proposals,
    }),
    HttpApiEndpoint.post("addQuestion", serverPaths.questions, {
      error: [StaleProposals, ProposalRefused, MapFilesUnreadable],
      payload: QuestionAdd,
      success: Proposals,
    }),
    HttpApiEndpoint.post("setStructure", serverPaths.structure, {
      error: [StaleProposals, ProposalRefused, MapFilesUnreadable],
      payload: StructureWrite,
      success: Proposals,
    }),
    HttpApiEndpoint.post("setHop", serverPaths.hop, {
      error: [StaleProposals, ProposalRefused, MapFilesUnreadable],
      payload: HopWrite,
      success: Proposals,
    }),
    HttpApiEndpoint.post("setFlow", serverPaths.flow, {
      error: [StaleProposals, ProposalRefused, MapFilesUnreadable],
      payload: FlowWrite,
      success: Proposals,
    }),
    HttpApiEndpoint.post("setGroup", serverPaths.group, {
      error: [StaleProposals, ProposalRefused, MapFilesUnreadable],
      payload: GroupWrite,
      success: Proposals,
    }),
    HttpApiEndpoint.post("setChapter", serverPaths.chapter, {
      error: [StaleProposals, ProposalRefused, MapFilesUnreadable],
      payload: ChapterWrite,
      success: Proposals,
    }),
    HttpApiEndpoint.post("freeze", serverPaths.freeze, {
      error: [StaleProposals, ProposalRefused, MapFilesUnreadable],
      payload: FreezeWrite,
      success: FreezeAnswer,
    }),
    HttpApiEndpoint.post("dismiss", serverPaths.dismiss, {
      error: [StaleProposals, ProposalRefused, MapFilesUnreadable],
      payload: ItemWrite,
      success: Proposals,
    }),
    HttpApiEndpoint.post("reopen", serverPaths.reopen, {
      error: [StaleProposals, ProposalRefused, MapFilesUnreadable],
      payload: ReopenWrite,
      success: Proposals,
    })
  )
  .middleware(WriteGuard) {}

/** The API that `axonometric serve` answers. */
export class ServerApi extends HttpApi.make("axonometric")
  .add(MapApiGroup)
  .add(HistoryApiGroup)
  .add(ProposalsApiGroup)
  .add(ReviewApiGroup)
  .annotate(HttpApi.PayloadParseOptions, {
    errors: "all",
    onExcessProperty: "error",
  }) {}
