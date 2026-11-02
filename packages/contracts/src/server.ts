import { Schema, SchemaTransformation } from "effect";

import { Layout } from "./layout.ts";
import { MapState } from "./map-state.ts";
import { MapProblem } from "./problems.ts";
import { ChangeId, LayoutChanges, Proposals } from "./proposals.ts";
import type { Revision } from "./revisions.ts";

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
  notes: "/api/notes",
  editNote: "/api/notes/edit",
  discardNote: "/api/notes/discard",
  freeze: "/api/review/freeze",
  dismiss: "/api/review/dismiss",
  reopen: "/api/review/reopen",
  history: "/api/history",
  revision: "/api/history/:n",
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
 * The `:n` in a revision's path: digits only, no sign, no leading zero, no
 * exponent or hex, so `Number` can't read it as anything but a whole number
 * of at least 1. Nine digits keep it a safe integer. The server builds the
 * revision's file name from the number alone, never from the path text.
 */
const revisionNumberMessage =
  "expected a revision number: a whole number from 1, such as 3.";

const wholeFromOne = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(1, { message: revisionNumberMessage })
);

export const RevisionNumber = Schema.String.annotate({
  message: revisionNumberMessage,
})
  .check(
    Schema.isPattern(/^[1-9]\d{0,8}$/u, { message: revisionNumberMessage })
  )
  .pipe(Schema.decodeTo(wholeFromOne, SchemaTransformation.numberFromString));

/** One line of the History panel: a revision, without its snapshot. */
export const HistoryEntry = Schema.Struct({
  revision: Schema.Int,
  message: Schema.String,
  /** When the revision was saved, as an ISO date and time in UTC. */
  savedAt: Schema.String,
  /** How many items the revision decided on: those it accepted and rejected. */
  items: Schema.Int,
});

export type HistoryEntry = typeof HistoryEntry.Type;

/** Every revision that reads, newest first. */
export const HistoryList = Schema.Array(HistoryEntry);

export type HistoryList = typeof HistoryList.Type;

/** The History panel's line for `revision`. */
export const historyEntryOf = (revision: Revision): HistoryEntry => ({
  revision: revision.revision,
  message: revision.message,
  savedAt: revision.savedAt,
  items: revision.accepted.length + revision.rejected.length,
});

/** No revision has this number. */
export class RevisionNotFound extends Schema.TaggedError<
  RevisionNotFound,
  { readonly brand: unique symbol }
>()("RevisionNotFound", { revision: Schema.Int }, { httpApiStatus: 404 }) {}

/**
 * One server-sent event:
 *
 * - `MapUpdated`: `state` is the map, with what's pending.
 * - `MapRejected`: the map files fail validation. Pages keep the last good
 *   map and show `summary` and every problem found, in the shape
 *   `check --json` uses.
 * - `PendingUpdated`: what's pending changed while the map files fail
 *   validation, and `proposals` is what `proposals.json` holds now.
 * - `HistoryUpdated`: the revisions that read, newest first. Sent when the
 *   stream opens and whenever a revision is saved or removed.
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
  HistoryUpdated: { history: HistoryList },
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
  /** Where to add a note, relative to the page's URL. */
  notes: Schema.String,
  editNote: Schema.String,
  discardNote: Schema.String,
  /** Where "Ready for review" freezes a batch, relative to the page's URL. */
  freeze: Schema.String,
  /** Where a reviewed item is dismissed, relative to the page's URL. */
  dismiss: Schema.String,
  /** Where a rejected item is reopened, relative to the page's URL. */
  reopen: Schema.String,
  /**
   * Where the history is, relative to the page's URL: revision `n` is at
   * this path and `/n`. Its presence turns the History tab on.
   */
  history: Schema.String,
});

export type ServedPage = typeof ServedPage.Type;

/** The id of the `<script type="application/json">` holding `ServedPage`. */
export const servedPageElementId = "axonometric-served-page";
