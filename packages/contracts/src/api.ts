import { Schema } from "effect";
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from "effect/http-api";

import { MapState } from "./map-state.ts";
import { ServerEvent, serverPaths } from "./server.ts";

/** An HTML page, sent as text. */
const Html = Schema.String.pipe(
  HttpApiSchema.asText({ contentType: "text/html; charset=utf-8" })
);

/**
 * Reading the map: the page with the map inlined, the map as JSON, and a
 * stream of changes. The server only reads for now. Writes join as their
 * own group.
 */
export class MapApiGroup extends HttpApiGroup.make("map").add(
  HttpApiEndpoint.get("page", serverPaths.page, { success: Html }),
  HttpApiEndpoint.get("state", serverPaths.state, {
    success: MapState,
  }),
  HttpApiEndpoint.get("events", serverPaths.events, {
    success: HttpApiSchema.StreamSse({ data: ServerEvent }),
  })
) {}

/** The API that `axonometric serve` answers. */
export class ServerApi extends HttpApi.make("axonometric").add(MapApiGroup) {}
