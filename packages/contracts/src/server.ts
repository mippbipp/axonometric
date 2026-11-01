import { Schema } from "effect";

import { Layout } from "./layout.ts";
import { MapState } from "./map-state.ts";
import { MapProblem } from "./problems.ts";
import { ChangeId, LayoutChanges, Proposals } from "./proposals.ts";

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
  accept: "/api/proposals/accept",
} as const;

/** The largest request body the server reads, in bytes. */
export const maxWriteBytes = 256 * 1024;

/** A write to the pending layout changes. */
export const PendingLayoutWrite = Schema.Struct({
  /** The `proposals.json` revision the page based the write on. */
  baseFileRevision: Schema.Int,
  /** Every pending layout change after the write, replacing the old list. */
  layout: LayoutChanges,
});

export type PendingLayoutWrite = typeof PendingLayoutWrite.Type;

/**
 * The longest message a revision takes. It counts UTF-16 code units, as the
 * schema's `isMaxLength` and an input's `maxLength` both do, so the page stops
 * typing where the server would refuse.
 */
export const maxMessageLength = 500;

const messageFix = `expected a message of 1 to ${maxMessageLength} characters, or leave it out.`;

const messageText = Schema.String.annotate({ message: messageFix }).check(
  Schema.isNonEmpty({ message: messageFix }),
  Schema.isMaxLength(maxMessageLength, { message: messageFix })
);

/**
 * Accepting pending layout changes. The server looks for `changeIds` among
 * the pending layout changes only, so the id of anything else is refused as
 * unknown.
 */
export const AcceptWrite = Schema.Struct({
  /** The `proposals.json` revision the page based the write on. */
  baseFileRevision: Schema.Int,
  /** The changes to accept, or `"all"` for every pending layout change. */
  changeIds: Schema.Union([
    Schema.Literal("all"),
    Schema.NonEmptyArray(ChangeId),
  ]).annotate({
    message: 'expected "all" or a list of at least one change id.',
  }),
  /** What the revision is called. Left out, the server writes one from the changes. */
  message: Schema.optionalKey(messageText),
});

export type AcceptWrite = typeof AcceptWrite.Type;

/**
 * The changes were accepted: `layout.json`, `proposals.json` and the new
 * revision file are written, and SYSTEM.md and the read-only page rebuilt.
 */
export const Accepted = Schema.Struct({
  /** The revision just saved: its number, and the name of its file. */
  revision: Schema.Int,
  /** The revision's message, written by the server when the write gave none. */
  message: Schema.String,
  /** The accepted layout now. */
  layout: Layout,
  /** What is still pending. */
  proposals: Proposals,
});

export type Accepted = typeof Accepted.Type;

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
 * The map files on disk don't make a map, such as a `proposals.json` that
 * doesn't decode, so the server won't write. `problems` says what to fix.
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
  /** Where to accept pending layout changes, relative to the page's URL. */
  accept: Schema.String,
});

export type ServedPage = typeof ServedPage.Type;

/** The id of the `<script type="application/json">` holding `ServedPage`. */
export const servedPageElementId = "axonometric-served-page";
