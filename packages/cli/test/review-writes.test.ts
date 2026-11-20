import { Proposals } from "@axonometric/contracts";
import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect, Schema, String as Str } from "effect";

import { proposalsText, readHome, serveReviewMap, mapKeys } from "./harness.ts";
import { ownOrigin, writeText } from "./revisions.ts";

// Plain HTTP writes to the review routes of a real serve, for the requests a
// browser won't send. Each refused write must leave every file as it was.

const at = "2026-11-01T09:00:00.000Z";

const frozenFile = `${JSON.stringify(
  {
    batches: [
      {
        frozenAt: at,
        items: [
          {
            id: "frozen-note",
            kind: "note",
            target: { id: "server", kind: "structure" },
            text: "Waiting for the agent",
          },
          {
            change: {
              id: "frozen-move",
              kind: "move",
              moves: [
                {
                  position: { x: 0, y: 4 },
                  target: { id: "engineer", kind: "structure" },
                },
              ],
            },
            id: "frozen-move",
            kind: "layout",
          },
        ],
        number: 1,
        verdicts: {},
      },
    ],
    format: 1,
    layout: [],
    notes: [],
    revision: 3,
  },
  null,
  2
)}\n`;

const served = serveReviewMap(
  { [mapKeys("review").proposalsFile]: frozenFile },
  []
);

/** A write to `target`, as `[url, target, headers, body]`. */
type Args = readonly [
  url: string,
  target: string,
  headers: Readonly<Record<string, string>>,
  body: string,
];

const post = (...[url, target, headers, body]: Args) =>
  writeText(url, { body, headers, method: "post", target });

const put = (...[url, target, headers, body]: Args) =>
  writeText(url, { body, headers, method: "put", target });

const json = (value: Readonly<Record<string, Schema.Json>>) =>
  JSON.stringify(value);

/** A pending move of `structure` by `by`, as proposals.json holds it. */
const moveTo = (id: string, by: string, structure: string) => ({
  by,
  id,
  kind: "move",
  moves: [
    {
      position: { x: 0, y: 9 },
      target: { id: structure, kind: "structure" },
    },
  ],
});

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
              "content-type": "application/json",
              origin: "http://evil.example",
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
            { "content-type": "text/plain", origin: url },
            body
          );

          assert.strictEqual(foreign.status, 403, route);
          assert.strictEqual(none.status, 403, route);
          assert.strictEqual(asText.status, 415, route);
        }

        const proposalsAfter = yield* proposalsText(home);
        assert.strictEqual(proposalsAfter, before);
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
          target: { id: "x", kind: "unknown" },
          text: "t",
        }),
        json({
          baseFileRevision: 3,
          id: "../x",
          target: { id: "server", kind: "structure" },
          text: "t",
        }),
        json({
          baseFileRevision: 3,
          id: "n1",
          target: { id: "server", kind: "structure" },
          text: "",
        }),
        json({
          baseFileRevision: 3,
          extra: true,
          id: "n1",
          target: { id: "server", kind: "structure" },
          text: "t",
        }),
      ];

      for (const body of bad) {
        const sent = yield* post(url, "/api/notes", ownOrigin(url), body);

        assert.strictEqual(sent.status, 400, body);
      }

      const long = json({
        baseFileRevision: 3,
        id: "n1",
        target: { id: "server", kind: "structure" },
        text: Str.repeat(2001)("x"),
      });

      assert.strictEqual(
        (yield* post(url, "/api/notes", ownOrigin(url), long)).status,
        400
      );
      const proposalsAfter = yield* proposalsText(home);
      assert.strictEqual(proposalsAfter, before);
    })
  );

  it.live("refuse a stale write, and send the file as it is", () =>
    Effect.gen(function* () {
      const { home, url } = yield* served;
      const before = yield* proposalsText(home);

      const sent = yield* post(
        url,
        "/api/notes",
        ownOrigin(url),
        json({
          baseFileRevision: 1,
          id: "n1",
          target: { id: "server", kind: "structure" },
          text: "Based on an old file",
        })
      );

      assert.strictEqual(sent.status, 409);
      assert.include(sent.body, "StaleProposals");
      const proposalsAfter = yield* proposalsText(home);
      assert.strictEqual(proposalsAfter, before);
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
          ownOrigin(url),
          json({
            baseFileRevision: 3,
            id: "n-open",
            target: { id: "page", kind: "structure" },
            text: "A fresh question",
          })
        );

        assert.strictEqual(added.status, 200, added.body);

        const frozen = yield* post(
          url,
          "/api/review/freeze",
          ownOrigin(url),
          json({ baseFileRevision: 4 })
        );

        assert.strictEqual(frozen.status, 200, frozen.body);

        const answer = yield* decodeFrozen(frozen.body);

        assert.strictEqual(answer.batch.number, 2);
        assert.include(answer.prompt, home);
        assert.include(answer.prompt, "batch 2");
        assert.include(answer.prompt, "summary");

        const proposalsJson = yield* proposalsText(home);
        const saved = yield* decodeProposals(proposalsJson);

        assert.deepStrictEqual(saved, answer.proposals);
      })
  );

  it.live(
    "freeze leaves the agent's layout changes open and freezes the engineer's",
    () =>
      Effect.gen(function* () {
        const agents = {
          ...moveTo("agent-move", "agent", "page"),
          reason: "Tidy",
        };

        const { home, url } = yield* serveReviewMap(
          {
            [mapKeys("review").proposalsFile]: `${json({
              format: 1,
              layout: [agents, moveTo("engineer-move", "engineer", "upstream")],
              revision: 1,
            })}\n`,
          },
          []
        );

        const frozen = yield* post(
          url,
          "/api/review/freeze",
          ownOrigin(url),
          json({ baseFileRevision: 1 })
        );

        assert.strictEqual(frozen.status, 200, frozen.body);

        const text = yield* proposalsText(home);
        const saved = yield* decodeProposals(text);

        assert.deepStrictEqual(
          Arr.map(saved.batches?.[0]?.items ?? [], ({ id }) => id),
          ["engineer-move"]
        );
        assert.deepStrictEqual(
          Arr.map(saved.layout, ({ by, id, reason }) => [id, by, reason]),
          [["agent-move", "agent", "Tidy"]]
        );
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
          ownOrigin(url),
          json({
            baseFileRevision: 3,
            layout: [
              {
                id: "frozen-move",
                kind: "move",
                moves: [
                  {
                    position: { x: 0, y: 8 },
                    target: { id: "engineer", kind: "structure" },
                  },
                ],
              },
            ],
          })
        );

        assert.strictEqual(reuse.status, 422);
        assert.include(reuse.body, "frozen-move");
        const proposalsAfterReuse = yield* proposalsText(home);
        assert.strictEqual(proposalsAfterReuse, before);

        // An open move that lands on a frozen one's spot is refused as an
        // overlap: frozen changes still count.
        const onto = yield* put(
          url,
          "/api/proposals/layout",
          ownOrigin(url),
          json({
            baseFileRevision: 3,
            layout: [
              {
                id: "open-move",
                kind: "move",
                moves: [
                  {
                    position: { x: 0, y: 4 },
                    target: { id: "page", kind: "structure" },
                  },
                ],
              },
            ],
          })
        );

        assert.strictEqual(onto.status, 422);
        const proposalsAfterOnto = yield* proposalsText(home);
        assert.strictEqual(proposalsAfterOnto, before);
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
          ownOrigin(url),
          json({
            baseFileRevision: 3,
            layout: [
              {
                id: "open-move",
                kind: "move",
                moves: [
                  {
                    position: { x: 0, y: 12 },
                    target: { id: "engineer", kind: "structure" },
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
          ownOrigin(url),
          json({ baseFileRevision: 4, changeIds: "all" })
        );

        assert.strictEqual(accepted.status, 422, accepted.body);
        assert.include(accepted.body, "Wait for the agent");
        const proposalsAfter = yield* proposalsText(home);
        assert.strictEqual(proposalsAfter, before);

        assert.strictEqual(
          (yield* readHome(home))["history/0001.json"],
          undefined
        );
      })
  );
});

describe("text suggestions, answers and questions", () => {
  const suggestion = {
    after: "Shows the map and saves each note.",
    before: "Shows the map and records notes.",
    field: "oneLiner",
    id: "s-one",
    target: { id: "page", kind: "structure" },
  } as const;

  const answer = {
    answeredOn: "2026-11-02",
    id: "a-one",
    question: "Q-P1",
    target: { id: "page", kind: "structure" },
    text: "Yes, 2000 characters.",
  } as const;

  const question = {
    id: "q-one",
    target: { id: "server", kind: "structure" },
    text: "Should the server retry a failed write?",
  } as const;

  const spotNote = {
    id: "n-spot",
    target: { kind: "spot", x: 14.5, y: 3 },
    text: "A cache could sit here.",
  } as const;

  const hopNote = {
    id: "n-hop",
    target: { id: "h-save", kind: "hop" },
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
        ownOrigin(url),
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
          { ...hopNote, target: { id: "no-such-hop", kind: "hop" } },
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
          { ...question, target: { id: "nowhere", kind: "structure" } },
          "nowhere",
        ],
      ] as const;

      for (const [route, item, why] of refused) {
        const sent = yield* post(
          url,
          route,
          ownOrigin(url),
          json({ baseFileRevision: 3, ...item })
        );

        assert.strictEqual(sent.status, 422, `${route}: ${sent.body}`);
        assert.include(sent.body, why);
      }

      const proposalsAfter = yield* proposalsText(home);
      assert.strictEqual(proposalsAfter, before);
    })
  );

  it.live("edit and discard while open", () =>
    Effect.gen(function* () {
      const { home, url } = yield* served;
      const revision = yield* sendAll(url);

      const edited = yield* post(
        url,
        "/api/items/edit",
        ownOrigin(url),
        json({ baseFileRevision: revision, id: "s-one", text: "Better." })
      );

      assert.strictEqual(edited.status, 200, edited.body);

      const gone = yield* post(
        url,
        "/api/items/discard",
        ownOrigin(url),
        json({ baseFileRevision: revision + 1, id: "a-one" })
      );

      assert.strictEqual(gone.status, 200, gone.body);

      const proposalsJson = yield* proposalsText(home);
      const saved = yield* decodeProposals(proposalsJson);

      assert.strictEqual(saved.suggestions?.[0]?.after, "Better.");
      assert.strictEqual(saved.suggestions?.[0]?.before, suggestion.before);
      assert.deepStrictEqual(saved.answers, []);
    })
  );
});
