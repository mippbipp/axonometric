import { LayoutChange, Proposals } from "@axonometric/contracts";
import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect, Schema } from "effect";

import { proposalsText, serveReviewMap, mapKeys } from "./harness.ts";
import { writeText } from "./revisions.ts";

// Plain HTTP writes to a real serve, for a reroute frozen in a batch. The
// server holds the line for every client, undo included, so these go round
// the page. The review map's hop h-store runs from the server down to the
// proposals store.

const at = "2026-11-01T09:00:00.000Z";

const detour = [
  { x: 9, y: 2 },
  { x: 9, y: 2.5 },
  { x: 10, y: 2.5 },
  { x: 10, y: 5.5 },
  { x: 9, y: 5.5 },
  { x: 9, y: 6 },
];

const rerouteOf = (
  id: string,
  hop: string,
  points: typeof detour | null
): LayoutChange => ({
  by: "engineer",
  id,
  kind: "reroute",
  points,
  target: { id: hop, kind: "hop" },
});

const reroute = (id: string, points: typeof detour | null) =>
  rerouteOf(id, "h-store", points);

/** A batch holding a reroute of h-store, and the structure `engineer`'s move. */
const frozenFile = `${JSON.stringify(
  {
    batches: [
      {
        frozenAt: at,
        items: [
          {
            change: reroute("frozen-route", detour),
            id: "frozen-route",
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

const LayoutWrite = Schema.Struct({
  baseFileRevision: Schema.Finite,
  layout: Schema.Array(LayoutChange),
});

const encodeWrite = Schema.encodeEffect(Schema.fromJsonString(LayoutWrite));

const putLayout = (
  url: string,
  baseFileRevision: number,
  layout: ReadonlyArray<LayoutChange>
) =>
  encodeWrite({ baseFileRevision, layout }).pipe(
    Effect.orDie,
    Effect.flatMap((body) =>
      writeText(url, { body, method: "put", target: "/api/proposals/layout" })
    )
  );

const decodeProposals = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Proposals)
);

const waiting = "waiting for the agent";

const handNote = [
  { x: 2, y: 1 },
  { x: 4, y: 1 },
];

describe("a reroute frozen in a batch, written over HTTP", () => {
  it.live(
    "can't be set again on the same hop, nor reset with null points",
    () =>
      Effect.gen(function* () {
        const { home, url } = yield* served;
        const before = yield* proposalsText(home);

        for (const [why, points] of [
          ["again", detour],
          ["reset", null],
        ] as const) {
          const sent = yield* putLayout(url, 3, [reroute(why, points)]);

          assert.strictEqual(sent.status, 422, `${why}: ${sent.body}`);
          assert.include(sent.body, waiting, why);
          assert.include(sent.body, "h-store", why);
        }

        const proposalsAfter = yield* proposalsText(home);
        assert.strictEqual(proposalsAfter, before);
      })
  );

  it.live("doesn't stop a reroute of another hop", () =>
    Effect.gen(function* () {
      const { home, url } = yield* served;

      const sent = yield* putLayout(url, 3, [
        rerouteOf("elsewhere", "h-note", handNote),
      ]);

      assert.strictEqual(sent.status, 200, sent.body);

      const proposalsJson = yield* proposalsText(home);
      const saved = yield* decodeProposals(proposalsJson);

      assert.deepStrictEqual(
        Arr.map(saved.layout, ({ id }) => id),
        ["elsewhere"]
      );
    })
  );
});
