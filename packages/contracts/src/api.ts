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
  FreezeWrite,
  FreezeAnswer,
  ItemWrite,
  NoteAdd,
  NoteEdit,
  ProposalRefused,
  ReopenWrite,
} from "./review-server.ts";
import {
  Accepted,
  AcceptWrite,
  LayoutChangeRefused,
  PendingLayoutWrite,
  MapFilesUnreadable,
  ServerEvent,
  serverPaths,
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
    success: HttpApiSchema.StreamSse({ data: ServerEvent }),
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
      payload: PendingLayoutWrite,
      success: Proposals,
      error: [StaleProposals, LayoutChangeRefused, MapFilesUnreadable],
    }),
    HttpApiEndpoint.post("accept", serverPaths.accept, {
      payload: AcceptWrite,
      success: Accepted,
      error: [StaleProposals, LayoutChangeRefused, MapFilesUnreadable],
    })
  )
  .middleware(WriteGuard) {}

/**
 * Notes and the review loop. Every write names the file revision it was
 * based on, goes through the write guard, and takes the same lock as the
 * CLI's `verdict` and `commit`. Editing or discarding an item in a frozen
 * batch is refused with `ProposalRefused`.
 */
export class ReviewApiGroup extends HttpApiGroup.make("review")
  .add(
    HttpApiEndpoint.post("addNote", serverPaths.notes, {
      payload: NoteAdd,
      success: Proposals,
      error: [StaleProposals, ProposalRefused, MapFilesUnreadable],
    }),
    HttpApiEndpoint.post("editNote", serverPaths.editNote, {
      payload: NoteEdit,
      success: Proposals,
      error: [StaleProposals, ProposalRefused, MapFilesUnreadable],
    }),
    HttpApiEndpoint.post("discardNote", serverPaths.discardNote, {
      payload: ItemWrite,
      success: Proposals,
      error: [StaleProposals, ProposalRefused, MapFilesUnreadable],
    }),
    HttpApiEndpoint.post("freeze", serverPaths.freeze, {
      payload: FreezeWrite,
      success: FreezeAnswer,
      error: [StaleProposals, ProposalRefused, MapFilesUnreadable],
    }),
    HttpApiEndpoint.post("dismiss", serverPaths.dismiss, {
      payload: ItemWrite,
      success: Proposals,
      error: [StaleProposals, ProposalRefused, MapFilesUnreadable],
    }),
    HttpApiEndpoint.post("reopen", serverPaths.reopen, {
      payload: ReopenWrite,
      success: Proposals,
      error: [StaleProposals, ProposalRefused, MapFilesUnreadable],
    })
  )
  .middleware(WriteGuard) {}

/** The API that `axonometric serve` answers. */
export class ServerApi extends HttpApi.make("axonometric")
  .add(MapApiGroup)
  .add(ProposalsApiGroup)
  .add(ReviewApiGroup)
  .annotate(HttpApi.PayloadParseOptions, {
    errors: "all",
    onExcessProperty: "error",
  }) {}
