import { Schema } from "effect";

import { MapState } from "./map-state.ts";
import { MapProblem } from "./problems.ts";
import { LayoutChanges, Proposals } from "./proposals.ts";

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
  pendingLayout: "/api/proposals/layout",
} as const;

/** The largest request body the server reads, in bytes. */
export const maxWriteBytes = 256 * 1024;

/** A write to the pending layout changes. */
export const PendingLayoutWrite = Schema.Struct({
  /** The `proposals.json` revision the page based the write on. */
  baseRevision: Schema.Int,
  /** Every pending layout change after the write, replacing the old list. */
  layout: LayoutChanges,
});

export type PendingLayoutWrite = typeof PendingLayoutWrite.Type;

/**
 * The write was based on an older revision of `proposals.json`. Nothing was
 * written. `proposals` is the file as it is now, for the page to show.
 */
export class StaleProposals extends Schema.TaggedError<
  StaleProposals,
  { readonly brand: unique symbol }
>()("StaleProposals", { proposals: Proposals }, { httpApiStatus: 409 }) {}

/**
 * The write would leave the layout in a state the map can't take, such as
 * two footprints overlapping. Nothing was written.
 */
export class LayoutChangeRefused extends Schema.TaggedError<
  LayoutChangeRefused,
  { readonly brand: unique symbol }
>()(
  "LayoutChangeRefused",
  { reason: Schema.String, proposals: Proposals },
  { httpApiStatus: 422 }
) {}

/**
 * `layout.json` or `proposals.json` on disk doesn't decode, so the server
 * won't write. `problems` says what to fix.
 */
export class MapFilesUnreadable extends Schema.TaggedError<
  MapFilesUnreadable,
  { readonly brand: unique symbol }
>()(
  "MapFilesUnreadable",
  { problems: Schema.Array(MapProblem) },
  { httpApiStatus: 409 }
) {}

/**
 * One server-sent event:
 *
 * - `MapUpdated`: `state` is the map, with what's pending.
 * - `MapRejected`: the map files fail validation. Pages keep the last good
 *   map and show `summary` and every problem found, in the shape
 *   `check --json` uses.
 * - `PendingUpdated`: what's pending changed while the map files fail
 *   validation, and `proposals` is what `proposals.json` holds now.
 * - `Heartbeat`: sent every few seconds, so proxies keep a quiet stream open.
 *
 * The stream sends the map as it is now when it opens, and again after every
 * change: a `MapUpdated`, or while the files have an error, a `MapRejected`
 * and a `PendingUpdated`.
 */
export const ServerEvent = Schema.TaggedUnion({
  MapUpdated: { state: MapState },
  MapRejected: { summary: Schema.String, problems: Schema.Array(MapProblem) },
  PendingUpdated: { proposals: Proposals },
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
  /** Where to write the pending layout changes, relative to the page's URL. */
  pendingLayout: Schema.String,
});

export type ServedPage = typeof ServedPage.Type;

/** The id of the `<script type="application/json">` holding `ServedPage`. */
export const servedPageElementId = "axonometric-served-page";
