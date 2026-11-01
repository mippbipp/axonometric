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
 * `proposals.json` atomically. Accepting changes and undo join this group as
 * their own endpoints.
 *
 * A write replaces the whole list of layout changes, because undo needs to
 * put an earlier list back. When #21 freezes items into batches, it must
 * make the server refuse any write that adds, changes or removes a frozen
 * item: replacing the whole list would otherwise let a page rewrite what the
 * agent is reviewing.
 */
export class ProposalsApiGroup extends HttpApiGroup.make("proposals")
  .add(
    HttpApiEndpoint.put("putLayout", serverPaths.pendingLayout, {
      payload: PendingLayoutWrite,
      success: Proposals,
      error: [StaleProposals, LayoutChangeRefused, MapFilesUnreadable],
    })
  )
  .middleware(WriteGuard) {}

/** The API that `axonometric serve` answers. */
export class ServerApi extends HttpApi.make("axonometric")
  .add(MapApiGroup)
  .add(ProposalsApiGroup)
  .annotate(HttpApi.PayloadParseOptions, {
    errors: "all",
    onExcessProperty: "error",
  }) {}
