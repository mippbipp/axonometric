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

/** A write from the server's own origin, as the page sends it. */
export const write = (
  method: "put" | "post",
  url: string,
  target: string,
  body: unknown
) =>
  send(
    HttpClientRequest[method](new URL(target, url)).pipe(
      HttpClientRequest.setHeaders({
        origin: url,
        "content-type": "application/json",
      }),
      HttpClientRequest.bodyText(JSON.stringify(body), "application/json")
    )
  );

export const moveOf = (id: string, structure: string, x: number, y: number) => ({
  id,
  kind: "move",
  moves: [{ target: { kind: "structure", id: structure }, position: { x, y } }],
});

export const resizeOf = (id: string, structure: string, w: number, d: number) => ({
  id,
  kind: "resize",
  target: { kind: "structure", id: structure },
  footprint: { w, d },
});

/**
 * Saves `changes` as pending layout changes and accepts them as the next
 * revision. `base` is the file revision of proposals.json before the write.
 */
export const acceptChanges = Effect.fnUntraced(function* (
  url: string,
  base: number,
  changes: readonly unknown[],
  message: string
) {
  const put = yield* write("put", url, "/api/proposals/layout", {
    baseFileRevision: base,
    layout: changes,
  });

  assert.strictEqual(put.status, 200, put.body);

  const accepted = yield* write("post", url, "/api/proposals/accept", {
    baseFileRevision: base + 1,
    changeIds: "all",
    message,
  });

  assert.strictEqual(accepted.status, 200, accepted.body);
});
