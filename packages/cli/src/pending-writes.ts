import {
  LayoutChangeRefused,
  layoutRefusal,
  MapFilesUnreadable,
  maxWriteBytes,
  StaleProposals,
} from "@axonometric/contracts";
import type { PendingLayoutWrite, Proposals } from "@axonometric/contracts";
import { WriteGuard } from "@axonometric/contracts/api";
import { Effect, Layer, Option, Path, Result, String as Str } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";

import { withLock } from "./lock.ts";
import { encodeProposals, loadLayout, loadProposals } from "./map-files.ts";
import { writeAll } from "./write-files.ts";

const reject = (status: number, message: string) =>
  Effect.succeed(
    HttpServerResponse.text(`${message}\n`, {
      status,
      headers: { connection: "close" },
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
  const { origin, host } = request.headers;

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
    onSuccess: (value) => Effect.succeed(value),
    onFailure: (problems) => Effect.fail(MapFilesUnreadable.make({ problems })),
  });

/**
 * Replaces the pending layout changes in `proposals.json` in `home` with
 * those in `write`, under the lock. The write is refused, and nothing
 * written, when `write.baseRevision` isn't the file's revision, or when a
 * new or changed change would leave footprints overlapping in the layout
 * the page shows. `written` runs under the lock, once the file is saved, to
 * tell the open pages. Returns what `proposals.json` holds after the write.
 */
export const writePendingLayout = Effect.fn("writePendingLayout")(function* (
  home: string,
  write: PendingLayoutWrite,
  written: (proposals: Proposals) => Effect.Effect<void>
) {
  const path = yield* Path.Path;

  yield* withLock(home, "serve");

  const current = yield* unreadable(yield* loadProposals(home));
  const accepted = yield* unreadable(yield* loadLayout(home));

  if (write.baseRevision !== current.revision) {
    return yield* StaleProposals.make({ proposals: current });
  }

  const refusal = layoutRefusal({
    accepted,
    before: current.layout,
    after: write.layout,
  });

  if (Option.isSome(refusal)) {
    return yield* LayoutChangeRefused.make({
      reason: refusal.value,
      proposals: current,
    });
  }

  const next: Proposals = {
    ...current,
    revision: current.revision + 1,
    layout: write.layout,
  };

  yield* writeAll([
    {
      file: path.join(home, "proposals.json"),
      content: yield* encodeProposals(next),
    },
  ]);

  // Still under the lock, so two quick writes tell the pages in the order
  // they were made.
  yield* written(next);

  return next;
}, Effect.scoped);
