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
  "/api/items/edit",
  "/api/items/discard",
  "/api/suggestions",
  "/api/answers",
  "/api/questions",
  "/api/review/freeze",
  "/api/review/dismiss",
  "/api/review/reopen",
  "/api/proposals/accept",
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

  it.live("refuse a note that doesn't match the schema", () =>
    Effect.gen(function* () {
      const { home, url } = yield* served;
      const before = yield* proposalsText(home);

      const bad = [
        "{ not json",
        json({
          baseFileRevision: 3,
          id: "n1",
          target: { kind: "unknown", id: "x" },
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

  it.live(
    "accepting a change on a structure a frozen change touches waits for the agent",
    () =>
      Effect.gen(function* () {
        const { home, url } = yield* served;

        // An open move of the engineer, the structure the frozen move acts on.
        const open = yield* put(
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
                    target: { kind: "structure", id: "engineer" },
                    position: { x: 0, y: 12 },
                  },
                ],
              },
            ],
          })
        );

        assert.strictEqual(open.status, 200, open.body);

        const before = yield* proposalsText(home);

        const accepted = yield* post(
          url,
          "/api/proposals/accept",
          own(url),
          json({ baseFileRevision: 4, changeIds: "all" })
        );

        assert.strictEqual(accepted.status, 422, accepted.body);
        assert.include(accepted.body, "Wait for the agent");
        assert.strictEqual(yield* proposalsText(home), before);

        const layout = yield* runCli(home, ["--version"]);

        assert.strictEqual(layout.files["history/0001.json"], undefined);
      })
  );
});

describe("text suggestions, answers and questions", () => {
  const suggestion = {
    id: "s-one",
    target: { kind: "structure", id: "page" },
    field: "oneLiner",
    before: "Shows the map and records notes.",
    after: "Shows the map and saves each note.",
  } as const;

  const answer = {
    id: "a-one",
    target: { kind: "structure", id: "page" },
    question: "Q-P1",
    text: "Yes, 2000 characters.",
    answeredOn: "2026-11-02",
  } as const;

  const question = {
    id: "q-one",
    target: { kind: "structure", id: "server" },
    text: "Should the server retry a failed write?",
  } as const;

  const spotNote = {
    id: "n-spot",
    target: { kind: "spot", x: 14.5, y: 3 },
    text: "A cache could sit here.",
  } as const;

  const hopNote = {
    id: "n-hop",
    target: { kind: "hop", id: "h-save" },
    text: "Why not a socket?",
  } as const;

  /** Sends every item to its route in turn, each on the file the last made. */
  const sendAll = Effect.fnUntraced(function* (url: string) {
    const sent = [
      ["/api/suggestions", suggestion],
      ["/api/answers", answer],
      ["/api/questions", question],
      ["/api/notes", spotNote],
      ["/api/notes", hopNote],
    ] as const;

    let revision = 3;

    for (const [route, item] of sent) {
      const result = yield* post(
        url,
        route,
        own(url),
        json({ baseFileRevision: revision, ...item })
      );

      assert.strictEqual(result.status, 200, `${route}: ${result.body}`);
      revision += 1;
    }

    return revision;
  });

  it.live("are refused when they point at nothing in data.mjs", () =>
    Effect.gen(function* () {
      const { home, url } = yield* served;
      const before = yield* proposalsText(home);

      const refused = [
        [
          "/api/notes",
          { ...hopNote, target: { kind: "hop", id: "no-such-hop" } },
          "no-such-hop",
        ],
        [
          "/api/suggestions",
          { ...suggestion, field: "steps.9.detail" },
          "no step 10 detail",
        ],
        ["/api/answers", { ...answer, question: "Q-P9" }, "Q-P9"],
        ["/api/answers", { ...answer, question: "Q-P2" }, "resolved"],
        [
          "/api/questions",
          { ...question, target: { kind: "structure", id: "nowhere" } },
          "nowhere",
        ],
      ] as const;

      for (const [route, item, why] of refused) {
        const sent = yield* post(
          url,
          route,
          own(url),
          json({ baseFileRevision: 3, ...item })
        );

        assert.strictEqual(sent.status, 422, `${route}: ${sent.body}`);
        assert.include(sent.body, why);
      }

      assert.strictEqual(yield* proposalsText(home), before);
    })
  );

  it.live("edit and discard while open", () =>
    Effect.gen(function* () {
      const { home, url } = yield* served;
      const revision = yield* sendAll(url);

      const edited = yield* post(
        url,
        "/api/items/edit",
        own(url),
        json({ baseFileRevision: revision, id: "s-one", text: "Better." })
      );

      assert.strictEqual(edited.status, 200, edited.body);

      const gone = yield* post(
        url,
        "/api/items/discard",
        own(url),
        json({ baseFileRevision: revision + 1, id: "a-one" })
      );

      assert.strictEqual(gone.status, 200, gone.body);

      const saved = yield* decodeProposals(yield* proposalsText(home));

      assert.strictEqual(saved.suggestions?.[0]?.after, "Better.");
      assert.strictEqual(saved.suggestions?.[0]?.before, suggestion.before);
      assert.deepStrictEqual(saved.answers, []);
    })
  );
});
