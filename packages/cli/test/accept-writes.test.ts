import {
  Accepted,
  LayoutFile,
  Revision,
  StaleProposals,
} from "@axonometric/contracts";
import type { LayoutChange } from "@axonometric/contracts";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import {
  Array as Arr,
  Effect,
  FileSystem,
  Path,
  Record as Rec,
  Schema,
  String as Str,
} from "effect";

import { pageState, serveReviewMap } from "./harness.ts";
import { moveOf, ownOrigin, writeText } from "./revisions.ts";
import type { Sent } from "./revisions.ts";

// Plain HTTP accepts against a real serve, for the requests a browser won't
// send. Each refused accept must leave every file in the home folder, and
// the files built from it, as they were.

const acceptPath = "/api/proposals/accept";

const layoutPath = "/api/proposals/layout";

const served = serveReviewMap({}, []);

const json = (value: Schema.JsonObject) =>
  Schema.encodeEffect(Schema.fromJsonString(Schema.Json))(value).pipe(
    Effect.orDie
  );

/** Saves `layout` as the pending changes, from revision `base`. */
const pend = (url: string, base: number, layout: readonly LayoutChange[]) =>
  Effect.flatMap(json({ baseFileRevision: base, layout }), (body) =>
    writeText(url, { method: "put", target: layoutPath, body })
  );

const accept = (
  url: string,
  body: Schema.JsonObject,
  headers: Readonly<Record<string, string>> = ownOrigin(url)
) =>
  Effect.flatMap(json(body), (text) =>
    writeText(url, { method: "post", target: acceptPath, headers, body: text })
  );

/** Every file under `root`, the lock and server state left out. */
const snapshot = Effect.fnUntraced(function* (root: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const entries = yield* fs.readDirectory(root, { recursive: true });
  const files: Record<string, string> = {};

  const kept = Arr.filter(
    entries,
    (entry) => !Str.includes(".axonometric")(entry)
  );

  for (const entry of kept) {
    const info = yield* fs.stat(path.join(root, entry));

    if (info.type === "File") {
      files[Arr.join(Str.split(entry, path.sep), "/")] =
        yield* fs.readFileString(path.join(root, entry));
    }
  }

  return files;
}, Effect.provide(NodeServices.layer));

/** Sends an accept and asserts it's refused with `status`, changing no file. */
const assertRefused = Effect.fnUntraced(function* (
  root: string,
  status: number,
  sending: Effect.Effect<Sent>
) {
  const before = yield* snapshot(root);
  const sent = yield* sending;

  assert.strictEqual(sent.status, status, sent.body);
  assert.deepStrictEqual(yield* snapshot(root), before);

  return sent;
});

const decodeAccepted = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Accepted)
);

const decodeRevisionText = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Revision)
);

const decodeLayoutFile = Schema.decodeUnknownEffect(LayoutFile);

describe("accepting pending layout changes over HTTP", () => {
  it.live("accepts one change, and writes the files together", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const { root, home, url } = yield* served;

      yield* pend(url, 0, [
        moveOf("m1", "page", { x: 4, y: 3 }),
        moveOf("m2", "server", { x: 8, y: 3 }),
      ]);

      const sent = yield* accept(url, {
        baseFileRevision: 1,
        changeIds: ["m1"],
        message: "Lower the page",
      });

      assert.strictEqual(sent.status, 200, sent.body);

      const answer = yield* decodeAccepted(sent.body);

      assert.strictEqual(answer.revision, 1);
      assert.strictEqual(answer.message, "Lower the page");
      assert.deepStrictEqual(answer.proposals.layout, [
        moveOf("m2", "server", { x: 8, y: 3 }),
      ]);
      assert.strictEqual(answer.proposals.revision, 2);

      const layout = yield* decodeLayoutFile(
        yield* fs.readFileString(path.join(home, "layout.json"))
      );

      assert.deepStrictEqual(layout.structures.page, {
        x: 4,
        y: 3,
        w: 2,
        d: 2,
      });
      assert.deepStrictEqual(layout.structures.server, {
        x: 8,
        y: 0,
        w: 2,
        d: 2,
      });

      const files = yield* snapshot(root);
      const historyFile = files["review/map/history/0001.json"] ?? "";

      assert.sameMembers(Arr.filter(Rec.keys(files), Str.includes("history")), [
        "review/map/history/0001.json",
      ]);

      const revision = yield* decodeRevisionText(historyFile);

      assert.strictEqual(revision.revision, 1);
      assert.strictEqual(revision.format, 1);
      assert.strictEqual(revision.message, "Lower the page");
      assert.deepStrictEqual(revision.accepted, [
        {
          kind: "layout",
          id: "m1",
          change: moveOf("m1", "page", { x: 4, y: 3 }),
        },
      ]);
      assert.deepStrictEqual(revision.rejected, []);
      assert.deepStrictEqual(revision.layout, layout);
      assert.strictEqual(revision.data.overview.title, "Review loop");
      assert.match(revision.savedAt, /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/u);
    }).pipe(Effect.provide(NodeServices.layer))
  );

  it.live(
    "accepts all, writes a message from the changes, and numbers revisions up by one",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const { home, url } = yield* served;

        yield* pend(url, 0, [
          moveOf("m1", "page", { x: 4, y: 3 }),
          {
            id: "r1",
            kind: "resize",
            target: { kind: "structure", id: "server" },
            footprint: { w: 3, d: 2 },
          },
        ]);

        const first = yield* accept(url, {
          baseFileRevision: 1,
          changeIds: "all",
        });

        const one = yield* decodeAccepted(first.body);

        assert.strictEqual(one.message, "Move Map page; resize Save server");
        assert.deepStrictEqual(one.proposals.layout, []);

        yield* pend(url, 2, [moveOf("m3", "engineer", { x: 0, y: 4 })]);

        const second = yield* accept(url, {
          baseFileRevision: 3,
          changeIds: "all",
        });

        const two = yield* decodeAccepted(second.body);

        assert.strictEqual(two.revision, 2);

        const firstText = yield* fs.readFileString(
          path.join(home, "history", "0001.json")
        );

        assert.include(firstText, '"Move Map page; resize Save server"');
        // The second revision didn't rewrite the first.
        assert.strictEqual(
          yield* fs.readFileString(path.join(home, "history", "0001.json")),
          firstText
        );

        const secondRevision = yield* decodeRevisionText(
          yield* fs.readFileString(path.join(home, "history", "0002.json"))
        );

        assert.strictEqual(secondRevision.revision, 2);
        assert.deepStrictEqual(secondRevision.layout.structures.engineer, {
          x: 0,
          y: 4,
          w: 2,
          d: 2,
        });
      }).pipe(Effect.provide(NodeServices.layer))
  );

  it.live(
    "rebuilds SYSTEM.md and the read-only page with the accepted layout",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const { root, url } = yield* served;
        const html = path.join(root, "review", "review.html");
        const systemMd = path.join(root, "review", "SYSTEM.md");

        yield* pend(url, 0, [moveOf("m1", "page", { x: 4, y: 7 })]);

        // SYSTEM.md holds no positions, so the stand-in text shows that
        // accepting writes it again.
        yield* fs.writeFileString(systemMd, "stale");

        const sent = yield* accept(url, {
          baseFileRevision: 1,
          changeIds: "all",
        });

        assert.strictEqual(sent.status, 200, sent.body);
        assert.include(yield* fs.readFileString(systemMd), "# Review loop");

        const state = yield* pageState(yield* fs.readFileString(html));

        assert.isUndefined(state.proposals);
        assert.deepStrictEqual(state.layout.structures.page, {
          x: 4,
          y: 7,
          w: 2,
          d: 2,
        });
      }).pipe(Effect.provide(NodeServices.layer))
  );

  it.live(
    "refuses an accept based on a stale revision, and sends the current file",
    () =>
      Effect.gen(function* () {
        const { root, url } = yield* served;

        yield* pend(url, 0, [moveOf("m1", "page", { x: 4, y: 3 })]);

        const stale = yield* assertRefused(
          root,
          409,
          accept(url, { baseFileRevision: 0, changeIds: "all" })
        );

        const answer = yield* Schema.decodeEffect(
          Schema.fromJsonString(
            Schema.TaggedStruct("StaleProposals", {
              proposals: StaleProposals.fields.proposals,
            })
          )
        )(stale.body);

        assert.strictEqual(answer.proposals.revision, 1);
      })
  );

  it.live("refuses a body that doesn't match the schema", () =>
    Effect.gen(function* () {
      const { root, url } = yield* served;

      const bodies: readonly Schema.JsonObject[] = [
        {},
        { baseFileRevision: 0 },
        { baseFileRevision: 0, changeIds: [] },
        { baseFileRevision: 0, changeIds: "some" },
        { baseFileRevision: 0, changeIds: ["../x"] },
        { baseFileRevision: 0, changeIds: "all", message: "" },
        {
          baseFileRevision: 0,
          changeIds: "all",
          message: Str.repeat(501)("x"),
        },
        { baseFileRevision: 0, changeIds: "all", file: "../data.mjs" },
      ];

      for (const body of bodies) {
        yield* assertRefused(root, 400, accept(url, body));
      }
    })
  );

  it.live("refuses a set that would overlap once applied", () =>
    Effect.gen(function* () {
      const { root, url } = yield* served;

      // m1 clears the page from where m2 puts the server.
      yield* pend(url, 0, [
        moveOf("m1", "page", { x: 4, y: 4 }),
        moveOf("m2", "server", { x: 4, y: 0 }),
      ]);

      const refused = yield* assertRefused(
        root,
        422,
        accept(url, { baseFileRevision: 1, changeIds: ["m2"] })
      );

      assert.include(refused.body, "overlap");
    })
  );

  it.live(
    "leaves layout.json, proposals.json and history untouched when the revision can't be written, and prints why",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const { root, home, url, serve } = yield* served;

        yield* pend(url, 0, [moveOf("m1", "page", { x: 4, y: 3 })]);

        // With a file where history/ should be, the revision can't be written.
        yield* fs.writeFileString(path.join(home, "history"), "not a folder");

        yield* assertRefused(
          root,
          500,
          accept(url, { baseFileRevision: 1, changeIds: "all" })
        );

        assert.strictEqual(
          yield* fs.readFileString(path.join(home, "history")),
          "not a folder"
        );

        // The 500 has an empty body, so serve prints the cause.
        assert.include(
          serve.output.stderr,
          "serve could not answer a request:"
        );
        assert.include(serve.output.stderr, "history");
      }).pipe(Effect.provide(NodeServices.layer))
  );

  it.live(
    "numbers a revision after the highest in history, and leaves the old file untouched",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const { home, url } = yield* served;
        const old = path.join(home, "history", "0001.json");

        yield* fs.makeDirectory(path.dirname(old), { recursive: true });
        yield* fs.writeFileString(
          old,
          "an earlier revision, not ours to touch"
        );
        yield* pend(url, 0, [moveOf("m1", "page", { x: 4, y: 3 })]);

        const sent = yield* accept(url, {
          baseFileRevision: 1,
          changeIds: "all",
        });

        assert.strictEqual(sent.status, 200, sent.body);
        assert.strictEqual((yield* decodeAccepted(sent.body)).revision, 2);
        assert.strictEqual(
          yield* fs.readFileString(old),
          "an earlier revision, not ours to touch"
        );
        assert.isTrue(
          yield* fs.exists(path.join(home, "history", "0002.json"))
        );
      }).pipe(Effect.provide(NodeServices.layer))
  );

  it.live(
    "drops the earlier change that an accepted one overrides, and says so",
    () =>
      Effect.gen(function* () {
        const { url } = yield* served;

        yield* pend(url, 0, [
          moveOf("m1", "page", { x: 4, y: 3 }),
          moveOf("m2", "page", { x: 4, y: 5 }),
        ]);

        const sent = yield* accept(url, {
          baseFileRevision: 1,
          changeIds: ["m2"],
        });

        assert.strictEqual(sent.status, 200, sent.body);

        const answer = yield* decodeAccepted(sent.body);

        assert.deepStrictEqual(answer.proposals.layout, []);
        assert.strictEqual(answer.layout.structures.page?.y, 5);
        assert.strictEqual(
          answer.message,
          "Move Map page; replaces earlier pending changes to Map page"
        );
      })
  );

  it.live(
    "takes two accepts at once as one success and one stale refusal",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const { home, url } = yield* served;

        yield* pend(url, 0, [
          moveOf("m1", "page", { x: 4, y: 3 }),
          moveOf("m2", "server", { x: 8, y: 3 }),
        ]);

        const [first, second] = yield* Effect.all(
          [
            accept(url, { baseFileRevision: 1, changeIds: ["m1"] }),
            accept(url, { baseFileRevision: 1, changeIds: ["m2"] }),
          ],
          { concurrency: "unbounded" }
        );

        assert.sameMembers([first.status, second.status], [200, 409]);

        const history = yield* fs.readDirectory(path.join(home, "history"));

        assert.deepStrictEqual(history, ["0001.json"]);
      }).pipe(Effect.provide(NodeServices.layer))
  );
});
