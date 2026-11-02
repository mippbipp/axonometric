import { LayoutFile, ProposalsFile, Revision } from "@axonometric/contracts";
import type { Batch, BatchItem, Proposals } from "@axonometric/contracts";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect, FileSystem, Option, Path, Schema } from "effect";

import { ReviewReport } from "../src/review.ts";
import { fullMap } from "./fixtures.ts";
import { makeHome, runCli, startServe } from "./harness.ts";
import type { HomeFiles } from "./harness.ts";

// The review commands on a temporary home folder: review, verdict and commit.
// None of them needs a server, and the first tests run without one.

const at = "2026-11-01T09:00:00.000Z";

const moveItem: BatchItem = {
  id: "move-engineer",
  kind: "layout",
  change: {
    id: "move-engineer",
    kind: "move",
    moves: [
      {
        target: { kind: "structure", id: "engineer" },
        position: { x: 0, y: 4 },
      },
    ],
  },
};

const resizeItem = (w: number): BatchItem => ({
  id: "resize-page",
  kind: "layout",
  change: {
    id: "resize-page",
    kind: "resize",
    target: { kind: "structure", id: "page" },
    footprint: { w, d: 2 },
  },
});

const noteItem: BatchItem = {
  id: "note-server",
  kind: "note",
  target: { kind: "structure", id: "server" },
  text: "Why does the server push, not the page poll?",
};

const batchOf = (
  number: number,
  items: readonly BatchItem[],
  verdicts: Batch["verdicts"] = {}
): Batch => ({ number, frozenAt: at, items, verdicts });

const fileOf = (proposals: Proposals) =>
  `${JSON.stringify(proposals, null, 2)}\n`;

/** A proposals file at revision 4 holding `batches`. */
const withBatches = (batches: readonly Batch[]): Proposals => ({
  format: 1,
  revision: 4,
  layout: [],
  notes: [],
  batches,
});

const firstBatch: readonly BatchItem[] = [moveItem, resizeItem(3), noteItem];

/** The first batch with the given verdicts, as a file's text. */
const proposalsWith = (
  verdicts: Batch["verdicts"] = {},
  committed?: Batch["committed"]
) => {
  const batch = batchOf(1, firstBatch, verdicts);

  return fileOf(
    withBatches([committed === undefined ? batch : { ...batch, committed }])
  );
};

const decided: Batch["verdicts"] = {
  "move-engineer": { verdict: "accepted" },
  "resize-page": {
    verdict: "rejected",
    reason: "A 3 × 2 page covers the hop.",
  },
  "note-server": { verdict: "changed", reason: "Added to the overview." },
};

const homeWith = (proposals: string, more: HomeFiles = {}) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;

    const root = yield* makeHome({
      ...(yield* fullMap),
      "review/map/proposals.json": proposals,
      ...more,
    });

    return { root, home: path.join(root, "review", "map") };
  }).pipe(Effect.provide(NodeServices.layer));

const decodeProposals = Schema.decodeUnknownEffect(ProposalsFile);

const decodeRevision = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Revision)
);

const decodeLayout = Schema.decodeUnknownEffect(LayoutFile);

const readIn = Effect.fnUntraced(function* (root: string, file: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  return yield* fs.readFileString(path.join(root, file));
}, Effect.provide(NodeServices.layer));

const decodeReview = Schema.decodeUnknownEffect(
  Schema.fromJsonString(ReviewReport)
);

describe("review", () => {
  it.effect("prints the oldest batch: id, kind, target, before and after", () =>
    Effect.gen(function* () {
      const { home } = yield* homeWith(proposalsWith());

      const result = yield* runCli(home, ["review", home]);

      assert.strictEqual(result.exitCode, 0, result.stderr);
      assert.include(result.stdout, "Batch 1");
      assert.include(result.stdout, "3 items, 3 without a verdict");
      assert.include(result.stdout, "proposals.json");
      assert.include(result.stdout, "move-engineer  move  Engineer (engineer)");
      assert.include(result.stdout, 'before: {"engineer":{"x":0,"y":0}}');
      assert.include(result.stdout, 'after:  {"engineer":{"x":0,"y":4}}');
      assert.include(result.stdout, 'before: {"w":2,"d":2}');
      assert.include(result.stdout, 'after:  {"w":3,"d":2}');
      assert.include(result.stdout, "note-server  note  Save server (server)");
      assert.include(result.stdout, "Why does the server push");
    })
  );

  it.effect("flags an item that would break the map", () =>
    Effect.gen(function* () {
      const batch = batchOf(1, [moveItem, resizeItem(6)]);
      const crowding = fileOf(withBatches([batch]));

      const { home } = yield* homeWith(crowding);

      const result = yield* runCli(home, ["review", home, "--json"]);
      const report = yield* decodeReview(result.stdout);
      const items = report.batch?.items ?? [];
      const resize = Arr.findFirst(items, ({ id }) => id === "resize-page");

      assert.include(Option.getOrNull(resize)?.breaks, "overlap");
      assert.strictEqual(items[0]?.breaks, null);
    })
  );

  it.effect("--json prints the same batch as data", () =>
    Effect.gen(function* () {
      const { home } = yield* homeWith(proposalsWith());

      const result = yield* runCli(home, ["review", home, "--json"]);
      const report = yield* decodeReview(result.stdout);

      assert.strictEqual(report.home, home);
      assert.strictEqual(report.batch?.number, 1);

      assert.deepStrictEqual(
        Arr.map(report.batch?.items ?? [], ({ id, kind }) => [id, kind]),
        [
          ["move-engineer", "move"],
          ["resize-page", "resize"],
          ["note-server", "note"],
        ]
      );
    })
  );

  it.effect("prints the oldest batch with no commit, not a newer one", () =>
    Effect.gen(function* () {
      const later: BatchItem = {
        id: "later-note",
        kind: "note",
        target: { kind: "structure", id: "page" },
        text: "A later question",
      };

      const committed = {
        ...batchOf(1, firstBatch),
        committed: { revision: 1, at },
      };

      const waiting = withBatches([committed, batchOf(2, [later])]);
      const { home } = yield* homeWith(fileOf(waiting));

      const result = yield* runCli(home, ["review", home, "--json"]);
      const report = yield* decodeReview(result.stdout);

      assert.strictEqual(report.batch?.number, 2);
    })
  );

  it.effect("says so when no batch is waiting, and writes nothing", () =>
    Effect.gen(function* () {
      const { home } = yield* homeWith(
        fileOf({ format: 1, revision: 0, layout: [] })
      );

      const result = yield* runCli(home, ["review", home]);

      assert.strictEqual(result.exitCode, 0);
      assert.include(result.stdout, "No batch is waiting for review");
    })
  );

  it.effect("works with no server running and leaves the files alone", () =>
    Effect.gen(function* () {
      const proposals = proposalsWith();
      const { home } = yield* homeWith(proposals);

      const result = yield* runCli(home, ["review", home]);

      assert.strictEqual(result.exitCode, 0, result.stderr);
      assert.strictEqual(result.files["proposals.json"], proposals);
      assert.isUndefined(result.files[".axonometric/server.json"]);
    })
  );
});

describe("verdict", () => {
  it.effect("records a verdict with a reason in proposals.json", () =>
    Effect.gen(function* () {
      const { home } = yield* homeWith(proposalsWith());

      const result = yield* runCli(home, [
        "verdict",
        home,
        "resize-page",
        "rejected",
        "--reason",
        "A 3 × 2 page covers the hop.",
      ]);

      assert.strictEqual(result.exitCode, 0, result.stderr);

      const proposals = yield* decodeProposals(
        result.files["proposals.json"] ?? ""
      );

      assert.deepStrictEqual(proposals.batches?.[0]?.verdicts, {
        "resize-page": {
          verdict: "rejected",
          reason: "A 3 × 2 page covers the hop.",
        },
      });
      assert.strictEqual(proposals.revision, 5);
    })
  );

  it.effect("accepts without a reason", () =>
    Effect.gen(function* () {
      const { home } = yield* homeWith(proposalsWith());

      const result = yield* runCli(home, [
        "verdict",
        home,
        "move-engineer",
        "accepted",
      ]);

      assert.strictEqual(result.exitCode, 0, result.stderr);
      assert.include(result.stdout, "Recorded accepted on move-engineer");
    })
  );

  it.effect("requires a reason for rejected and for changed", () =>
    Effect.gen(function* () {
      const proposals = proposalsWith();
      const { home } = yield* homeWith(proposals);

      for (const decision of ["rejected", "changed"]) {
        const result = yield* runCli(home, [
          "verdict",
          home,
          "resize-page",
          decision,
        ]);

        assert.strictEqual(result.exitCode, 1);
        assert.include(result.stderr, "needs --reason");
        assert.strictEqual(result.files["proposals.json"], proposals);
      }

      const blank = yield* runCli(home, [
        "verdict",
        home,
        "resize-page",
        "rejected",
        "--reason",
        "   ",
      ]);

      assert.strictEqual(blank.exitCode, 1);
      assert.strictEqual(blank.files["proposals.json"], proposals);
    })
  );

  it.effect("fails on an unknown item and names the real ones", () =>
    Effect.gen(function* () {
      const proposals = proposalsWith();
      const { home } = yield* homeWith(proposals);

      const result = yield* runCli(home, [
        "verdict",
        home,
        "no-such-item",
        "accepted",
      ]);

      assert.strictEqual(result.exitCode, 1);
      assert.include(
        result.stderr,
        'No item in batch 1 has the id "no-such-item"'
      );
      assert.include(result.stderr, "move-engineer, resize-page, note-server");
      assert.strictEqual(result.files["proposals.json"], proposals);
    })
  );

  it.effect("fails on a verdict that isn't one of the three", () =>
    Effect.gen(function* () {
      const { home } = yield* homeWith(proposalsWith());

      const result = yield* runCli(home, [
        "verdict",
        home,
        "move-engineer",
        "maybe",
      ]);

      assert.strictEqual(result.exitCode, 1);
    })
  );

  it.effect("fails when no batch is waiting", () =>
    Effect.gen(function* () {
      const { home } = yield* homeWith(
        proposalsWith(decided, { revision: 1, at })
      );

      const result = yield* runCli(home, [
        "verdict",
        home,
        "move-engineer",
        "accepted",
      ]);

      assert.strictEqual(result.exitCode, 1);
      assert.include(result.stderr, "No batch is waiting");
    })
  );
});

describe("commit", () => {
  it.effect("refuses while an item has no verdict, and writes nothing", () =>
    Effect.gen(function* () {
      const proposals = proposalsWith({
        "move-engineer": { verdict: "accepted" },
      });

      const { home, root } = yield* homeWith(proposals);
      const before = yield* readIn(root, "review/map/layout.json");

      const result = yield* runCli(home, ["commit", home]);

      assert.strictEqual(result.exitCode, 1);
      assert.include(result.stderr, "2 items without a verdict");
      assert.include(result.stderr, "resize-page, note-server");
      assert.strictEqual(result.files["proposals.json"], proposals);
      assert.strictEqual(result.files["layout.json"], before);
      assert.isUndefined(result.files["history/0001.json"]);
    })
  );

  it.effect(
    "writes the revision with reasons, applies the layout, and marks the batch committed",
    () =>
      Effect.gen(function* () {
        const { home } = yield* homeWith(proposalsWith(decided));

        const result = yield* runCli(home, [
          "commit",
          home,
          "--message",
          "Review of the first note",
        ]);

        assert.strictEqual(result.exitCode, 0, result.stderr);
        assert.include(
          result.stdout,
          "Committed batch 1 as revision 1: 1 accepted, 1 changed, 1 rejected"
        );

        const revision = yield* decodeRevision(
          result.files["history/0001.json"] ?? ""
        );

        assert.strictEqual(revision.message, "Review of the first note");
        assert.deepStrictEqual(
          Arr.map(revision.accepted, (item) => [item.kind, item.reason]),
          [
            ["layout", undefined],
            ["note", "Added to the overview."],
          ]
        );
        assert.deepStrictEqual(
          Arr.map(revision.rejected, (item) => item.reason),
          ["A 3 × 2 page covers the hop."]
        );

        const layout = yield* decodeLayout(result.files["layout.json"] ?? "");

        assert.deepStrictEqual(layout.structures.engineer, {
          x: 0,
          y: 4,
          w: 2,
          d: 2,
        });
        // The rejected resize did not land.
        assert.deepStrictEqual(layout.structures.page, {
          x: 4,
          y: 0,
          w: 2,
          d: 2,
        });
        assert.deepStrictEqual(revision.layout, layout);

        const proposals = yield* decodeProposals(
          result.files["proposals.json"] ?? ""
        );

        assert.deepStrictEqual(proposals.batches?.[0]?.committed?.revision, 1);
        assert.deepStrictEqual(proposals.batches?.[0]?.verdicts, decided);
        assert.strictEqual(proposals.revision, 5);
      })
  );

  it.effect("rebuilds SYSTEM.md and the read-only page", () =>
    Effect.gen(function* () {
      const { home, root } = yield* homeWith(proposalsWith(decided));

      const result = yield* runCli(home, ["commit", home]);

      assert.strictEqual(result.exitCode, 0, result.stderr);

      assert.include(yield* readIn(root, "review/SYSTEM.md"), "Engineer");
      assert.include(yield* readIn(root, "review/review.html"), "axonometric");
    })
  );

  it.effect("writes a message from the verdicts when none is given", () =>
    Effect.gen(function* () {
      const { home } = yield* homeWith(proposalsWith(decided));
      const result = yield* runCli(home, ["commit", home]);

      const revision = yield* decodeRevision(
        result.files["history/0001.json"] ?? ""
      );

      assert.strictEqual(
        revision.message,
        "Review of batch 1: 1 accepted, 1 changed, 1 rejected"
      );
    })
  );

  it.effect("refuses to commit the same batch twice", () =>
    Effect.gen(function* () {
      const { home } = yield* homeWith(proposalsWith(decided));

      yield* runCli(home, ["commit", home]);

      const again = yield* runCli(home, ["commit", home]);

      assert.strictEqual(again.exitCode, 1);
      assert.include(again.stderr, "No batch is waiting to be committed");
      assert.isUndefined(again.files["history/0002.json"]);
    })
  );

  it.effect("refuses when data.mjs doesn't validate, and writes nothing", () =>
    Effect.gen(function* () {
      const proposals = proposalsWith(decided);

      const { home } = yield* homeWith(proposals, {
        "review/map/data.mjs": "export default { format: 1 };\n",
      });

      const result = yield* runCli(home, ["commit", home]);

      assert.strictEqual(result.exitCode, 1);
      assert.include(result.stderr, "commit wrote nothing");
      assert.strictEqual(result.files["proposals.json"], proposals);
      assert.isUndefined(result.files["history/0001.json"]);
    })
  );

  it.effect(
    "the whole loop works with no server: review, verdict each, commit",
    () =>
      Effect.gen(function* () {
        const { home } = yield* homeWith(proposalsWith());

        for (const [item, decision, reason] of [
          ["move-engineer", "accepted", undefined],
          ["resize-page", "rejected", "Covers the hop."],
          ["note-server", "changed", "Folded into the overview."],
        ] as const) {
          const result = yield* runCli(home, [
            "verdict",
            home,
            item,
            decision,
            ...(reason === undefined ? [] : ["--reason", reason]),
          ]);

          assert.strictEqual(result.exitCode, 0, result.stderr);
        }

        const committed = yield* runCli(home, ["commit", home]);

        assert.strictEqual(committed.exitCode, 0, committed.stderr);
        assert.isUndefined(committed.files[".axonometric/server.json"]);

        const proposals = yield* decodeProposals(
          committed.files["proposals.json"] ?? ""
        );

        assert.strictEqual(proposals.batches?.[0]?.committed?.revision, 1);
      })
  );
});

describe("the commands and a running server", () => {
  it.live("a commit with a server up shows in the server's state", () =>
    Effect.gen(function* () {
      const { home } = yield* homeWith(proposalsWith(decided));

      yield* startServe(home, ["--port", "0"]);

      const result = yield* runCli(home, ["commit", home]);

      assert.strictEqual(result.exitCode, 0, result.stderr);
      assert.isDefined(result.files["history/0001.json"]);
    })
  );
});
