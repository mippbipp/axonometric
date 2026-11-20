import { ServerStatus } from "@axonometric/contracts";
import type { LayoutChange } from "@axonometric/contracts";
import { NodeHttpClient, NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import {
  Array as Arr,
  DateTime,
  Effect,
  Option,
  Fiber,
  Stream,
  Schedule,
  Schema,
} from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";

import { makeAgentDecisions, maxDecisions } from "../src/agent-decisions.ts";
import { minimalMap } from "./fixtures.ts";
import {
  makeHome,
  mapIn,
  readProposals,
  runCli,
  serveReviewMap,
} from "./harness.ts";
import { moveOf, write } from "./revisions.ts";

// What the agent reads from `status --json`: the page count, and the
// engineer's decisions on its changes after a time.

const Report = Schema.Struct({
  decisions: Schema.optionalKey(ServerStatus.fields.decisions),
  home: Schema.String,
  now: Schema.optionalKey(ServerStatus.fields.now),
  pages: Schema.optionalKey(Schema.Int),
  running: Schema.Boolean,
});

const decodeReport = Schema.decodeUnknownEffect(Schema.fromJsonString(Report));

/** What `status --json` prints for `home`, with `--since` when given. */
const statusOf = Effect.fnUntraced(function* (home: string, since?: string) {
  const result = yield* runCli(home, [
    "status",
    home,
    "--json",
    ...(since === undefined ? [] : ["--since", since]),
  ]);

  assert.strictEqual(result.exitCode, 0, result.stderr);

  return yield* decodeReport(result.stdout);
});

const nowOf = (report: typeof Report.Type) => {
  assert.isDefined(report.now);

  return DateTime.formatIso(report.now);
};

/** Opens a page's events stream, and returns what closes it. */
const openPage = Effect.fnUntraced(function* (url: string) {
  const reading = yield* HttpClient.HttpClient.use((client) =>
    client.execute(HttpClientRequest.get(new URL("/api/events", url)))
  ).pipe(
    Effect.flatMap((response) => Stream.runDrain(response.stream)),
    Effect.scoped,
    Effect.forkScoped
  );

  return { close: Fiber.interrupt(reading) };
});

/** Waits until status reports `pages`: the server counts a stream a moment after it opens or closes. */
const waitForPages = (home: string, pages: number) =>
  statusOf(home).pipe(
    Effect.filterOrFail(
      (report) => report.pages === pages,
      (report) => `status reports ${report.pages} pages, not ${pages}`
    ),
    Effect.retry({ schedule: Schedule.spaced("100 millis"), times: 200 }),
    Effect.orDie
  );

const proposeVia = Effect.fnUntraced(function* (
  home: string,
  [structure, flag, value, reason]: readonly [string, string, string, string]
) {
  const result = yield* runCli(home, [
    "layout",
    home,
    structure,
    flag,
    value,
    "--propose",
    "--reason",
    reason,
  ]);

  assert.strictEqual(result.exitCode, 0, result.stderr);
});

const touches = (change: LayoutChange, structure: string) =>
  change.kind === "move"
    ? Arr.some(change.moves, ({ target }) => target.id === structure)
    : change.kind === "resize" && change.target.id === structure;

const idOf = (changes: ReadonlyArray<LayoutChange>, structure: string) =>
  Arr.findFirst(changes, (change) => touches(change, structure)).pipe(
    Option.map(({ id }) => id),
    Option.getOrThrowWith(() => new Error(`no change for ${structure}`))
  );

describe("status --json", () => {
  it.live("reports no server as not running, with no pages", () =>
    Effect.gen(function* () {
      const files = yield* minimalMap;
      const root = yield* makeHome(files);
      const { home } = mapIn(root, "pipeline");

      const report = yield* statusOf(home);

      assert.deepStrictEqual(report, { home, running: false });

      const text = yield* runCli(home, ["status", home]);

      assert.include(text.stdout, "No server is running");
    }).pipe(Effect.provide(NodeServices.layer))
  );

  it.live(
    "counts the pages that hold the events stream open",
    () =>
      Effect.gen(function* () {
        const { home, url } = yield* serveReviewMap({}, []);

        const none = yield* statusOf(home);

        assert.strictEqual(none.running, true);
        assert.strictEqual(none.pages, 0);
        assert.isDefined(none.now);

        const first = yield* openPage(url);
        const second = yield* openPage(url);

        yield* waitForPages(home, 2);
        yield* first.close;

        const one = yield* waitForPages(home, 1);

        assert.strictEqual(one.running, true);

        const text = yield* runCli(home, ["status", home]);

        assert.include(text.stdout, "1 page connected");

        yield* second.close;
        yield* waitForPages(home, 0);
      }).pipe(
        Effect.provide([NodeServices.layer, NodeHttpClient.layerNodeHttp])
      ),
    60_000
  );

  it.live(
    "lists the engineer's accepts and discards of agent changes after --since",
    () =>
      Effect.gen(function* () {
        const { home, url } = yield* serveReviewMap({}, []);
        const before = yield* statusOf(home);

        assert.notProperty(before, "decisions");

        yield* proposeVia(home, ["page", "--y", "3", "Tidy the loop"]);
        yield* proposeVia(home, ["server", "--w", "3", "Tidy the loop"]);
        yield* proposeVia(home, ["proposals", "--y", "4", "Make room"]);

        const start = nowOf(before);
        const proposals = yield* readProposals(home);
        const pageId = idOf(proposals.layout, "page");
        const serverId = idOf(proposals.layout, "server");
        const engineer = moveOf("e1", "upstream", { x: 30, y: 30 });

        // The engineer discards the server's change, keeps the rest and adds one.
        const saved = yield* write(url, {
          body: {
            baseFileRevision: proposals.revision,
            layout: [
              ...Arr.filter(proposals.layout, ({ id }) => id !== serverId),
              engineer,
            ],
          },
          method: "put",
          target: "/api/proposals/layout",
        });

        assert.strictEqual(saved.status, 200, saved.body);

        // They accept the page's change and their own.
        const accepted = yield* write(url, {
          body: {
            baseFileRevision: proposals.revision + 1,
            changeIds: [pageId, engineer.id],
          },
          method: "post",
          target: "/api/proposals/accept",
        });

        assert.strictEqual(accepted.status, 200, accepted.body);

        const after = yield* statusOf(home, start);

        assert.deepStrictEqual(
          Arr.map(after.decisions ?? [], ({ change, decision }) => [
            change.id,
            decision,
          ]),
          [
            [serverId, "discarded"],
            [pageId, "accepted"],
          ]
        );

        const startTime = DateTime.makeUnsafe(start);

        for (const { at, change } of after.decisions ?? []) {
          assert.strictEqual(change.by, "agent");
          assert.isTrue(DateTime.isGreaterThan(at, startTime));
        }

        // The reply's own time is the next --since, and it repeats nothing.
        const next = yield* statusOf(home, nowOf(after));

        assert.deepStrictEqual(next.decisions, []);
      }).pipe(Effect.provide(NodeServices.layer)),
    60_000
  );

  it.live(
    "lists nothing for a write the server refuses",
    () =>
      Effect.gen(function* () {
        const { home, url } = yield* serveReviewMap({}, []);

        yield* proposeVia(home, ["page", "--y", "3", "Tidy the loop"]);

        const first = yield* statusOf(home);
        const start = nowOf(first);
        const proposals = yield* readProposals(home);
        const agentChange = yield* Effect.fromNullishOr(proposals.layout[0]);

        const asEngineer = yield* write(url, {
          body: {
            baseFileRevision: proposals.revision,
            layout: [{ ...agentChange, by: "engineer" }],
          },
          method: "put",
          target: "/api/proposals/layout",
        });

        assert.strictEqual(asEngineer.status, 422, asEngineer.body);

        const stale = yield* write(url, {
          body: { baseFileRevision: proposals.revision + 7, layout: [] },
          method: "put",
          target: "/api/proposals/layout",
        });

        assert.strictEqual(stale.status, 409, stale.body);

        const after = yield* statusOf(home, start);

        assert.deepStrictEqual(after.decisions, []);
      }).pipe(Effect.provide(NodeServices.layer)),
    60_000
  );

  it.live(
    "refuses a --since that isn't a date and time, and --since without --json",
    () =>
      Effect.gen(function* () {
        const files = yield* minimalMap;
        const root = yield* makeHome(files);
        const { home } = mapIn(root, "pipeline");

        const bad = yield* runCli(home, [
          "status",
          home,
          "--json",
          "--since",
          "yesterday",
        ]);

        assert.notStrictEqual(bad.exitCode, 0);
        assert.include(bad.stderr, "--since takes a date and time");
        assert.include(bad.stderr, "2026-11-20T09:30:00.000Z");
        assert.include(bad.stderr, '"yesterday"');

        const plain = yield* runCli(home, [
          "status",
          home,
          "--since",
          "2026-11-20T09:30:00.000Z",
        ]);

        assert.notStrictEqual(plain.exitCode, 0);
        assert.include(plain.stderr, "--since only works with --json");
      }).pipe(Effect.provide(NodeServices.layer))
  );
});

const agentMove = (id: string): LayoutChange => ({
  ...moveOf(id, "page", { x: 1, y: 1 }),
  by: "agent",
});

describe("the decision log", () => {
  it.effect(
    "keeps the last 50, oldest first, each later than the one before",
    () =>
      Effect.gen(function* () {
        const log = yield* makeAgentDecisions;
        const epoch = DateTime.makeUnsafe(0);

        for (const n of Arr.range(1, maxDecisions + 1)) {
          yield* log.record([agentMove(`c${n}`)], "discarded");
        }

        // An engineer's change is never logged.
        yield* log.record([moveOf("mine", "page", { x: 1, y: 1 })], "accepted");

        const { decisions } = yield* log.status(epoch);

        assert.strictEqual(decisions.length, maxDecisions);
        assert.strictEqual(decisions[0]?.change.id, "c2");
        assert.strictEqual(decisions.at(-1)?.change.id, `c${maxDecisions + 1}`);

        for (const [index, { at }] of decisions.entries()) {
          const earlier = decisions[index - 1];

          assert.isTrue(
            earlier === undefined || DateTime.isGreaterThan(at, earlier.at)
          );
        }
      })
  );

  it.effect(
    "never loses or repeats a decision made right after a status reply",
    () =>
      Effect.gen(function* () {
        const log = yield* makeAgentDecisions;

        const first = yield* log.status();

        yield* log.record([agentMove("c1")], "accepted");

        const second = yield* log.status(first.now);

        assert.deepStrictEqual(
          Arr.map(second.decisions, ({ change }) => change.id),
          ["c1"]
        );
        assert.deepStrictEqual((yield* log.status(second.now)).decisions, []);
      })
  );
});
