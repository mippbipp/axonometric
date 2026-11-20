import {
  agentChangeRefusal,
  agentHeldWriteRefusal,
  frozenWriteRefusal,
  layoutUnderProposals,
  LayoutChangeRefused,
  layoutRefusal,
  MapFilesUnreadable,
  maxWriteBytes,
  openItems,
  StaleProposals,
} from "@axonometric/contracts";
import type {
  HopEnds,
  LayoutChange,
  MapData,
  PendingLayoutWrite,
  Proposals,
} from "@axonometric/contracts";
import { WriteGuard } from "@axonometric/contracts/api";
import {
  Array as Arr,
  Effect,
  Layer,
  Option,
  Result,
  String as Str,
} from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";

import type { HomePaths } from "./home-paths.ts";
import { withLock } from "./lock.ts";
import { encodeProposals, loadLayout, loadProposals } from "./map-files.ts";
import { writeAll } from "./write-files.ts";

const reject = (status: number, message: string) =>
  Effect.succeed(
    HttpServerResponse.text(`${message}\n`, {
      headers: { connection: "close" },
      status,
    })
  );

/** The media type in a Content-Type header, without its parameters. */
const mediaType = (header: string | undefined) =>
  Str.toLowerCase(Str.trim(Str.split(header ?? "", ";")[0] ?? ""));

/**
 * The URL of an Origin header, or nothing when it isn't an http or https
 * origin. Browsers send `null` from sandboxed frames and files.
 */
const originUrl = (origin: string) =>
  Option.filter(
    Option.liftThrowable(() => new URL(origin))(),
    (url) => url.protocol === "http:" || url.protocol === "https:"
  );

/**
 * Whether a write came from a page the server itself served: its Origin
 * names the host and port the request is addressed to. The Host check has
 * already allowed that name, and a page on another site, or on another port
 * of this one, names a different one. The scheme is ignored, because a
 * reverse proxy that ends TLS turns https into http.
 *
 * Browsers send Origin on every cross-site write. Without it,
 * `Sec-Fetch-Site: same-origin` vouches for the request instead. A request
 * with neither, such as from curl, is refused.
 */
const fromOwnOrigin = (request: HttpServerRequest.HttpServerRequest) => {
  const { host, origin } = request.headers;

  if (origin === undefined) {
    return request.headers["sec-fetch-site"] === "same-origin";
  }

  return Option.match(originUrl(origin), {
    onNone: () => false,
    onSome: (url) => url.host === Str.toLowerCase(Str.trim(host ?? "")),
  });
};

/** Whether a declared Content-Length is over the limit. */
const declaredTooLarge = (header: string | undefined) =>
  header !== undefined && Number(header) > maxWriteBytes;

/**
 * The write guard: the origin, the content type and the size limit, checked
 * in that order before the body is read.
 */
export const writeGuardLayer = Layer.succeed(WriteGuard, (httpEffect) =>
  Effect.flatMap(HttpServerRequest.HttpServerRequest, (request) => {
    if (!fromOwnOrigin(request)) {
      return reject(
        403,
        "Writes must come from a page this server served. Open the map at the URL serve printed."
      );
    }

    if (mediaType(request.headers["content-type"]) !== "application/json") {
      return reject(415, "Send the write as application/json.");
    }

    if (declaredTooLarge(request.headers["content-length"])) {
      return reject(
        413,
        `The body is over the limit of ${maxWriteBytes} bytes.`
      );
    }

    // The limit also stops a body that gives no length, or a false one,
    // as it's read.
    return httpEffect.pipe(
      Effect.provideService(
        HttpServerRequest.MaxBodySize,
        BigInt(maxWriteBytes)
      )
    );
  })
);

/** The problems in a file that didn't decode, as a write's error. */
export const unreadable = <A>(
  loaded: Result.Result<A, MapFilesUnreadable["problems"]>
) =>
  Result.match(loaded, {
    onFailure: (problems) => Effect.fail(MapFilesUnreadable.make({ problems })),
    onSuccess: (value) => Effect.succeed(value),
  });

/**
 * What every write to the pending changes starts with: take the lock for the
 * rest of the scope, `load` what the write needs, and refuse with
 * `StaleProposals`, naming the file as it is now, when `baseFileRevision`
 * isn't the revision of `proposals.json` that was loaded.
 */
export const loadForWrite = Effect.fnUntraced(function* <
  A extends { readonly proposals: Proposals },
  E,
  R,
>(paths: HomePaths, baseFileRevision: number, load: Effect.Effect<A, E, R>) {
  yield* withLock(paths, "serve");

  const loaded = yield* load;

  if (baseFileRevision !== loaded.proposals.revision) {
    return yield* StaleProposals.make({ proposals: loaded.proposals });
  }

  return loaded;
});

/** A write of the pending layout, and the map's hops it is checked against. */
export interface PendingWrite {
  /** The map's data as the server last built it, which proposed structures change. */
  readonly data: MapData;
  /** The map's hops, as the server last built them. */
  readonly hops: ReadonlyArray<HopEnds>;
  readonly write: PendingLayoutWrite;
}

/**
 * Why a write can't use the id of a change in `layout`: it belongs to a note
 * or to an item in a batch. Frozen items can't be added again, changed or
 * replaced by a write to the open layout changes.
 */
const usedElsewhere = (
  current: Proposals,
  layout: ReadonlyArray<LayoutChange>
): Option.Option<string> => {
  const taken = new Set([
    ...Arr.flatMap(openItems(current), ({ id, kind }) =>
      kind === "layout" ? [] : [id]
    ),
    ...Arr.flatMap(current.batches ?? [], ({ items }) =>
      Arr.map(items, ({ id }) => id)
    ),
  ]);

  return Option.map(
    Arr.findFirst(layout, ({ id }) => taken.has(id)),
    ({ id }) =>
      `"${id}" is already an open item or an item in a batch, so it can't be a layout change too. Frozen items can't be edited while the agent reviews them.`
  );
};

/**
 * Replaces the pending layout changes in `proposals.json` with
 * those in `write`, under the lock. The write is refused, and nothing
 * written, when `write.baseFileRevision` isn't the file's revision, or when a
 * new or changed change would leave footprints overlapping in the layout
 * the page shows, name a hop `hops` lacks, or leave a route override off its
 * footprints. It is refused too when it makes or changes an agent change, or
 * leaves an engineer change it adds beside an agent change on one target.
 * `written` runs under the lock, once the file is saved, to
 * tell the open pages. Returns what `proposals.json` holds after the write.
 */
export const writePendingLayout = Effect.fn("writePendingLayout")(function* (
  paths: HomePaths,
  { data, hops, write }: PendingWrite,
  written: (proposals: Proposals) => Effect.Effect<void>
) {
  // The files are read in this order, one at a time, so when both are
  // unreadable the error names proposals.json.
  /* oxlint-disable perfectionist/sort-objects -- Effect.all runs the fields in key order, which picks the error shown when both files fail */
  const readFiles = Effect.all(
    {
      proposals: Effect.flatMap(loadProposals(paths), unreadable),
      accepted: Effect.flatMap(loadLayout(paths), unreadable),
    },
    { concurrency: 1 }
  );
  /* oxlint-enable perfectionist/sort-objects */

  const { accepted, proposals: current } = yield* loadForWrite(
    paths,
    write.baseFileRevision,
    readFiles
  );

  // Frozen items wait for the agent, and still count, and so do the
  // structures the engineer has proposed: an open change is checked against
  // the ground they would take.
  const base = layoutUnderProposals({
    data,
    layout: accepted,
    proposals: current,
  });

  // Only the CLI acts as the agent. The page may send an agent change back
  // as it stands, never make or change one, and takes over an agent change
  // before it edits the same target.
  const listed = { after: write.layout, before: current.layout };

  const forged = Option.orElse(agentChangeRefusal(listed), () =>
    agentHeldWriteRefusal(listed)
  );

  if (Option.isSome(forged)) {
    return yield* LayoutChangeRefused.make({
      proposals: current,
      reason: forged.value,
    });
  }

  // The server holds this line for every client, the page's undo included:
  // a write can't touch what a frozen item acts on.
  const refusal = Option.orElse(
    Option.orElse(usedElsewhere(current, write.layout), () =>
      frozenWriteRefusal({ after: write.layout, proposals: current })
    ),
    () =>
      layoutRefusal({
        accepted: base,
        after: write.layout,
        before: current.layout,
        hops,
      })
  );

  if (Option.isSome(refusal)) {
    return yield* LayoutChangeRefused.make({
      proposals: current,
      reason: refusal.value,
    });
  }

  const next: Proposals = {
    ...current,
    layout: write.layout,
    revision: current.revision + 1,
  };

  yield* writeAll([
    {
      content: yield* encodeProposals(next),
      file: paths.proposalsFile,
    },
  ]);

  // Still under the lock, so two quick writes tell the pages in the order
  // they were made.
  yield* written(next);

  return next;
}, Effect.scoped);
