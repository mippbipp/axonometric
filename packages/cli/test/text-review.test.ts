import {
  FreezeAnswer,
  ProposalsFile,
  Revision,
  ReviewReport,
} from "@axonometric/contracts";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import {
  Array as Arr,
  Effect,
  FileSystem,
  Option,
  Path,
  Schema,
  String as Str,
} from "effect";
import { HttpClientRequest } from "effect/http";

import { fullMap } from "./fixtures.ts";
import { makeHome, runCli, startServe } from "./harness.ts";
import { send } from "./revisions.ts";

// Text suggestions, answers and raised questions through the whole loop on a
// real serve: the page's writes, freeze, review, verdict, commit, and the
// revision the commit saves.

const decodeProposals = Schema.decodeUnknownEffect(ProposalsFile);

const decodeRevision = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Revision)
);

const decodeReport = Schema.decodeUnknownEffect(
  Schema.fromJsonString(ReviewReport)
);

const items = [
  [
    "/api/suggestions",
    {
      id: "s-one",
      target: { kind: "structure", id: "page" },
      field: "oneLiner",
      before: "Shows the map and records notes.",
      after: "Shows the map and saves each note.",
    },
  ],
  [
    "/api/answers",
    {
      id: "a-one",
      target: { kind: "structure", id: "page" },
      question: "Q-P1",
      text: "Yes, 2000 characters.",
      answeredOn: "2026-11-02",
    },
  ],
  [
    "/api/questions",
    {
      id: "q-one",
      target: { kind: "structure", id: "server" },
      text: "Should the server retry a failed write?",
    },
  ],
  [
    "/api/notes",
    {
      id: "n-spot",
      target: { kind: "spot", x: 14.5, y: 3 },
      text: "A cache could sit here.",
    },
  ],
  [
    "/api/notes",
    {
      id: "n-hop",
      target: { kind: "hop", id: "h-save" },
      text: "Why not a socket?",
    },
  ],
] as const;

const decodeFrozen = Schema.decodeUnknownEffect(
  Schema.fromJsonString(FreezeAnswer)
);

/** A write to `route`, whose body is already JSON text. */
const post = (url: string, route: string, body: string) =>
  send(
    HttpClientRequest.post(new URL(route, url)).pipe(
      HttpClientRequest.setHeaders({
        origin: url,
        "content-type": "application/json",
      }),
      HttpClientRequest.bodyText(body, "application/json")
    )
  );

const bodyOf = (value: Readonly<Record<string, Schema.Json>>) =>
  JSON.stringify(value);

/** The review map served, with every item sent and frozen into batch 1. */
const frozenOverHttp = Effect.gen(function* () {
  const path = yield* Path.Path;
  const root = yield* makeHome(yield* fullMap);
  const home = path.join(root, "review", "map");
  const serve = yield* startServe(home, ["--port", "0"]);

  let revision = 0;

  for (const [route, item] of items) {
    const sent = yield* post(
      serve.url,
      route,
      bodyOf({ baseFileRevision: revision, ...item })
    );

    assert.strictEqual(sent.status, 200, `${route}: ${sent.body}`);
    revision += 1;
  }

  const frozen = yield* post(
    serve.url,
    "/api/review/freeze",
    bodyOf({ baseFileRevision: revision })
  );

  assert.strictEqual(frozen.status, 200, frozen.body);

  return { root, home, prompt: (yield* decodeFrozen(frozen.body)).prompt };
}).pipe(Effect.provide(NodeServices.layer));

describe("the loop for words", () => {
  it.live(
    "freeze puts every kind in batch 1, and review shows each before and after",
    () =>
      Effect.gen(function* () {
        const { home } = yield* frozenOverHttp;

        const proposals = yield* decodeProposals(
          (yield* runCli(home, ["--version"])).files["proposals.json"] ?? ""
        );

        assert.deepStrictEqual(
          Arr.map(proposals.batches?.[0]?.items ?? [], ({ kind }) => kind),
          ["note", "note", "suggestion", "answer", "question"]
        );
        assert.deepStrictEqual(
          [
            proposals.notes,
            proposals.suggestions,
            proposals.answers,
            proposals.raised,
          ],
          [[], [], [], []]
        );

        const text = yield* runCli(home, ["review", home]);

        assert.strictEqual(text.exitCode, 0, text.stderr);
        assert.include(text.stdout, "5 items, 5 without a verdict");
        assert.include(
          text.stdout,
          'before: {"field":"oneLiner","text":"Shows the map and records notes."}'
        );
        assert.include(
          text.stdout,
          'after:  {"field":"oneLiner","text":"Shows the map and saves each note."}'
        );
        assert.include(
          text.stdout,
          'before: {"question":"Q-P1","text":"Should notes have a length limit?"}'
        );
        assert.include(
          text.stdout,
          'after:  {"question":"Q-P1","text":"Yes, 2000 characters.","answeredOn":"2026-11-02"}'
        );
        assert.include(text.stdout, 'a-one  answer  "Map page" (page)');
        assert.include(text.stdout, 'q-one  question  "Save server" (server)');
        assert.include(text.stdout, 'n-hop  note  "POST /proposals" (h-save)');
        assert.include(text.stdout, '"spot":{"x":14.5,"y":3}');
        assert.include(text.stdout, "answeredBy");
        assert.include(text.stdout, "Assign the id yourself");
        assert.notInclude(text.stdout, "OUT OF DATE");
        assert.notInclude(text.stdout, "BREAKS THE MAP");

        const json = yield* decodeReport(
          (yield* runCli(home, ["review", home, "--json"])).stdout
        );

        assert.deepStrictEqual(
          Arr.map(json.batch?.items ?? [], ({ kind, outOfDate }) => [
            kind,
            outOfDate,
          ]),
          [
            ["note", null],
            ["note", null],
            ["suggestion", null],
            ["answer", null],
            ["question", null],
          ]
        );
      })
  );

  it.live(
    "the prompt has a line for each kind, with the agent's instructions",
    () =>
      Effect.gen(function* () {
        const { prompt } = yield* frozenOverHttp;

        const lines = Str.split("\n")(prompt);
        const listed = Arr.filter(lines, Str.startsWith("- "));

        assert.strictEqual(listed.length, 5);
        assert.isTrue(Arr.some(listed, Str.includes("suggestion s-one on")));
        assert.isTrue(
          Arr.some(listed, Str.includes("answer a-one to Q-P1 on"))
        );
        assert.isTrue(Arr.some(listed, Str.includes("question q-one on")));
        assert.isTrue(Arr.some(listed, Str.includes("the spot 14.5, 3")));
        assert.include(prompt, "Set answeredBy yourself");
      })
  );

  it.live(
    "verdict and commit record all five in the revision, with reasons",
    () =>
      Effect.gen(function* () {
        const { home } = yield* frozenOverHttp;

        const given = [
          ["s-one", "accepted", []],
          ["a-one", "changed", ["--reason", "Added answeredBy and the date."]],
          ["q-one", "rejected", ["--reason", "Q-S1 already asks this."]],
          ["n-spot", "accepted", []],
          ["n-hop", "accepted", ["--reason", "Put in the overview."]],
        ] as const;

        for (const [id, verdict, more] of given) {
          const result = yield* runCli(home, [
            "verdict",
            home,
            id,
            verdict,
            ...more,
          ]);

          assert.strictEqual(result.exitCode, 0, `${id}: ${result.stderr}`);
        }

        const committed = yield* runCli(home, [
          "commit",
          home,
          "--message",
          "Words",
        ]);

        assert.strictEqual(committed.exitCode, 0, committed.stderr);

        const revision = yield* decodeRevision(
          committed.files["history/0001.json"] ?? ""
        );

        assert.deepStrictEqual(
          Arr.map(revision.accepted, (item) => [
            item.kind,
            item.id,
            item.reason,
          ]),
          [
            ["note", "n-spot", undefined],
            ["note", "n-hop", "Put in the overview."],
            ["suggestion", "s-one", undefined],
            ["answer", "a-one", "Added answeredBy and the date."],
          ]
        );
        assert.deepStrictEqual(
          Arr.map(revision.rejected, (item) => [
            item.kind,
            item.id,
            item.reason,
          ]),
          [["question", "q-one", "Q-S1 already asks this."]]
        );

        const answer = Arr.findFirst(
          revision.accepted,
          ({ kind }) => kind === "answer"
        );

        assert.deepStrictEqual(
          answer,
          Option.some({
            kind: "answer",
            id: "a-one",
            target: { kind: "structure", id: "page" },
            question: "Q-P1",
            text: "Yes, 2000 characters.",
            answeredOn: "2026-11-02",
            reason: "Added answeredBy and the date.",
            changed: true,
          })
        );

        const spot = Arr.findFirst(
          revision.accepted,
          ({ id }) => id === "n-spot"
        );

        assert.deepStrictEqual(
          spot,
          Option.some({
            kind: "note",
            id: "n-spot",
            target: { kind: "spot", x: 14.5, y: 3 },
            text: "A cache could sit here.",
          })
        );
      })
  );

  it.live(
    "review says when data.mjs changed the original before the agent looked",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const { home } = yield* frozenOverHttp;
        const file = path.join(home, "data.mjs");
        const data = yield* fs.readFileString(file);

        yield* fs.writeFileString(
          file,
          Str.replaceAll(
            '"Shows the map and records notes."',
            '"Draws the map."'
          )(data)
        );

        const report = yield* decodeReport(
          (yield* runCli(home, ["review", home, "--json"])).stdout
        );

        const stale = Arr.findFirst(
          report.batch?.items ?? [],
          ({ id }) => id === "s-one"
        );

        assert.isTrue(Option.isSome(stale));
        assert.include(Option.getOrThrow(stale).outOfDate, "out of date");

        const text = yield* runCli(home, ["review", home]);

        assert.include(text.stdout, "OUT OF DATE: The original is out of date");
      }).pipe(Effect.provide(NodeServices.layer))
  );
});
