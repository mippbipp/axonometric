import { HistoryList, Revision, ServerEvent } from "@axonometric/contracts";
import { NodeHttpClient, NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import {
  Array as Arr,
  Effect,
  Fiber,
  FileSystem,
  Latch,
  Path,
  Schema,
  Stream,
} from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";

import { fullMap } from "./fixtures.ts";
import { makeHome, startServe } from "./harness.ts";

// The history routes of a real serve, over plain HTTP: what they list, what
// they refuse, and the event that tells open pages a revision was saved.

const decodeList = Schema.decodeUnknownEffect(Schema.fromJsonString(HistoryList));

const decodeRevision = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Revision)
);

const decodeEvent = Schema.decodeUnknownEffect(
  Schema.fromJsonString(ServerEvent)
);

const ownOrigin = (url: string) => ({
  origin: url,
  "content-type": "application/json",
});

const pageTo = (x: number, y: number) => [
  {
    id: `move-${x}-${y}`,
    kind: "move",
    moves: [{ target: { kind: "structure", id: "page" }, position: { x, y } }],
  },
];

interface Sent {
  readonly status: number;
  readonly body: string;
}

const send = (request: HttpClientRequest.HttpClientRequest) =>
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

const get = (url: string, target: string) =>
  send(HttpClientRequest.get(new URL(target, url)));

const write = (
  method: "put" | "post",
  url: string,
  target: string,
  body: unknown
) =>
  send(
    HttpClientRequest[method](new URL(target, url)).pipe(
      HttpClientRequest.setHeaders(ownOrigin(url)),
      HttpClientRequest.bodyText(JSON.stringify(body), "application/json")
    )
  );

/**
 * Moves the page to `[x, y]` and accepts it, through the API, as the next
 * revision. `base` is the file revision of proposals.json before the move.
 */
const acceptMove = Effect.fnUntraced(function* (
  url: string,
  base: number,
  to: readonly [number, number],
  message: string
) {
  const put = yield* write("put", url, "/api/proposals/layout", {
    baseFileRevision: base,
    layout: pageTo(to[0], to[1]),
  });

  assert.strictEqual(put.status, 200, put.body);

  const accepted = yield* write("post", url, "/api/proposals/accept", {
    baseFileRevision: base + 1,
    changeIds: "all",
    message,
  });

  assert.strictEqual(accepted.status, 200, accepted.body);
});

/** The review map served on a free port, with two revisions saved. */
const servedWithTwo = Effect.gen(function* () {
  const path = yield* Path.Path;
  const root = yield* makeHome(yield* fullMap);
  const home = path.join(root, "review", "map");
  const serve = yield* startServe(home, ["--port", "0"]);

  yield* acceptMove(serve.url, 0, [4, 4], "Drop the page");
  yield* acceptMove(serve.url, 2, [4, 8], "Drop it further");

  return { root, home, url: serve.url };
}).pipe(Effect.provide(NodeServices.layer));

describe("gET /api/history", () => {
  it.live("lists the revisions newest first, with message, date and item count", () =>
    Effect.gen(function* () {
      const { url } = yield* servedWithTwo;
      const sent = yield* get(url, "/api/history");

      assert.strictEqual(sent.status, 200, sent.body);

      const list = yield* decodeList(sent.body);

      assert.deepStrictEqual(
        Arr.map(list, ({ revision, message, items }) => ({
          revision,
          message,
          items,
        })),
        [
          { revision: 2, message: "Drop it further", items: 1 },
          { revision: 1, message: "Drop the page", items: 1 },
        ]
      );

      for (const { savedAt } of list) {
        assert.match(savedAt, /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/u);
      }
    })
  );

  it.live("lists nothing for a map with no revisions", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const root = yield* makeHome(yield* fullMap);

      const serve = yield* startServe(path.join(root, "review", "map"), [
        "--port",
        "0",
      ]);

      const sent = yield* get(serve.url, "/api/history");

      assert.strictEqual(sent.status, 200, sent.body);
      assert.deepStrictEqual(yield* decodeList(sent.body), []);
    }).pipe(Effect.provide(NodeServices.layer))
  );

  it.live("ignores a revision file that does not read, and lists the rest", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const { home, url } = yield* servedWithTwo;

      yield* fs.writeFileString(
        path.join(home, "history", "0003.json"),
        "not json"
      );

      const list = yield* decodeList((yield* get(url, "/api/history")).body);

      // Whether the watcher has seen 0003 yet or not, it never lists it.
      assert.deepStrictEqual(Arr.map(list, ({ revision }) => revision), [2, 1]);
      assert.strictEqual((yield* get(url, "/api/history/3")).status, 404);
    }).pipe(Effect.provide(NodeServices.layer))
  );
});

describe("gET /api/history/:n", () => {
  it.live("returns the revision as saved: its data and its layout", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const { home, url } = yield* servedWithTwo;

      const sent = yield* get(url, "/api/history/1");

      assert.strictEqual(sent.status, 200, sent.body);

      const revision = yield* decodeRevision(sent.body);

      const onDisk = yield* decodeRevision(
        yield* fs.readFileString(path.join(home, "history", "0001.json"))
      );

      assert.deepStrictEqual(revision, onDisk);
      assert.strictEqual(revision.layout.structures.page?.y, 4);
      assert.strictEqual(
        (yield* decodeRevision((yield* get(url, "/api/history/2")).body)).layout
          .structures.page?.y,
        8
      );
    }).pipe(Effect.provide(NodeServices.layer))
  );

  it.live("answers 404 for a revision that does not exist", () =>
    Effect.gen(function* () {
      const { url } = yield* servedWithTwo;

      for (const n of ["3", "99", "999999999"]) {
        const sent = yield* get(url, `/api/history/${n}`);

        assert.strictEqual(sent.status, 404, `${n}: ${sent.body}`);
      }
    })
  );

  it.live("refuses a path-traversal attempt, and reads nothing outside history/", () =>
    Effect.gen(function* () {
      const { root, url } = yield* servedWithTwo;

      const attempts = [
        "..%2F..%2Fdata",
        "..%2F..%2Fdata.mjs",
        "%2e%2e%2f%2e%2e%2fdata",
        "..%5C..%5Cdata",
        "..%2F0001",
        "0001.json",
        "%2Fetc%2Fpasswd",
        "1%2F..%2F..%2Fdata",
        "1%00",
      ];

      for (const attempt of attempts) {
        const sent = yield* get(url, `/api/history/${attempt}`);

        assert.include([400, 404], sent.status, `${attempt}: ${sent.status}`);
        assert.notInclude(sent.body, "Review loop", attempt);
        assert.notInclude(sent.body, "export default", attempt);
      }

      // The same names pointing at real files, written where a traversal
      // would land, are not served either.
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;

      yield* fs.writeFileString(
        path.join(root, "review", "data.json"),
        '{"secret":true}'
      );

      const sent = yield* get(url, "/api/history/..%2F..%2Fdata");

      assert.notInclude(sent.body, "secret");
    }).pipe(Effect.provide(NodeServices.layer))
  );

  it.live("refuses a number that is not a whole number from 1", () =>
    Effect.gen(function* () {
      const { url } = yield* servedWithTwo;

      const refused = [
        "abc",
        "1.5",
        "1e2",
        "0x10",
        "0",
        "-1",
        "+1",
        "01",
        "0001",
        "%201",
        "1%20",
        "1,2",
        "NaN",
        "Infinity",
        "9007199254740993",
        "1234567890",
      ];

      for (const n of refused) {
        const sent = yield* get(url, `/api/history/${n}`);

        assert.strictEqual(sent.status, 400, `${n}: ${sent.status} ${sent.body}`);
      }
    })
  );
});

describe("the events stream", () => {
  it.live("sends HistoryUpdated when it opens, and again when a revision is saved", () =>
    Effect.gen(function* () {
      const { url } = yield* servedWithTwo;
      const open = yield* Latch.make();

      const response = yield* HttpClient.HttpClient.use((client) =>
        client.execute(HttpClientRequest.get(new URL("/api/events", url)))
      ).pipe(Effect.orDie);

      const lengths = response.stream.pipe(
        Stream.decodeText(),
        Stream.splitLines,
        Stream.filter((line) => line.startsWith("data:")),
        Stream.mapEffect((line) => decodeEvent(line.slice("data:".length).trim())),
        Stream.flatMap((event) =>
          event._tag === "HistoryUpdated"
            ? Stream.make(Arr.map(event.history, ({ revision }) => revision))
            : Stream.empty
        ),
        Stream.tap(() => open.open),
        Stream.take(2),
        Stream.runCollect
      );

      const seen = yield* Effect.forkChild(lengths);

      yield* open.await;
      yield* acceptMove(url, 4, [4, 10], "Third");

      assert.deepStrictEqual(yield* Fiber.join(seen), [
        [2, 1],
        [3, 2, 1],
      ]);
    }).pipe(
      Effect.scoped,
      Effect.orDie,
      Effect.provide(NodeHttpClient.layerNodeHttp)
    ),
    30_000
  );
});
