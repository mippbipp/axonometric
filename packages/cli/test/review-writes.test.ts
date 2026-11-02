import { Proposals } from "@axonometric/contracts";
import { NodeHttpClient, NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Path, Schema, String as Str } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";

import { fullMap } from "./fixtures.ts";
import { makeHome, runCli, startServe } from "./harness.ts";

// Plain HTTP writes to the review routes of a real serve, for the requests a
// browser won't send. Each refused write must leave every file as it was.

const at = "2026-11-01T09:00:00.000Z";

const frozenFile = `${JSON.stringify(
  {
    format: 1,
    revision: 3,
    layout: [],
    notes: [],
    batches: [
      {
        number: 1,
        frozenAt: at,
        items: [
          {
            id: "frozen-note",
            kind: "note",
            target: { kind: "structure", id: "server" },
            text: "Waiting for the agent",
          },
          {
            id: "frozen-move",
            kind: "layout",
            change: {
              id: "frozen-move",
              kind: "move",
              moves: [
                {
                  target: { kind: "structure", id: "engineer" },
                  position: { x: 0, y: 4 },
                },
              ],
            },
          },
        ],
        verdicts: {},
      },
    ],
  },
  null,
  2
)}\n`;

const served = Effect.gen(function* () {
  const path = yield* Path.Path;

  const root = yield* makeHome({
    ...(yield* fullMap),
    "review/map/proposals.json": frozenFile,
  });

  const home = path.join(root, "review", "map");
  const serve = yield* startServe(home, ["--port", "0"]);

  return { home, url: serve.url };
}).pipe(Effect.provide(NodeServices.layer));

interface Sent {
  readonly status: number;
  readonly body: string;
}

interface Write {
  readonly url: string;
  readonly pathname: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

const send =
  (make: typeof HttpClientRequest.post) =>
  ({ url, pathname, headers, body }: Write) =>
    HttpClient.HttpClient.use((client) =>
      client.execute(
        make(new URL(pathname, url)).pipe(
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

const sendPost = send(HttpClientRequest.post);

const sendPut = send(HttpClientRequest.put);

/** A write to `pathname`, as `[url, pathname, headers, body]`. */
type Args = readonly [
  url: string,
  pathname: string,
  headers: Readonly<Record<string, string>>,
  body: string,
];

const post = (...[url, pathname, headers, body]: Args) =>
  sendPost({ url, pathname, headers, body });

const put = (...[url, pathname, headers, body]: Args) =>
  sendPut({ url, pathname, headers, body });

const own = (url: string) => ({
  origin: url,
  "content-type": "application/json",
});

const json = (value: Readonly<Record<string, Schema.Json>>) =>
  JSON.stringify(value);

const proposalsText = (home: string) =>
  runCli(home, ["--version"]).pipe(
    Effect.map(({ files }) => files["proposals.json"] ?? "")
  );

const FrozenAnswer = Schema.Struct({
  batch: Schema.Struct({ number: Schema.Int }),
  prompt: Schema.String,
  proposals: Proposals,
});

const decodeFrozen = Schema.decodeUnknownEffect(
  Schema.fromJsonString(FrozenAnswer)
);

const decodeProposals = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Proposals)
);

const routes = [
  "/api/notes",
  "/api/notes/edit",
  "/api/notes/discard",
  "/api/review/freeze",
  "/api/review/dismiss",
  "/api/review/reopen",
] as const;

describe("the review routes", () => {
  it.live(
    "refuse a write from another origin, with no origin and as text",
    () =>
      Effect.gen(function* () {
        const { home, url } = yield* served;
        const before = yield* proposalsText(home);
        const body = json({ baseFileRevision: 3 });

        for (const route of routes) {
          const foreign = yield* post(
            url,
            route,
            {
              origin: "http://evil.example",
              "content-type": "application/json",
            },
            body
          );

          const none = yield* post(
            url,
            route,
            { "content-type": "application/json" },
            body
          );

          const asText = yield* post(
            url,
            route,
            { origin: url, "content-type": "text/plain" },
            body
          );

          assert.strictEqual(foreign.status, 403, route);
          assert.strictEqual(none.status, 403, route);
          assert.strictEqual(asText.status, 415, route);
        }

        assert.strictEqual(yield* proposalsText(home), before);
      })
  );

  it.live("refuse a body that doesn't match, or over the limit", () =>
    Effect.gen(function* () {
      const { home, url } = yield* served;
      const before = yield* proposalsText(home);

      const bad = [
        "{ not json",
        json({
          baseFileRevision: 3,
          id: "n1",
          target: { kind: "hop", id: "x" },
          text: "t",
        }),
        json({
          baseFileRevision: 3,
          id: "../x",
          target: { kind: "structure", id: "server" },
          text: "t",
        }),
        json({
          baseFileRevision: 3,
          id: "n1",
          target: { kind: "structure", id: "server" },
          text: "",
        }),
        json({
          baseFileRevision: 3,
          id: "n1",
          target: { kind: "structure", id: "server" },
          text: "t",
          extra: true,
        }),
      ];

      for (const body of bad) {
        const sent = yield* post(url, "/api/notes", own(url), body);

        assert.strictEqual(sent.status, 400, body);
      }

      const long = json({
        baseFileRevision: 3,
        id: "n1",
        target: { kind: "structure", id: "server" },
        text: Str.repeat(2001)("x"),
      });

      assert.strictEqual(
        (yield* post(url, "/api/notes", own(url), long)).status,
        400
      );

      const huge = yield* post(
        url,
        "/api/notes",
        own(url),
        `${long}${Str.repeat(300 * 1024)(" ")}`
      );

      assert.strictEqual(huge.status, 413);
      assert.strictEqual(yield* proposalsText(home), before);
    })
  );

  it.live("refuse a note on a structure the map doesn't have", () =>
    Effect.gen(function* () {
      const { home, url } = yield* served;
      const before = yield* proposalsText(home);

      const sent = yield* post(
        url,
        "/api/notes",
        own(url),
        json({
          baseFileRevision: 3,
          id: "n1",
          target: { kind: "structure", id: "no-such-structure" },
          text: "Hello",
        })
      );

      assert.strictEqual(sent.status, 422);
      assert.include(sent.body, "no-such-structure");
      assert.strictEqual(yield* proposalsText(home), before);
    })
  );

  it.live("refuse to edit or discard a note frozen in a batch", () =>
    Effect.gen(function* () {
      const { home, url } = yield* served;
      const before = yield* proposalsText(home);

      const edit = yield* post(
        url,
        "/api/notes/edit",
        own(url),
        json({ baseFileRevision: 3, id: "frozen-note", text: "Rewritten" })
      );

      const discard = yield* post(
        url,
        "/api/notes/discard",
        own(url),
        json({ baseFileRevision: 3, id: "frozen-note" })
      );

      for (const sent of [edit, discard]) {
        assert.strictEqual(sent.status, 422);
        assert.include(sent.body, "waiting for the agent");
      }

      assert.strictEqual(yield* proposalsText(home), before);
    })
  );

  it.live("refuse to dismiss or reopen an item that wasn't reviewed", () =>
    Effect.gen(function* () {
      const { home, url } = yield* served;
      const before = yield* proposalsText(home);

      const dismiss = yield* post(
        url,
        "/api/review/dismiss",
        own(url),
        json({ baseFileRevision: 3, id: "frozen-note" })
      );

      const reopen = yield* post(
        url,
        "/api/review/reopen",
        own(url),
        json({ baseFileRevision: 3, id: "frozen-note", newId: "again" })
      );

      assert.strictEqual(dismiss.status, 422);
      assert.strictEqual(reopen.status, 422);
      assert.strictEqual(yield* proposalsText(home), before);
    })
  );

  it.live("refuse a stale write, and send the file as it is", () =>
    Effect.gen(function* () {
      const { home, url } = yield* served;
      const before = yield* proposalsText(home);

      const sent = yield* post(
        url,
        "/api/notes",
        own(url),
        json({
          baseFileRevision: 1,
          id: "n1",
          target: { kind: "structure", id: "server" },
          text: "Based on an old file",
        })
      );

      assert.strictEqual(sent.status, 409);
      assert.include(sent.body, "StaleProposals");
      assert.strictEqual(yield* proposalsText(home), before);
    })
  );

  it.live("refuse to freeze when nothing is open", () =>
    Effect.gen(function* () {
      const { home, url } = yield* served;
      const before = yield* proposalsText(home);

      const sent = yield* post(
        url,
        "/api/review/freeze",
        own(url),
        json({ baseFileRevision: 3 })
      );

      assert.strictEqual(sent.status, 422);
      assert.include(sent.body, "Nothing is ready for review");
      assert.strictEqual(yield* proposalsText(home), before);
    })
  );

  it.live(
    "freeze answers with the batch and a prompt that names the absolute home folder",
    () =>
      Effect.gen(function* () {
        const { home, url } = yield* served;

        const added = yield* post(
          url,
          "/api/notes",
          own(url),
          json({
            baseFileRevision: 3,
            id: "n-open",
            target: { kind: "structure", id: "page" },
            text: "A fresh question",
          })
        );

        assert.strictEqual(added.status, 200, added.body);

        const frozen = yield* post(
          url,
          "/api/review/freeze",
          own(url),
          json({ baseFileRevision: 4 })
        );

        assert.strictEqual(frozen.status, 200, frozen.body);

        const answer = yield* decodeFrozen(frozen.body);

        assert.strictEqual(answer.batch.number, 2);
        assert.include(answer.prompt, home);
        assert.include(answer.prompt, "batch 2");
        assert.include(answer.prompt, "summary");

        const saved = yield* decodeProposals(yield* proposalsText(home));

        assert.deepStrictEqual(saved, answer.proposals);
      })
  );

  it.live(
    "the layout write can't rewrite a frozen change or reuse its id",
    () =>
      Effect.gen(function* () {
        const { home, url } = yield* served;
        const before = yield* proposalsText(home);

        const reuse = yield* put(
          url,
          "/api/proposals/layout",
          own(url),
          json({
            baseFileRevision: 3,
            layout: [
              {
                id: "frozen-move",
                kind: "move",
                moves: [
                  {
                    target: { kind: "structure", id: "engineer" },
                    position: { x: 0, y: 8 },
                  },
                ],
              },
            ],
          })
        );

        assert.strictEqual(reuse.status, 422);
        assert.include(reuse.body, "frozen-move");
        assert.strictEqual(yield* proposalsText(home), before);

        // An open move that lands on a frozen one's spot is refused as an
        // overlap: frozen changes still count.
        const onto = yield* put(
          url,
          "/api/proposals/layout",
          own(url),
          json({
            baseFileRevision: 3,
            layout: [
              {
                id: "open-move",
                kind: "move",
                moves: [
                  {
                    target: { kind: "structure", id: "page" },
                    position: { x: 0, y: 4 },
                  },
                ],
              },
            ],
          })
        );

        assert.strictEqual(onto.status, 422);
        assert.strictEqual(yield* proposalsText(home), before);
      })
  );
});
