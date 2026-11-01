import { Proposals } from "@axonometric/contracts";
import type { LayoutChange } from "@axonometric/contracts";
import { NodeHttpClient, NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import {
  Array as Arr,
  Effect,
  FileSystem,
  Path,
  Schema,
  Stream,
  String as Str,
} from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";

import { fullMap } from "./fixtures.ts";
import { makeHome, startServe } from "./harness.ts";

// Plain HTTP writes to a real serve, for the requests a browser won't send.
// Each refused write must leave every file in the home folder as it was.

const pendingLayout = "/api/proposals/layout";

/** The review map served on a free port, with extra `serve` arguments. */
const servedWith = (args: readonly string[]) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const root = yield* makeHome(yield* fullMap);
    const home = path.join(root, "review", "map");
    const serve = yield* startServe(home, ["--port", "0", ...args]);

    return { home, url: serve.url };
  }).pipe(Effect.provide(NodeServices.layer));

const served = servedWith([]);

interface Sent {
  readonly status: number;
  readonly body: string;
}

/** A body for the endpoint, which the server may refuse. */
const WriteBody = Schema.Struct({
  baseRevision: Schema.optionalKey(Schema.Finite),
  layout: Schema.optionalKey(Schema.Array(Schema.Unknown)),
  file: Schema.optionalKey(Schema.String),
});

const toJson = (value: typeof WriteBody.Type) =>
  Schema.encodeEffect(Schema.fromJsonString(WriteBody))(value).pipe(
    Effect.orDie
  );

const decodeProposals = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Proposals)
);

const decodeStale = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.TaggedStruct("StaleProposals", { proposals: Proposals })
  )
);

/** Sends a PUT to the pending layout with `headers` and `body`. */
const put = (
  url: string,
  headers: Readonly<Record<string, string>>,
  body: Effect.Effect<string>
) => Effect.flatMap(body, (text) => sendText(url, headers, text));

const sendText = (
  url: string,
  headers: Readonly<Record<string, string>>,
  body: string
) =>
  HttpClient.HttpClient.use((client) =>
    client.execute(
      HttpClientRequest.put(new URL(pendingLayout, url)).pipe(
        HttpClientRequest.setHeaders(headers),
        HttpClientRequest.bodyText(
          body,
          headers["content-type"] ?? "application/json"
        )
      )
    )
  ).pipe(
    Effect.flatMap((response) =>
      Effect.map(response.text, (text): Sent => ({
        status: response.status,
        body: text,
      }))
    ),
    Effect.scoped,
    Effect.orDie,
    Effect.provide(NodeHttpClient.layerNodeHttp)
  );

const chunk = new Uint8Array(64 * 1024).fill(32);

/** Sends a PUT whose body is `count` chunks of 64 KB, with no length. */
const putChunked = (
  url: string,
  headers: Readonly<Record<string, string>>,
  count: number
) => {
  const body = Stream.fromIterable(Arr.replicate(chunk, count));

  return HttpClient.HttpClient.use((client) =>
    client.execute(
      HttpClientRequest.put(new URL(pendingLayout, url)).pipe(
        HttpClientRequest.setHeaders(headers),
        HttpClientRequest.bodyStream(body, { contentType: "application/json" })
      )
    )
  ).pipe(
    Effect.map((response): Sent => ({ status: response.status, body: "" })),
    Effect.scoped,
    Effect.orDie,
    Effect.provide(NodeHttpClient.layerNodeHttp)
  );
};

/** The headers of a write through a reverse proxy for `map.example.test`. */
const asProxied = (origin: string) => ({
  "content-type": "application/json",
  host: "map.example.test",
  origin,
});

/** The headers a page the server served sends. */
const ownOrigin = (url: string) => ({
  origin: url,
  "content-type": "application/json",
});

const pageAt = (x: number, y = 3): LayoutChange => ({
  id: "m1",
  kind: "move",
  moves: [{ target: { kind: "structure", id: "page" }, position: { x, y } }],
});

const moveBody = (baseRevision: number, x: number) =>
  toJson({ baseRevision, layout: [pageAt(x)] });

/** Every file in `home` and its contents, the lock folder left out. */
const snapshot = Effect.fnUntraced(function* (home: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const entries = yield* fs.readDirectory(home);
  const files: Record<string, string> = {};

  for (const entry of entries) {
    const info = yield* fs.stat(path.join(home, entry));

    if (info.type === "File") {
      files[entry] = yield* fs.readFileString(path.join(home, entry));
    }
  }

  return files;
}, Effect.provide(NodeServices.layer));

/** Sends a write and asserts it's refused with `status`, changing no file. */
const assertRefused = Effect.fnUntraced(function* (
  home: string,
  status: number,
  send: Effect.Effect<Sent>
) {
  const before = yield* snapshot(home);
  const sent = yield* send;

  assert.strictEqual(sent.status, status, sent.body);
  assert.deepStrictEqual(yield* snapshot(home), before);

  return sent;
});

describe("writing pending layout changes over HTTP", () => {
  it.live("saves a write from the server's own origin to proposals.json", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const { home, url } = yield* served;

      const sent = yield* put(url, ownOrigin(url), moveBody(0, 4));

      assert.strictEqual(sent.status, 200, sent.body);
      const saved = yield* fs.readFileString(path.join(home, "proposals.json"));

      assert.deepStrictEqual(yield* decodeProposals(saved), {
        format: 1,
        revision: 1,
        layout: [pageAt(4)],
      });
    }).pipe(Effect.provide(NodeServices.layer))
  );

  it.live("refuses a cross-origin write", () =>
    Effect.gen(function* () {
      const { home, url } = yield* served;

      yield* assertRefused(
        home,
        403,
        put(
          url,
          { ...ownOrigin(url), origin: "http://attacker.example.test" },
          moveBody(0, 4)
        )
      );
      // Another port on the same host is another origin.
      yield* assertRefused(
        home,
        403,
        put(
          url,
          { ...ownOrigin(url), origin: "http://127.0.0.1:1" },
          moveBody(0, 4)
        )
      );
    })
  );

  it.live("refuses a write with no Origin from outside a browser", () =>
    Effect.gen(function* () {
      const { home, url } = yield* served;

      yield* assertRefused(
        home,
        403,
        put(url, { "content-type": "application/json" }, moveBody(0, 4))
      );
    })
  );

  it.live("refuses Origin: null, which sandboxed frames and files send", () =>
    Effect.gen(function* () {
      const { home, url } = yield* served;

      yield* assertRefused(
        home,
        403,
        put(url, { ...ownOrigin(url), origin: "null" }, moveBody(0, 4))
      );
    })
  );

  it.live(
    "takes Sec-Fetch-Site: same-origin in place of an Origin, and refuses cross-site",
    () =>
      Effect.gen(function* () {
        const { home, url } = yield* served;
        const json = { "content-type": "application/json" };

        yield* assertRefused(
          home,
          403,
          put(url, { ...json, "sec-fetch-site": "cross-site" }, moveBody(0, 4))
        );
        yield* assertRefused(
          home,
          403,
          put(url, { ...json, "sec-fetch-site": "same-site" }, moveBody(0, 4))
        );

        const sent = yield* put(
          url,
          { ...json, "sec-fetch-site": "same-origin" },
          moveBody(0, 4)
        );

        assert.strictEqual(sent.status, 200, sent.body);
      })
  );

  it.live(
    "matches the Origin to the Host, port included, whatever the scheme",
    () =>
      Effect.gen(function* () {
        const { home, url } = yield* servedWith([
          "--allow-host",
          "map.example.test",
        ]);

        // An allowed host name on another port is another origin.
        yield* assertRefused(
          home,
          403,
          put(url, asProxied("http://map.example.test:9999"), moveBody(0, 4))
        );
        yield* assertRefused(
          home,
          403,
          put(url, asProxied("https://other.example.test"), moveBody(0, 4))
        );

        // A proxy that ends TLS shows the server http, and the page sent https.
        const sent = yield* put(
          url,
          asProxied("https://map.example.test"),
          moveBody(0, 4)
        );

        assert.strictEqual(sent.status, 200, sent.body);
      })
  );

  it.live("refuses a form-encoded write", () =>
    Effect.gen(function* () {
      const { home, url } = yield* served;

      yield* assertRefused(
        home,
        415,
        put(
          url,
          {
            origin: url,
            "content-type": "application/x-www-form-urlencoded",
          },
          Effect.succeed("baseRevision=0&layout=[]")
        )
      );
      yield* assertRefused(
        home,
        415,
        put(url, { origin: url, "content-type": "text/plain" }, moveBody(0, 4))
      );
    })
  );

  it.live("refuses a body over 256 KB", () =>
    Effect.gen(function* () {
      const { home, url } = yield* served;
      const padding = Str.repeat(300 * 1024)(" ");
      const body = `${yield* moveBody(0, 4)}${padding}`;

      yield* assertRefused(
        home,
        413,
        put(url, ownOrigin(url), Effect.succeed(body))
      );
    })
  );

  it.live("refuses a chunked body over 256 KB that gives no length", () =>
    Effect.gen(function* () {
      const { home, url } = yield* served;

      yield* assertRefused(home, 413, putChunked(url, ownOrigin(url), 6));
    })
  );

  it.live("refuses a body that doesn't match the schema", () =>
    Effect.gen(function* () {
      const { home, url } = yield* served;

      for (const body of [
        "{ not json",
        yield* toJson({ baseRevision: 0 }),
        yield* moveBody(0, 0.3),
        yield* toJson({ baseRevision: 0, layout: [], file: "../data.mjs" }),
      ]) {
        yield* assertRefused(
          home,
          400,
          put(url, ownOrigin(url), Effect.succeed(body))
        );
      }
    })
  );

  it.live(
    "refuses a write based on a stale revision, and sends the current file",
    () =>
      Effect.gen(function* () {
        const { home, url } = yield* served;

        assert.strictEqual(
          (yield* put(url, ownOrigin(url), moveBody(0, 4))).status,
          200
        );

        const stale = yield* assertRefused(
          home,
          409,
          put(url, ownOrigin(url), moveBody(0, 12))
        );

        const answer = yield* decodeStale(stale.body);

        assert.deepStrictEqual(answer.proposals, {
          format: 1,
          revision: 1,
          layout: [pageAt(4)],
        });
      })
  );

  it.live("refuses a move onto another footprint", () =>
    Effect.gen(function* () {
      const { home, url } = yield* served;

      const onServer = toJson({
        baseRevision: 0,
        layout: [pageAt(8, 0)],
      });

      const refused = yield* assertRefused(
        home,
        422,
        put(url, ownOrigin(url), onServer)
      );

      assert.include(refused.body, String.raw`would overlap \"server\"`);
    })
  );

  it.live("refuses a write with a forged Host", () =>
    Effect.gen(function* () {
      const { home, url } = yield* served;

      yield* assertRefused(
        home,
        403,
        put(
          url,
          {
            ...ownOrigin(url),
            host: "attacker.example.test",
            origin: "http://attacker.example.test",
          },
          moveBody(0, 4)
        )
      );
    })
  );
});
