import {
  LayoutFile,
  ProposalsFile,
  ReviewReport,
  Revision,
} from "@axonometric/contracts";
import type { Batch, BatchItem, Proposals } from "@axonometric/contracts";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect, FileSystem, Option, Path, Schema } from "effect";

import { fullMap } from "./fixtures.ts";
import { makeHome, runCli } from "./harness.ts";

// A reroute and a group move through the review loop: frozen into a batch,
// shown by review, given a verdict and committed. The review map has the hop
// h-store ("write batch") from the server (8–10, 0–2) down to the proposals
// store (8–10, 6–8).

const at = "2026-11-01T09:00:00.000Z";

/** A route that jogs out of the server's foot, round to x 10 and back in. */
const detour = [
  { x: 9, y: 2 },
  { x: 9, y: 2.5 },
  { x: 10, y: 2.5 },
  { x: 10, y: 5.5 },
  { x: 9, y: 5.5 },
  { x: 9, y: 6 },
];

const rerouteItem: BatchItem = {
  id: "reroute-store",
  kind: "layout",
  change: {
    id: "reroute-store",
    kind: "reroute",
    target: { kind: "hop", id: "h-store" },
    points: detour,
  },
};

/** The loop group (page, server, proposals, pull request) moved down 10. */
const groupItem: BatchItem = {
  id: "move-loop",
  kind: "layout",
  change: {
    id: "move-loop",
    kind: "move",
    moves: [
      { target: { kind: "structure", id: "page" }, position: { x: 4, y: 10 } },
      {
        target: { kind: "structure", id: "server" },
        position: { x: 8, y: 10 },
      },
      {
        target: { kind: "structure", id: "proposals" },
        position: { x: 8, y: 16 },
      },
      {
        target: { kind: "structure", id: "pull-request" },
        position: { x: 12, y: 16 },
      },
    ],
  },
};

const batchOf = (
  items: readonly BatchItem[],
  verdicts: Batch["verdicts"] = {}
): Batch => ({ number: 1, frozenAt: at, items, verdicts });

const fileOf = (proposals: Proposals) =>
  `${JSON.stringify(proposals, null, 2)}\n`;

const homeWith = (items: readonly BatchItem[], verdicts: Batch["verdicts"]) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;

    const root = yield* makeHome({
      ...(yield* fullMap),
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

const decodeLayout = Schema.decodeUnknownEffect(LayoutFile);

const decodeProposals = Schema.decodeUnknownEffect(ProposalsFile);

const decodeRevision = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Revision)
);

const decodeReview = Schema.decodeUnknownEffect(
  Schema.fromJsonString(ReviewReport)
);

describe("review shows a reroute", () => {
  it.effect("with the route before and after, in text and as data", () =>
    Effect.gen(function* () {
      const { home } = yield* homeWith([rerouteItem], {});

      const text = yield* runCli(home, ["review", home]);

      assert.strictEqual(text.exitCode, 0, text.stderr);
      assert.include(text.stdout, 'reroute-store  reroute  "write batch"');
      assert.include(text.stdout, 'before: {"route":"automatic"}');
      assert.include(text.stdout, '"route":[{"x":9,"y":2},{"x":9,"y":2.5}');

      const json = yield* runCli(home, ["review", home, "--json"]);
      const report = yield* decodeReview(json.stdout);
      const [item] = report.batch?.items ?? [];

      assert.strictEqual(item?.kind, "reroute");
      assert.deepStrictEqual(item?.targets, [
        { id: "h-store", name: "write batch" },
      ]);
      assert.deepStrictEqual(item?.before, { route: "automatic" });
      assert.deepStrictEqual(item?.after, { route: detour });
      assert.strictEqual(item?.breaks, null);
    })
  );

  it.effect(
    "flags a reroute that would leave its ends off the footprints",
    () =>
      Effect.gen(function* () {
        // The first point is off the server's edge, but every leg is
        // right-angled, so only the footprint check can object.
        const off: BatchItem = {
          id: "reroute-store",
          kind: "layout",
          change: {
            id: "reroute-store",
            kind: "reroute",
            target: { kind: "hop", id: "h-store" },
            points: [{ x: 9, y: 1 }, { x: 9, y: 2.5 }, ...detour.slice(2)],
          },
        };

        const { home } = yield* homeWith([off], {});
        const json = yield* runCli(home, ["review", home, "--json"]);

        const report = yield* decodeReview(json.stdout);

        assert.include(report.batch?.items[0]?.breaks, "off the edge of");
      })
  );

  it.effect("and a group move as one item that names every member", () =>
    Effect.gen(function* () {
      const { home } = yield* homeWith([groupItem], {});
      const json = yield* runCli(home, ["review", home, "--json"]);
      const report = yield* decodeReview(json.stdout);
      const [item] = report.batch?.items ?? [];

      assert.strictEqual(report.batch?.items.length, 1);
      assert.deepStrictEqual(
        Arr.map(item?.targets ?? [], ({ id }) => id),
        ["page", "server", "proposals", "pull-request"]
      );
      assert.strictEqual(item?.breaks, null);
    })
  );
});

describe("committing a reroute", () => {
  it.effect(
    "an accepted reroute writes the override to layout.json and the revision",
    () =>
      Effect.gen(function* () {
        const { home } = yield* homeWith([rerouteItem], {
          "reroute-store": { verdict: "accepted" },
        });

        const result = yield* runCli(home, ["commit", home]);

        assert.strictEqual(result.exitCode, 0, result.stderr);

        const layout = yield* decodeLayout(result.files["layout.json"] ?? "");

        assert.deepStrictEqual(layout.routes, { "h-store": detour });

        const revision = yield* decodeRevision(
          result.files["history/0001.json"] ?? ""
        );

        assert.deepStrictEqual(layout, revision.layout);
        assert.deepStrictEqual(
          Arr.map(revision.accepted, ({ id }) => id),
          ["reroute-store"]
        );

        const proposals = yield* decodeProposals(
          result.files["proposals.json"] ?? ""
        );

        assert.strictEqual(proposals.batches?.[0]?.committed?.revision, 1);
      })
  );

  it.effect("a rejected reroute leaves the route automatic", () =>
    Effect.gen(function* () {
      const { home } = yield* homeWith([rerouteItem], {
        "reroute-store": { verdict: "rejected", reason: "Goes round the box." },
      });

      const result = yield* runCli(home, ["commit", home]);
      const layout = yield* decodeLayout(result.files["layout.json"] ?? "");

      assert.isUndefined(layout.routes);
    })
  );

  it.effect(
    "a changed reroute keeps the agent's route, set by hand in layout.json",
    () =>
      Effect.gen(function* () {
        // `axonometric layout` moves and resizes structures only, so the
        // agent sets a route by editing layout.json, under routes.

        const { home, root } = yield* homeWith([rerouteItem], {});

        const agents = [
          { x: 9, y: 2 },
          { x: 9, y: 3 },
          { x: 11, y: 3 },
          { x: 11, y: 5 },
          { x: 9, y: 5 },
          { x: 9, y: 6 },
        ];

        const fs = yield* FileSystem.FileSystem;

        const saved = yield* decodeLayout(
          yield* fs.readFileString(`${root}/review/map/layout.json`)
        );

        yield* fs.writeFileString(
          `${root}/review/map/layout.json`,
          yield* Schema.encodeEffect(LayoutFile)({
            ...saved,
            routes: { "h-store": agents },
          })
        );

        const verdict = yield* runCli(home, [
          "verdict",
          home,
          "reroute-store",
          "changed",
          "--reason",
          "Wider berth round the box.",
        ]);

        assert.strictEqual(verdict.exitCode, 0, verdict.stderr);

        const result = yield* runCli(home, ["commit", home]);

        assert.strictEqual(result.exitCode, 0, result.stderr);

        const layout = yield* decodeLayout(result.files["layout.json"] ?? "");

        // The agent's route stands; the proposal's was not applied.
        assert.deepStrictEqual(layout.routes, { "h-store": agents });

        const revision = yield* decodeRevision(
          result.files["history/0001.json"] ?? ""
        );

        const found = Option.getOrThrow(
          Arr.findFirst(revision.accepted, ({ id }) => id === "reroute-store")
        );

        assert.strictEqual("changed" in found && found.changed, true);
      }).pipe(Effect.provide(NodeServices.layer))
  );

  it.effect("an accepted group move lands every member", () =>
    Effect.gen(function* () {
      const { home } = yield* homeWith([groupItem], {
        "move-loop": { verdict: "accepted" },
      });

      const result = yield* runCli(home, ["commit", home]);

      assert.strictEqual(result.exitCode, 0, result.stderr);

      const layout = yield* decodeLayout(result.files["layout.json"] ?? "");

      assert.deepStrictEqual(
        Arr.map(["page", "server", "proposals", "pull-request"], (id) => [
          id,
          layout.structures[id]?.y,
        ]),
        [
          ["page", 10],
          ["server", 10],
          ["proposals", 16],
          ["pull-request", 16],
        ]
      );
      assert.deepStrictEqual(layout.structures.engineer, {
        x: 0,
        y: 0,
        w: 2,
        d: 2,
      });
    })
  );
});
