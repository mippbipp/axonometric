import { Schema } from "effect";

import { MapState } from "./map-state.ts";
import { MapProblem } from "./problems.ts";

/**
 * What `serve` writes to `.axonometric/server.json` in the home folder while
 * it runs, and what `status` reads.
 */
export const ServerState = Schema.Struct({
  /** Where the map is served, such as `http://127.0.0.1:5178`. */
  url: Schema.String,
  pid: Schema.Int,
  /** When the server started, as an ISO date and time. */
  since: Schema.String,
});

export type ServerState = typeof ServerState.Type;

/** The server's paths. The page is served at the root. */
export const serverPaths = {
  page: "/",
  state: "/api/state",
  events: "/api/events",
} as const;

/**
 * One server-sent event:
 *
 * - `MapUpdated`: the map was rebuilt, and `state` is the new map.
 * - `MapRejected`: the map files changed, and the new map failed validation.
 *   Pages keep the last good map and show `summary` and every problem found,
 *   in the shape `check --json` uses.
 * - `Heartbeat`: sent every few seconds, so proxies keep a quiet stream open.
 *
 * A new stream starts with the map's current status, a `MapUpdated` or a
 * `MapRejected`, then sends each change as it happens.
 */
export const ServerEvent = Schema.TaggedUnion({
  MapUpdated: { state: MapState },
  MapRejected: { summary: Schema.String, problems: Schema.Array(MapProblem) },
  Heartbeat: {},
});

export type ServerEvent = typeof ServerEvent.Type;

/**
 * Inlined into pages that `serve` serves, and missing from the read-only
 * file. Its presence tells the page to connect to the server.
 */
export const ServedPage = Schema.Struct({
  /** The events stream, relative to the page's URL. */
  events: Schema.String,
});

export type ServedPage = typeof ServedPage.Type;

/** The id of the `<script type="application/json">` holding `ServedPage`. */
export const servedPageElementId = "axonometric-served-page";
