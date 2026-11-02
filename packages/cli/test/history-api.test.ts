import { HistoryList, Revision, ServerEvent } from "@axonometric/contracts";
import type { GridPoint } from "@axonometric/contracts";
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
  String as Str,
} from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";

import { fullMap } from "./fixtures.ts";
import { makeHome, startServe } from "./harness.ts";
import { acceptChanges, get, moveOf } from "./revisions.ts";

// The history routes of a real serve, over plain HTTP: what they list, what
// they refuse, and the event that tells open pages a revision was saved.

const decodeList = Schema.decodeUnknownEffect(
  Schema.fromJsonString(HistoryList)
);

const decodeRevision = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Revision)
);

const decodeEvent = Schema.decodeUnknownEffect(
  Schema.fromJsonString(ServerEvent)
);

interface Move {
  readonly base: number;
  readonly to: GridPoint;
  readonly message: string;
}

/**
 * Moves the page to `[x, y]` and accepts it, through the API, as the next
 * revision. `base` is the file revision of proposals.json before the move.
 */
const acceptMove = (url: string, move: Move) =>
  acceptChanges(url, {
    base: move.base,
    changes: [moveOf(`move-${move.to.x}-${move.to.y}`, "page", move.to)],
    message: move.message,
  });

/** The review map served on a free port, with two revisions saved. */
const servedWithTwo = Effect.gen(function* () {
  const path = yield* Path.Path;
  const root = yield* makeHome(yield* fullMap);
  const home = path.join(root, "review", "map");
  const serve = yield* startServe(home, ["--port", "0"]);

  yield* acceptMove(serve.url, {
    base: 0,
    to: { x: 4, y: 4 },
    message: "Drop the page",
  });
  yield* acceptMove(serve.url, {
    base: 2,
    to: { x: 4, y: 8 },
    message: "Drop it further",
  });

  return { root, home, url: serve.url };
}).pipe(Effect.provide(NodeServices.layer));

describe("gET /api/history", () => {
  it.live(
    "lists the revisions newest first, with message, date and item count",
    () =>
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

  it.live(
    "ignores a revision file that does not read, and lists the rest",
    () =>
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
        assert.deepStrictEqual(
          Arr.map(list, ({ revision }) => revision),
          [2, 1]
        );
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

  it.live(
    "refuses a path-traversal attempt, and reads nothing outside history/",
    () =>
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

        assert.strictEqual(
          sent.status,
          400,
          `${n}: ${sent.status} ${sent.body}`
        );
      }
    })
  );
});

describe("the events stream", () => {
  it.live(
    "sends HistoryUpdated when it opens, and again when a revision is saved",
    () =>
      Effect.gen(function* () {
        const { url } = yield* servedWithTwo;
        const open = yield* Latch.make();

        const response = yield* HttpClient.HttpClient.use((client) =>
          client.execute(HttpClientRequest.get(new URL("/api/events", url)))
        ).pipe(Effect.orDie);

        const lengths = response.stream.pipe(
          Stream.decodeText(),
          Stream.splitLines,
          Stream.filter(Str.startsWith("data:")),
          Stream.mapEffect((line) =>
            decodeEvent(Str.trim(Str.slice("data:".length)(line)))
          ),
          Stream.flatMap((event) =>
            ServerEvent.match(event, {
              HistoryUpdated: ({ history }) =>
                Stream.make(Arr.map(history, ({ revision }) => revision)),
              MapUpdated: () => Stream.empty,
              MapRejected: () => Stream.empty,
              PendingUpdated: () => Stream.empty,
              Heartbeat: () => Stream.empty,
            })
          ),
          Stream.tap(() => open.open),
          Stream.take(2),
          Stream.runCollect
        );

        const seen = yield* Effect.forkChild(lengths);

        yield* open.await;
        yield* acceptMove(url, {
          base: 4,
          to: { x: 4, y: 10 },
          message: "Third",
        });

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
