import {
  LayoutFile,
  ProposalsFile,
  ReviewReport,
  Revision,
} from "@axonometric/contracts";
import type {
  Batch,
  BatchItem,
  FlowChange,
  HopChange,
  Proposals,
} from "@axonometric/contracts";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import {
  Array as Arr,
  Effect,
  FileSystem,
  Order,
  Path,
  Record as Rec,
  Schema,
  String as Str,
} from "effect";

import { fullMap } from "./fixtures.ts";
import { makeHome, runCli } from "./harness.ts";

// Seam 1: a hop and a flow proposed on the page, through freeze, verdict and
// commit. The review map has the hops h-note, h-save, h-store and h-pr, and
// the flow f-note. Chapter c-page plays h-note, and c-save plays the first
// three.

const at = "2026-11-01T09:00:00.000Z";

const drawn: HopChange = {
  action: "add",
  hop: { id: "new-1", from: "engineer", to: "server", label: "calls the API" },
};

const hopItem = (id: string, change: HopChange): BatchItem => ({
  id,
  kind: "hop",
  change,
});

const flowItem = (id: string, change: FlowChange): BatchItem => ({
  id,
  kind: "flow",
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

/** data.mjs with a hop `id` from the engineer to the server, played by the first chapter's neighbour. */
const withHop = (id: string) => (data: string) =>
  Str.replace(
    '    { id: "h-pr", from: "proposals", to: "pull-request", label: "accepted" },\n',
    `    { id: "h-pr", from: "proposals", to: "pull-request", label: "accepted" },
    { id: ${JSON.stringify(id)}, from: "engineer", to: "server", label: "calls the API" },\n`
  )(data);

/** data.mjs without hop h-pr: out of the hops, and with no flow or chapter to list it. */
const withoutHop = (data: string) =>
  Str.replace(
    '    { id: "h-pr", from: "proposals", to: "pull-request", label: "accepted" },\n',
    ""
  )(data);

const decodeLayout = Schema.decodeUnknownEffect(LayoutFile);

const decodeProposals = Schema.decodeUnknownEffect(ProposalsFile);

const decodeRevision = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Revision)
);

const decodeReview = Schema.decodeUnknownEffect(
  Schema.fromJsonString(ReviewReport)
);

describe("a hop drawn on the page, through freeze, verdict and commit", () => {
  it.effect(
    "follows the final id from verdict changed --as, after a build, to the revision",
    () =>
      Effect.gen(function* () {
        const { home } = yield* homeWith(
          [hopItem("p1", drawn)],
          {},
          withHop("calls-api")
        );

        // The rebuild a serve watcher runs when the agent saves data.mjs.
        const built = yield* runCli(home, ["build", home]);

        assert.strictEqual(built.exitCode, 0, built.stderr);

        const reviewed = yield* runCli(home, ["review", home, "--json"]);
        const report = yield* decodeReview(reviewed.stdout);

        assert.isNull(report.batch?.items[0]?.breaks);

        const verdict = yield* runCli(home, [
          "verdict",
          home,
          "p1",
          "changed",
          "--reason",
          "Named it calls-api.",
          "--as",
          "calls-api",
        ]);

        assert.strictEqual(verdict.exitCode, 0, verdict.stderr);
        assert.include(verdict.stdout, "changed on p1 as calls-api");

        const committed = yield* runCli(home, ["commit", home]);

        assert.strictEqual(committed.exitCode, 0, committed.stderr);

        const revision = yield* decodeRevision(
          committed.files["history/0001.json"] ?? ""
        );

        const [entry] = revision.accepted;

        assert.strictEqual(entry?.kind, "hop");
        assert.strictEqual(entry?.kind === "hop" ? entry.as : "", "calls-api");
        assert.isTrue(entry?.changed === true);
        assert.isTrue(
          Arr.some(revision.data.hops, ({ id }) => id === "calls-api")
        );

        const proposals = yield* decodeProposals(
          committed.files["proposals.json"] ?? ""
        );

        assert.isDefined(proposals.batches?.[0]?.committed);
      })
  );

  it.effect("takes the provisional id when the agent accepts it as is", () =>
    Effect.gen(function* () {
      const { home } = yield* homeWith(
        [hopItem("p1", drawn)],
        {},
        withHop("new-1")
      );

      const verdict = yield* runCli(home, ["verdict", home, "p1", "accepted"]);

      assert.strictEqual(verdict.exitCode, 0, verdict.stderr);

      const committed = yield* runCli(home, ["commit", home]);

      assert.strictEqual(committed.exitCode, 0, committed.stderr);

      const revision = yield* decodeRevision(
        committed.files["history/0001.json"] ?? ""
      );

      assert.deepStrictEqual(
        Arr.map(revision.accepted, (entry) => [entry.kind, entry.id]),
        [["hop", "p1"]]
      );

      // A hop has no position of its own: layout.json is as it was.
      const layout = yield* decodeLayout(committed.files["layout.json"] ?? "");

      assert.deepStrictEqual(
        Arr.sort(Rec.keys(layout.structures), Order.String),
        ["engineer", "page", "proposals", "pull-request", "server", "upstream"]
      );
    })
  );

  it.effect(
    "refuses to commit an accepted add while data.mjs lacks the hop, and writes nothing",
    () =>
      Effect.gen(function* () {
        const { home } = yield* homeWith([hopItem("p1", drawn)], {
          p1: { verdict: "accepted" },
        });

        const committed = yield* runCli(home, ["commit", home]);

        assert.strictEqual(committed.exitCode, 1);
        assert.include(committed.stderr, '"new-1"');
        assert.include(committed.stderr, "--as");
        assert.isUndefined(committed.files["history/0001.json"]);
      })
  );

  it.effect("refuses --as for an id the accepted map already has", () =>
    Effect.gen(function* () {
      const { home } = yield* homeWith(
        [hopItem("p1", drawn)],
        {},
        withHop("calls-api")
      );

      const fs = yield* FileSystem.FileSystem;
      const file = `${home}/proposals.json`;
      const held = yield* decodeProposals(yield* fs.readFileString(file));

      const frozen = {
        ...held,
        batches: Arr.map(held.batches ?? [], (batch) => ({
          ...batch,
          hops: ["h-note", "calls-api"],
        })),
      };

      yield* fs.writeFileString(file, fileOf(frozen));

      const verdict = yield* runCli(home, [
        "verdict",
        home,
        "p1",
        "changed",
        "--reason",
        "Named it.",
        "--as",
        "calls-api",
      ]);

      assert.strictEqual(verdict.exitCode, 1);
      assert.include(verdict.stderr, "already has");
    }).pipe(Effect.provide(NodeServices.layer))
  );
});

describe("a hop deleted on the page, through review and commit", () => {
  const delPr = hopItem("p1", { action: "delete", hop: "h-pr" });
  const delSave = hopItem("p1", { action: "delete", hop: "h-save" });

  it.effect(
    "review flags a hop a chapter plays, naming the chapter, and a flow, naming the flow",
    () =>
      Effect.gen(function* () {
        const { home } = yield* homeWith([delSave]);

        const text = yield* runCli(home, ["review", home]);

        assert.strictEqual(text.exitCode, 0, text.stderr);
        assert.include(text.stdout, "BREAKS THE MAP if accepted");
        assert.include(text.stdout, 'chapter c-save ("Saving") plays it');
        assert.include(text.stdout, 'flow f-note ("A note") lists it');
      })
  );

  it.effect("review --json carries the same reason in breaks", () =>
    Effect.gen(function* () {
      const { home } = yield* homeWith([delSave]);

      const json = yield* runCli(home, ["review", home, "--json"]);
      const report = yield* decodeReview(json.stdout);
      const [first] = report.batch?.items ?? [];

      assert.include(first?.breaks ?? "", 'chapter c-save ("Saving") plays it');
      assert.include(first?.breaks ?? "", 'flow f-note ("A note") lists it');
      assert.deepStrictEqual(
        Arr.map(first?.targets ?? [], ({ id }) => id),
        ["h-save"]
      );
    })
  );

  it.effect("review is silent for a hop nothing lists or plays", () =>
    Effect.gen(function* () {
      const { home } = yield* homeWith([delPr]);

      const text = yield* runCli(home, ["review", home]);

      assert.strictEqual(text.exitCode, 0, text.stderr);
      assert.notInclude(text.stdout, "BREAKS THE MAP");
    })
  );

  it.effect(
    "refuses to commit an accepted delete while data.mjs still has the hop",
    () =>
      Effect.gen(function* () {
        const { home } = yield* homeWith([delPr], {
          p1: { verdict: "accepted" },
        });

        const committed = yield* runCli(home, ["commit", home]);

        assert.strictEqual(committed.exitCode, 1);
        assert.include(committed.stderr, '"h-pr"');
        assert.include(committed.stderr, "still has");
      })
  );

  it.effect(
    "commits an accepted delete once data.mjs has dropped the hop",
    () =>
      Effect.gen(function* () {
        const { home } = yield* homeWith(
          [delPr],
          { p1: { verdict: "accepted" } },
          withoutHop
        );

        const committed = yield* runCli(home, ["commit", home]);

        assert.strictEqual(committed.exitCode, 0, committed.stderr);

        const revision = yield* decodeRevision(
          committed.files["history/0001.json"] ?? ""
        );

        assert.isFalse(Arr.some(revision.data.hops, ({ id }) => id === "h-pr"));
      })
  );
});

describe("a flow changed on the page, through review and commit", () => {
  const reordered = flowItem("p1", {
    action: "hops",
    flow: "f-note",
    hops: ["h-store", "h-save", "h-note"],
  });

  it.effect("review states the flow's hops before and after, in order", () =>
    Effect.gen(function* () {
      const { home } = yield* homeWith([reordered]);

      const json = yield* runCli(home, ["review", home, "--json"]);
      const report = yield* decodeReview(json.stdout);
      const [first] = report.batch?.items ?? [];

      assert.deepStrictEqual(first?.before, {
        flow: { hops: ["h-note", "h-save", "h-store"] },
      });
      assert.deepStrictEqual(first?.after, {
        flow: { hops: ["h-store", "h-save", "h-note"] },
      });
      assert.isNull(first?.breaks);
    })
  );

  it.effect(
    "review names the item and carries the notice about the order and --as",
    () =>
      Effect.gen(function* () {
        const { home } = yield* homeWith([reordered]);

        const text = yield* runCli(home, ["review", home]);

        assert.strictEqual(text.exitCode, 0, text.stderr);
        assert.include(text.stdout, "p1  change flow hops  ");
        assert.include(text.stdout, "A hops item gives the flow's whole list");
        assert.include(text.stdout, "--as <id>");
      })
  );

  it.effect("commits a new flow once data.mjs has it, under the final id", () =>
    Effect.gen(function* () {
      const created = flowItem("p1", {
        action: "add",
        flow: { id: "new-flow", name: "Round trip" },
        hops: ["h-note", "h-save"],
      });

      const { home } = yield* homeWith([created], {}, (data) =>
        Str.replace(
          "  flows: [\n",
          `  flows: [
    { id: "round-trip", name: "Round trip", hops: ["h-note", "h-save"] },
`
        )(data)
      );

      const verdict = yield* runCli(home, [
        "verdict",
        home,
        "p1",
        "changed",
        "--reason",
        "Named it round-trip.",
        "--as",
        "round-trip",
      ]);

      assert.strictEqual(verdict.exitCode, 0, verdict.stderr);

      const committed = yield* runCli(home, ["commit", home]);

      assert.strictEqual(committed.exitCode, 0, committed.stderr);

      const revision = yield* decodeRevision(
        committed.files["history/0001.json"] ?? ""
      );

      const [entry] = revision.accepted;

      assert.strictEqual(entry?.kind, "flow");
      assert.strictEqual(entry?.kind === "flow" ? entry.as : "", "round-trip");
    })
  );

  it.effect("refuses to commit a new flow while data.mjs lacks it", () =>
    Effect.gen(function* () {
      const created = flowItem("p1", {
        action: "add",
        flow: { id: "new-flow", name: "Round trip" },
        hops: ["h-note"],
      });

      const { home } = yield* homeWith([created], {
        p1: { verdict: "accepted" },
      });

      const committed = yield* runCli(home, ["commit", home]);

      assert.strictEqual(committed.exitCode, 1);
      assert.include(committed.stderr, '"new-flow"');
    })
  );
});
