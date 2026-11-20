import { ProposalsFile, ReviewReport, Revision } from "@axonometric/contracts";
import type {
  Batch,
  BatchItem,
  FlowChange,
  HopChange,
  Proposals,
} from "@axonometric/contracts";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect, Schema, String as Str } from "effect";

import { fullMap } from "./fixtures.ts";
import { makeHome, runCli, mapKeys, homeKeys, mapIn } from "./harness.ts";

// Seam 1: a hop and a flow proposed on the page, through freeze, verdict and
// commit. The review map has the hops h-note, h-save, h-store and h-pr, and
// the flow f-note. Chapter c-page plays h-note, and c-save plays the first
// three.

const at = "2026-11-01T09:00:00.000Z";

const drawn: HopChange = {
  action: "add",
  hop: { from: "engineer", id: "new-1", label: "calls the API", to: "server" },
};

const hopItem = (id: string, change: HopChange): BatchItem => ({
  change,
  id,
  kind: "hop",
});

const flowItem = (id: string, change: FlowChange): BatchItem => ({
  change,
  id,
  kind: "flow",
});

const fileOf = (proposals: Proposals) =>
  `${JSON.stringify(proposals, null, 2)}\n`;

const batchOf = (
  items: ReadonlyArray<BatchItem>,
  verdicts: Batch["verdicts"] = {}
): Batch => ({ frozenAt: at, items, number: 1, verdicts });

const homeWith = (
  items: ReadonlyArray<BatchItem>,
  verdicts: Batch["verdicts"] = {},
  dataEdit: (data: string) => string = (data) => data
) =>
  Effect.gen(function* () {
    const files = yield* fullMap;

    const root = yield* makeHome({
      ...files,
      [mapKeys("review").dataFile]: dataEdit(
        files[mapKeys("review").dataFile] ?? ""
      ),
      [mapKeys("review").proposalsFile]: fileOf({
        batches: [batchOf(items, verdicts)],
        format: 1,
        layout: [],
        notes: [],
        revision: 4,
      }),
    });

    return { home: mapIn(root, "review").home, root };
  }).pipe(Effect.provide(NodeServices.layer));

/** data.mjs with a hop `id` from the engineer to the server, played by the first chapter's neighbour. */
const withHop = (id: string) => (data: string) =>
  Str.replace(
    '    { id: "h-pr", from: "proposals", to: "pull-request", label: "accepted" },\n',
    `    { id: "h-pr", from: "proposals", to: "pull-request", label: "accepted" },
    { id: ${JSON.stringify(id)}, from: "engineer", to: "server", label: "calls the API" },\n`
  )(data);

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
          committed.files[homeKeys.proposalsFile] ?? ""
        );

        assert.isDefined(proposals.batches?.[0]?.committed);
      })
  );
});

describe("a hop deleted on the page, through review and commit", () => {
  const delSave = hopItem("p1", { action: "delete", hop: "h-save" });

  it.effect(
    "review flags it in text and in --json breaks, naming the chapter and the flow",
    () =>
      Effect.gen(function* () {
        const { home } = yield* homeWith([delSave]);

        const text = yield* runCli(home, ["review", home]);

        assert.strictEqual(text.exitCode, 0, text.stderr);
        assert.include(
          text.stdout,
          'BREAKS THE MAP if accepted: Deleting hop "h-save"'
        );

        const json = yield* runCli(home, ["review", home, "--json"]);
        const report = yield* decodeReview(json.stdout);
        const [first] = report.batch?.items ?? [];

        assert.include(
          first?.breaks ?? "",
          'chapter c-save ("Saving") plays it'
        );
        assert.include(first?.breaks ?? "", 'flow f-note ("A note") lists it');
        assert.deepStrictEqual(
          Arr.map(first?.targets ?? [], ({ id }) => id),
          ["h-save"]
        );
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
