import { Proposals } from "@axonometric/contracts";
import type { Batch, BatchItem } from "@axonometric/contracts";
import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect, Schema } from "effect";

import { proposalsText, serveReviewMap } from "./harness.ts";
import { post } from "./revisions.ts";

// Plain HTTP writes for hop labels and flow names, for the requests a page
// would not send: a name with a line break in it. A refused write must leave
// proposals.json as it was, and answer 422, not die.

const at = "2026-11-01T09:00:00.000Z";

const openHop: BatchItem = {
  id: "open-hop",
  kind: "hop",
  change: { action: "relabel", hop: "h-save", label: "saves" },
};

const rejectedHop: BatchItem = {
  id: "rejected-hop",
  kind: "hop",
  change: { action: "relabel", hop: "h-note", label: "pins" },
};

const rejectedFlow: BatchItem = {
  id: "rejected-flow",
  kind: "flow",
  change: { action: "rename", flow: "f-note", name: "Notes" },
};

const reviewed: Batch = {
  number: 1,
  frozenAt: at,
  items: [rejectedHop, rejectedFlow],
  verdicts: {
    "rejected-hop": { verdict: "rejected", reason: "No." },
    "rejected-flow": { verdict: "rejected", reason: "No." },
  },
  committed: { revision: 1, at },
};

const file = `${JSON.stringify(
  {
    format: 1,
    revision: 3,
    layout: [],
    hops: [
      {
        id: "open-hop",
        change: openHop.kind === "hop" ? openHop.change : undefined,
      },
    ],
    flows: [
      {
        id: "open-flow",
        change: { action: "rename", flow: "f-note", name: "Primary" },
      },
    ],
    batches: [reviewed],
  },
  null,
  2
)}\n`;

const served = serveReviewMap({ "review/map/proposals.json": file }, []);

const json = (value: Readonly<Record<string, Schema.Json>>) =>
  JSON.stringify(value);

const decodeProposals = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Proposals)
);

const breaks = [
  ["LF", "a\nb"],
  ["CR", "a\rb"],
  ["NEL", "a\u0085b"],
  ["LS", "a\u2028b"],
] as const;

describe("editing a hop label or a flow name over HTTP", () => {
  it.live(
    "refuses a line break in every form with a 422, and writes nothing",
    () =>
      Effect.gen(function* () {
        const { home, url } = yield* served;
        const before = yield* proposalsText(home);

        for (const id of ["open-hop", "open-flow"]) {
          for (const [name, text] of breaks) {
            const sent = yield* post(
              url,
              "/api/items/edit",
              json({ baseFileRevision: 3, id, text })
            );

            assert.strictEqual(sent.status, 422, `${id} with ${name}`);
            assert.include(sent.body, "on one line");
          }

          const edge = yield* post(
            url,
            "/api/items/edit",
            json({ baseFileRevision: 3, id, text: "\u0085" })
          );

          assert.strictEqual(edge.status, 422, id);
        }

        assert.strictEqual(yield* proposalsText(home), before);
      })
  );

  it.live("takes a label that fits", () =>
    Effect.gen(function* () {
      const { home, url } = yield* served;

      const sent = yield* post(
        url,
        "/api/items/edit",
        json({ baseFileRevision: 3, id: "open-hop", text: "stores" })
      );

      assert.strictEqual(sent.status, 200, sent.body);

      const saved = yield* decodeProposals(yield* proposalsText(home));
      const [first] = saved.hops ?? [];

      assert.strictEqual(
        first?.change.action === "relabel" ? first.change.label : "",
        "stores"
      );
    })
  );
});

describe("reopening a rejected hop or flow over HTTP", () => {
  it.live(
    "refuses a line break in the new text with a 422, and writes nothing",
    () =>
      Effect.gen(function* () {
        const { home, url } = yield* served;
        const before = yield* proposalsText(home);

        for (const id of ["rejected-hop", "rejected-flow"]) {
          for (const [name, text] of breaks) {
            const sent = yield* post(
              url,
              "/api/review/reopen",
              json({ baseFileRevision: 3, id, newId: "again", text })
            );

            assert.strictEqual(sent.status, 422, `${id} with ${name}`);
            assert.include(sent.body, "on one line");
          }
        }

        assert.strictEqual(yield* proposalsText(home), before);
      })
  );

  it.live("reopens with text that fits", () =>
    Effect.gen(function* () {
      const { home, url } = yield* served;

      const sent = yield* post(
        url,
        "/api/review/reopen",
        json({
          baseFileRevision: 3,
          id: "rejected-flow",
          newId: "again",
          text: "Notes trail",
        })
      );

      assert.strictEqual(sent.status, 200, sent.body);

      const saved = yield* decodeProposals(yield* proposalsText(home));

      assert.isTrue(
        Arr.some(
          saved.flows ?? [],
          ({ id, change }) =>
            id === "again" &&
            change.action === "rename" &&
            change.name === "Notes trail"
        )
      );
    })
  );
});
