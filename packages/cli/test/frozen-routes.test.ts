import { LayoutChange, Proposals } from "@axonometric/contracts";
import { NodeHttpClient, NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect, Path, Schema } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";

import { fullMap } from "./fixtures.ts";
import { makeHome, runCli, startServe } from "./harness.ts";

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
  id,
  kind: "reroute",
  target: { kind: "hop", id: hop },
  points,
});

const reroute = (id: string, points: typeof detour | null) =>
  rerouteOf(id, "h-store", points);

/** A batch holding a reroute of h-store, and the structure `engineer`'s move. */
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
            id: "frozen-route",
            kind: "layout",
            change: reroute("frozen-route", detour),
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

const LayoutWrite = Schema.Struct({
  baseFileRevision: Schema.Finite,
  layout: Schema.Array(LayoutChange),
});

const encodeWrite = Schema.encodeEffect(Schema.fromJsonString(LayoutWrite));

const putLayout = (
  url: string,
  baseFileRevision: number,
  layout: readonly LayoutChange[]
) =>
  encodeWrite({ baseFileRevision, layout }).pipe(
    Effect.orDie,
    Effect.flatMap((body) =>
      HttpClient.HttpClient.use((client) =>
        client.execute(
          HttpClientRequest.put(new URL("/api/proposals/layout", url)).pipe(
            HttpClientRequest.setHeaders({
              origin: url,
              "content-type": "application/json",
            }),
            HttpClientRequest.bodyText(body, "application/json")
          )
        )
      )
    ),
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

const proposalsText = (home: string) =>
  runCli(home, ["--version"]).pipe(
    Effect.map(({ files }) => files["proposals.json"] ?? "")
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
  it.live("can't be set again on the same hop", () =>
    Effect.gen(function* () {
      const { home, url } = yield* served;
      const before = yield* proposalsText(home);

      const sent = yield* putLayout(url, 3, [reroute("again", detour)]);

      assert.strictEqual(sent.status, 422, sent.body);
      assert.include(sent.body, waiting);
      assert.include(sent.body, "h-store");
      assert.strictEqual(yield* proposalsText(home), before);
    })
  );

  it.live("can't be reset with a reroute of null points", () =>
    Effect.gen(function* () {
      const { home, url } = yield* served;
      const before = yield* proposalsText(home);

      const sent = yield* putLayout(url, 3, [reroute("reset", null)]);

      assert.strictEqual(sent.status, 422, sent.body);
      assert.include(sent.body, waiting);
      assert.strictEqual(yield* proposalsText(home), before);
    })
  );

  it.live("can't be reset by an undo that drops an open reroute of it", () =>
    Effect.gen(function* () {
      const { home, url } = yield* served;

      // An open reroute of the frozen hop can only get in as a client that
      // skips the page's check would send it. It is refused, so there is
      // nothing for an undo to remove, and an undo that sets the list back
      // to empty while also adding a reroute of the hop is refused too.
      const before = yield* proposalsText(home);

      const undone = yield* putLayout(url, 3, [reroute("sneaky", null)]);

      assert.strictEqual(undone.status, 422, undone.body);
      assert.include(undone.body, waiting);
      assert.strictEqual(yield* proposalsText(home), before);
    })
  );

  it.live("doesn't stop a reroute of another hop", () =>
    Effect.gen(function* () {
      const { home, url } = yield* served;

      const sent = yield* putLayout(url, 3, [
        rerouteOf("elsewhere", "h-note", handNote),
      ]);

      assert.strictEqual(sent.status, 200, sent.body);

      const saved = yield* decodeProposals(yield* proposalsText(home));

      assert.deepStrictEqual(
        Arr.map(saved.layout, ({ id }) => id),
        ["elsewhere"]
      );
    })
  );
});
