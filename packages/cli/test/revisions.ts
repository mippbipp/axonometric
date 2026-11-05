import type {
  AcceptWrite,
  Footprint,
  GridPoint,
  LayoutChange,
  PendingLayoutWrite,
} from "@axonometric/contracts";
import { NodeHttpClient } from "@effect/platform-node";
import { assert } from "@effect/vitest";
import { Effect } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";

// Plain HTTP calls to a real serve, to make revisions the way a script or
// another tab would: through the same API the page uses.

export interface Sent {
  readonly status: number;
  readonly body: string;
}

export const send = (request: HttpClientRequest.HttpClientRequest) =>
  HttpClient.HttpClient.use((client) => client.execute(request)).pipe(
    Effect.flatMap((response) =>
      Effect.map(response.text, (body): Sent => ({
        status: response.status,
        body,
      }))
    ),
    Effect.scoped,
    Effect.orDie,
    Effect.provide(NodeHttpClient.layerNodeHttp)
  );

export const get = (url: string, target: string) =>
  send(HttpClientRequest.get(new URL(target, url)));

const jsonType = "application/json";

/** The headers a page the server served sends with a write. */
export const ownOrigin = (url: string) => ({
  origin: url,
  "content-type": jsonType,
});

/**
 * Sends `body`, already JSON text or deliberately not, to `target`. The
 * headers default to the server's own origin, as the page sends them, so a
 * test can send what the page never would.
 */
export const writeText = (
  url: string,
  request: {
    readonly method: "put" | "post";
    readonly target: string;
    readonly body: string;
    readonly headers?: Readonly<Record<string, string>>;
  }
) => {
  const headers = request.headers ?? ownOrigin(url);

  return send(
    HttpClientRequest[request.method](new URL(request.target, url)).pipe(
      HttpClientRequest.setHeaders(headers),
      HttpClientRequest.bodyText(
        request.body,
        headers["content-type"] ?? jsonType
      )
    )
  );
};

/** A POST of `body`, already JSON text, from the server's own origin. */
export const post = (url: string, target: string, body: string) =>
  writeText(url, { method: "post", target, body });

/** A write from the server's own origin, as the page sends it. */
export const write = (
  url: string,
  request: {
    readonly method: "put" | "post";
    readonly target: string;
    readonly body: PendingLayoutWrite | AcceptWrite;
  }
) =>
  writeText(url, {
    method: request.method,
    target: request.target,
    // oxlint-disable-next-line effecttsgo/prefer-schema-over-json -- the bodies are plain JSON objects
    body: JSON.stringify(request.body),
  });

export const moveOf = (
  id: string,
  structure: string,
  to: GridPoint
): LayoutChange => ({
  id,
  kind: "move",
  moves: [{ target: { kind: "structure", id: structure }, position: to }],
});

export const resizeOf = (
  id: string,
  structure: string,
  footprint: Footprint
): LayoutChange => ({
  id,
  kind: "resize",
  target: { kind: "structure", id: structure },
  footprint,
});

/** What `acceptChanges` saves and accepts. */
export interface Acceptance {
  /** The file revision of proposals.json before the write. */
  readonly base: number;
  readonly changes: readonly LayoutChange[];
  readonly message: string;
}

/** What the serve answering the writes has printed, read when one fails. */
export interface ServeOutput {
  readonly output: { readonly stderr: string };
}

/**
 * Saves `changes` as pending layout changes and accepts them as the next
 * revision. A write the server doesn't answer with 200 fails the test with
 * the answer and what serve printed, which says why for a 500.
 */
export const acceptChanges = Effect.fnUntraced(function* (
  { url, output }: ServeOutput & { readonly url: string },
  { base, changes, message }: Acceptance
) {
  const why = (sent: Sent) =>
    `${sent.status}: ${sent.body}\nserve printed:\n${output.stderr}`;

  const put = yield* write(url, {
    method: "put",
    target: "/api/proposals/layout",
    body: { baseFileRevision: base, layout: changes },
  });

  assert.strictEqual(put.status, 200, why(put));

  const accepted = yield* write(url, {
    method: "post",
    target: "/api/proposals/accept",
    body: { baseFileRevision: base + 1, changeIds: "all", message },
  });

  assert.strictEqual(accepted.status, 200, why(accepted));
});
