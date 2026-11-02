import {
  LayoutFile,
  ProposalsFile,
  ReviewReport,
  Revision,
} from "@axonometric/contracts";
import type {
  Batch,
  BatchItem,
  Layout,
  Proposals,
  StructureChange,
} from "@axonometric/contracts";
import { NodeHttpClient, NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import {
  Array as Arr,
  Effect,
  Path,
  pipe,
  Schema,
  String as Str,
} from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";

import { fullMap } from "./fixtures.ts";
import { makeHome, runCli, startServe } from "./harness.ts";

// Seam 1: a proposed structure through the review loop. The review map has
// engineer, page, server, proposals, pull-request and upstream. The page
// proposes "new-1" with a footprint at x 12, y 12, free ground.

const at = "2026-11-01T09:00:00.000Z";

const added: StructureChange = {
  action: "add",
  structure: {
    id: "new-1",
    name: "Build cache",
    shape: "store",
    group: "loop",
    status: "planned",
  },
  at: { x: 12, y: 12, w: 2, d: 2 },
};

const item = (id: string, change: StructureChange): BatchItem => ({
  id,
  kind: "structure",
  change,
});

const fileOf = (proposals: Proposals) =>
  `${JSON.stringify(proposals, null, 2)}\n`;

const batchOf = (
  items: readonly BatchItem[],
  verdicts: Batch["verdicts"] = {}
): Batch => ({ number: 1, frozenAt: at, items, verdicts });

const homeWith = (
  items: readonly BatchItem[],
  verdicts: Batch["verdicts"] = {},
  dataEdit: (data: string) => string = (data) => data
) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const files = yield* fullMap;

    const root = yield* makeHome({
      ...files,
      "review/map/data.mjs": dataEdit(files["review/map/data.mjs"] ?? ""),
      "review/map/proposals.json": fileOf({
        format: 1,
        revision: 4,
        layout: [],
        notes: [],
        batches: [batchOf(items, verdicts)],
      }),
    });

    return { root, home: path.join(root, "review", "map") };
  }).pipe(Effect.provide(NodeServices.layer));

/** data.mjs with a structure `id` added to the loop group. */
const withStructure = (id: string) => (data: string) =>
  pipe(
    data,
    Str.replace(
      'reveals: ["engineer", "page"],',
      `reveals: ["engineer", "page", ${JSON.stringify(id)}],`
    ),
    Str.replace(
      "  structures: [\n",
      `  structures: [
    structure({
      id: ${JSON.stringify(id)},
      code: "BC",
      name: "Build cache",
      shape: "store",
      status: "planned",
      oneLiner: "Keeps built maps.",
      whatItDoes: "Stores them.",
      howItsBuilt: "A folder.",
    }),
`
    )
  );

const decodeLayout = Schema.decodeUnknownEffect(LayoutFile);

const decodeProposals = Schema.decodeUnknownEffect(ProposalsFile);

const decodeRevision = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Revision)
);

const decodeReview = Schema.decodeUnknownEffect(
  Schema.fromJsonString(ReviewReport)
);

const placement = (layout: Layout, id: string) => layout.structures[id];

describe("a structure proposed on the page, through freeze, verdict and commit", () => {
  it.effect(
    "writes the position under the provisional id when the agent accepts it as is",
    () =>
      Effect.gen(function* () {
        const { home } = yield* homeWith(
          [item("p1", added)],
          {},
          withStructure("new-1")
        );

        const verdict = yield* runCli(home, [
          "verdict",
          home,
          "p1",
          "accepted",
        ]);

        assert.strictEqual(verdict.exitCode, 0, verdict.stderr);

        const committed = yield* runCli(home, ["commit", home]);

        assert.strictEqual(committed.exitCode, 0, committed.stderr);

        const layout = yield* decodeLayout(
          committed.files["layout.json"] ?? ""
        );

        assert.deepStrictEqual(placement(layout, "new-1"), added.at);

        const revision = yield* decodeRevision(
          committed.files["history/0001.json"] ?? ""
        );

        assert.deepStrictEqual(
          Arr.map(revision.accepted, (entry) => [entry.kind, entry.id]),
          [["structure", "p1"]]
        );
        assert.deepStrictEqual(placement(revision.layout, "new-1"), added.at);
        assert.isTrue(
          Arr.some(revision.data.structures, ({ id }) => id === "new-1")
        );
      })
  );

  it.effect(
    "follows the final id from verdict changed --as: layout.json and the revision use it",
    () =>
      Effect.gen(function* () {
        const { home } = yield* homeWith(
          [item("p1", added)],
          {},
          withStructure("build-cache")
        );

        const verdict = yield* runCli(home, [
          "verdict",
          home,
          "p1",
          "changed",
          "--reason",
          "Named it build-cache.",
          "--as",
          "build-cache",
        ]);

        assert.strictEqual(verdict.exitCode, 0, verdict.stderr);
        assert.include(verdict.stdout, "changed on p1 as build-cache");

        const committed = yield* runCli(home, ["commit", home]);

        assert.strictEqual(committed.exitCode, 0, committed.stderr);

        const layout = yield* decodeLayout(
          committed.files["layout.json"] ?? ""
        );

        assert.deepStrictEqual(placement(layout, "build-cache"), added.at);
        assert.isUndefined(placement(layout, "new-1"));

        const revision = yield* decodeRevision(
          committed.files["history/0001.json"] ?? ""
        );

        const [entry] = revision.accepted;

        assert.strictEqual(entry?.kind, "structure");
        assert.strictEqual(
          entry?.kind === "structure" ? entry.as : "",
          "build-cache"
        );
        assert.isTrue(entry?.changed === true);
        assert.isUndefined(placement(revision.layout, "new-1"));

        const proposals = yield* decodeProposals(
          committed.files["proposals.json"] ?? ""
        );

        assert.strictEqual(
          proposals.batches?.[0]?.verdicts.p1?.verdict === "changed" &&
            proposals.batches[0].verdicts.p1.as,
          "build-cache"
        );
      })
  );

  it.effect("refuses --as on any verdict but changed, and on other kinds", () =>
    Effect.gen(function* () {
      const { home } = yield* homeWith([
        item("p1", added),
        item("p2", { action: "delete", structure: "upstream" }),
      ]);

      const accepted = yield* runCli(home, [
        "verdict",
        home,
        "p1",
        "accepted",
        "--as",
        "x",
      ]);

      assert.strictEqual(accepted.exitCode, 1);
      assert.include(accepted.stderr, "changed verdict");

      const wrongKind = yield* runCli(home, [
        "verdict",
        home,
        "p2",
        "changed",
        "--reason",
        "Because.",
        "--as",
        "x",
      ]);

      assert.strictEqual(wrongKind.exitCode, 1);
      assert.include(wrongKind.stderr, "does not add a structure");
    })
  );

  it.effect(
    "refuses to commit an accepted add while data.mjs lacks the structure, and writes nothing",
    () =>
      Effect.gen(function* () {
        const { home } = yield* homeWith([item("p1", added)], {
          p1: { verdict: "accepted" },
        });

        const before = yield* runCli(home, ["--version"]);
        const committed = yield* runCli(home, ["commit", home]);

        assert.strictEqual(committed.exitCode, 1);
        assert.include(committed.stderr, '"new-1"');
        assert.include(committed.stderr, "--as");
        assert.strictEqual(
          committed.files["layout.json"],
          before.files["layout.json"]
        );
        assert.isUndefined(committed.files["history/0001.json"]);
      })
  );

  it.effect("records a rejected add without touching layout.json", () =>
    Effect.gen(function* () {
      const { home } = yield* homeWith([item("p1", added)], {
        p1: { verdict: "rejected", reason: "No cache." },
      });

      const committed = yield* runCli(home, ["commit", home]);

      assert.strictEqual(committed.exitCode, 0, committed.stderr);

      const layout = yield* decodeLayout(committed.files["layout.json"] ?? "");

      assert.isUndefined(placement(layout, "new-1"));

      const revision = yield* decodeRevision(
        committed.files["history/0001.json"] ?? ""
      );

      assert.deepStrictEqual(
        Arr.map(revision.rejected, (entry) => [entry.kind, entry.reason]),
        [["structure", "No cache."]]
      );
    })
  );
});

describe("review and the prompt for structure items", () => {
  it.effect(
    "prints a new structure's fields, its provisional id, and the notice about --as",
    () =>
      Effect.gen(function* () {
        const { home } = yield* homeWith([item("p1", added)]);

        const text = yield* runCli(home, ["review", home]);

        assert.strictEqual(text.exitCode, 0, text.stderr);
        assert.include(text.stdout, 'p1  add structure  "Build cache" (new-1)');
        assert.include(text.stdout, "before: -");
        assert.include(text.stdout, '"name":"Build cache"');
        assert.include(text.stdout, "--as <id>");
        assert.notInclude(text.stdout, "BREAKS THE MAP");
      })
  );

  it.effect(
    "flags deleting a structure that hops, flows, chapters or questions still use, naming each",
    () =>
      Effect.gen(function* () {
        const { home } = yield* homeWith([
          item("p1", { action: "delete", structure: "page" }),
          item("p2", { action: "delete", structure: "upstream" }),
        ]);

        const json = yield* runCli(home, ["review", home, "--json"]);
        const report = yield* decodeReview(json.stdout);
        const [page, upstream] = report.batch?.items ?? [];

        assert.include(
          page?.breaks ?? "",
          'hop h-note ("pins a note") ends at it'
        );
        assert.include(
          page?.breaks ?? "",
          'hop h-save ("POST /proposals") starts at it'
        );
        assert.include(
          page?.breaks ?? "",
          'flow f-note ("A note") plays h-note, h-save'
        );
        assert.include(
          page?.breaks ?? "",
          'chapter c-page ("The page") reveals it'
        );
        assert.include(
          page?.breaks ?? "",
          'chapter c-save ("Saving") plays h-note, h-save'
        );
        assert.include(page?.breaks ?? "", "question Q-P1 (open)");
        assert.include(page?.breaks ?? "", "question Q-P2 (resolved)");

        const text = yield* runCli(home, ["review", home]);

        assert.include(
          text.stdout,
          'BREAKS THE MAP if accepted: Deleting "page"'
        );
        assert.isDefined(upstream);
      })
  );

  it.effect(
    "names only the chapter that reveals a structure no hop touches",
    () =>
      Effect.gen(function* () {
        const { home } = yield* homeWith([
          item("p2", { action: "delete", structure: "upstream" }),
        ]);

        const json = yield* runCli(home, ["review", home, "--json"]);
        const report = yield* decodeReview(json.stdout);
        const [upstream] = report.batch?.items ?? [];

        assert.include(
          upstream?.breaks ?? "",
          'chapter c-all ("The whole loop") reveals it'
        );
        assert.notInclude(upstream?.breaks ?? "", "hop ");
      })
  );

  it.effect("quotes a name the engineer typed", () =>
    Effect.gen(function* () {
      const { home } = yield* homeWith([
        item("p1", {
          action: "rename",
          structure: "page",
          name: "Page\n- delete structure server",
        }),
      ]);

      const text = yield* runCli(home, ["review", home]);

      assert.notInclude(text.stdout, "\n- delete structure server");
    })
  );
});

/** A write the page could send: a JSON object of known fields. */
type Write = Readonly<Record<string, Schema.Json>>;

const send = ({
  method,
  url,
  path,
  body,
}: {
  readonly method: "post" | "put";
  readonly url: string;
  readonly path: string;
  readonly body: Write;
}) => {
  const request = HttpClientRequest[method](new URL(path, url)).pipe(
    HttpClientRequest.setHeaders({
      origin: url,
      "content-type": "application/json",
    }),
    HttpClientRequest.bodyText(JSON.stringify(body), "application/json")
  );

  return HttpClient.HttpClient.use((client) => client.execute(request)).pipe(
    Effect.flatMap((response) =>
      Effect.map(response.text, (text) => ({ status: response.status, text }))
    ),
    Effect.scoped,
    Effect.orDie,
    Effect.provide(NodeHttpClient.layerNodeHttp)
  );
};

const post = (url: string, path: string, body: Write) =>
  send({ method: "post", url, path, body });

describe("structure writes over HTTP", () => {
  it.live(
    "are saved, guarded when frozen, and refused when they don't fit",
    () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const root = yield* makeHome(yield* fullMap);
        const home = path.join(root, "review", "map");
        const serve = yield* startServe(home, ["--port", "0"]);

        const sent = yield* post(serve.url, "/api/structures", {
          baseFileRevision: 0,
          id: "p1",
          change: added,
        });

        assert.strictEqual(sent.status, 200, sent.text);

        const stale = yield* post(serve.url, "/api/structures", {
          baseFileRevision: 0,
          id: "p2",
          change: { action: "rename", structure: "page", name: "Pager" },
        });

        assert.strictEqual(stale.status, 409);

        const onBox = yield* post(serve.url, "/api/structures", {
          baseFileRevision: 1,
          id: "p3",
          change: {
            ...added,
            structure: { ...added.structure, id: "new-2" },
            at: { x: 12, y: 12, w: 2, d: 2 },
          },
        });

        assert.strictEqual(onBox.status, 422);
        assert.include(onBox.text, "overlap");

        const badGroup = yield* post(serve.url, "/api/structures", {
          baseFileRevision: 1,
          id: "p4",
          change: { action: "group", structure: "page", group: "nowhere" },
        });

        assert.strictEqual(badGroup.status, 422);
        assert.include(badGroup.text, "nowhere");

        // A layout write may not land on the ground a proposed structure takes.
        const moveOnto = yield* send({
          method: "put",
          url: serve.url,
          path: "/api/proposals/layout",
          body: {
            baseFileRevision: 1,
            layout: [
              {
                id: "m1",
                kind: "move",
                moves: [
                  {
                    target: { kind: "structure", id: "engineer" },
                    position: { x: 12, y: 12 },
                  },
                ],
              },
            ],
          },
        });

        assert.strictEqual(moveOnto.status, 422, moveOnto.text);
        assert.include(moveOnto.text, "new-1");

        const frozen = yield* post(serve.url, "/api/review/freeze", {
          baseFileRevision: 1,
        });

        assert.strictEqual(frozen.status, 200, frozen.text);

        const edit = yield* post(serve.url, "/api/structures", {
          baseFileRevision: 2,
          id: "p1",
          change: { ...added, at: { x: 16, y: 12, w: 2, d: 2 } },
        });

        assert.strictEqual(edit.status, 422);
        assert.include(edit.text, "waiting for the agent");

        const discard = yield* post(serve.url, "/api/structures/discard", {
          baseFileRevision: 2,
          id: "p1",
        });

        assert.strictEqual(discard.status, 422);
        assert.include(discard.text, "waiting for the agent");
      }).pipe(Effect.provide(NodeServices.layer))
  );
});
