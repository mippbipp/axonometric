import {
  FreezeAnswer,
  LayoutFile,
  ProposalsFile,
  ReviewReport,
  Revision,
} from "@axonometric/contracts";
import type {
  Batch,
  BatchItem,
  ChapterChange,
  GroupChange,
  Proposals,
  StructureChange,
} from "@axonometric/contracts";
import { NodeHttpClient, NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import {
  Array as Arr,
  Effect,
  Option,
  Path,
  Record as Rec,
  Schema,
  String as Str,
} from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";

import { fullMap } from "./fixtures.ts";
import { makeHome, runCli, startServe } from "./harness.ts";

// Seam 1: a group and a chapter change through the review loop. The review
// map has engineer, page, server, proposals, pull-request and upstream, in
// groups people, loop and outside, and three chapters: c-page reveals
// engineer and page, c-save reveals server and proposals, and c-all reveals
// the rest.

const at = "2026-11-01T09:00:00.000Z";

const newGroup: GroupChange = {
  action: "add",
  group: { id: "data-1", title: "Data layer" },
};

const intoGroup = (structure: string): StructureChange => ({
  action: "group",
  structure,
  group: "data-1",
});

const groupItem = (id: string, change: GroupChange): BatchItem => ({
  id,
  kind: "group",
  change,
});

const structureItem = (id: string, change: StructureChange): BatchItem => ({
  id,
  kind: "structure",
  change,
});

const chapterItem = (id: string, change: ChapterChange): BatchItem => ({
  id,
  kind: "chapter",
  change,
});

const fileOf = (proposals: Proposals) =>
  `${JSON.stringify(proposals, null, 2)}\n`;

const batchOf = (items: readonly BatchItem[]): Batch => ({
  number: 1,
  frozenAt: at,
  items,
  verdicts: {},
  structures: [
    "engineer",
    "page",
    "server",
    "proposals",
    "pull-request",
    "upstream",
  ],
  groups: ["people", "loop", "outside"],
});

const homeWith = (
  items: readonly BatchItem[],
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
        batches: [batchOf(items)],
      }),
    });

    return { root, home: path.join(root, "review", "map") };
  }).pipe(Effect.provide(NodeServices.layer));

/**
 * data.mjs with a group `id` added, and the structures `members` put in it.
 * The map's `structure(...)` helper gives every structure the group "loop"
 * unless its entry sets another, so a member's entry gets a `group` field.
 */
const withGroup =
  (id: string, members: readonly string[]) =>
  (data: string): string =>
    Arr.reduce(
      members,
      Str.replace(
        "  groups: [\n",
        `  groups: [\n    { id: ${JSON.stringify(id)}, title: "Data layer" },\n`
      )(data),
      (so, member) =>
        Str.replace(
          `id: ${JSON.stringify(member)},`,
          `id: ${JSON.stringify(member)},\n      group: ${JSON.stringify(id)},`
        )(so)
    );

const decodeLayout = Schema.decodeUnknownEffect(LayoutFile);

const decodeProposals = Schema.decodeUnknownEffect(ProposalsFile);

const decodeRevision = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Revision)
);

const decodeFrozen = Schema.decodeUnknownEffect(
  Schema.fromJsonString(FreezeAnswer)
);

const decodeReview = Schema.decodeUnknownEffect(
  Schema.fromJsonString(ReviewReport)
);

/** A batch the agent has rejected and committed, so its items can be edited again. */
const rejectedHome = (items: readonly BatchItem[]) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const files = yield* fullMap;

    const reasons = Rec.fromEntries(
      Arr.map(items, ({ id }) => [
        id,
        { verdict: "rejected", reason: "No." } as const,
      ])
    );

    const root = yield* makeHome({
      ...files,
      "review/map/proposals.json": fileOf({
        format: 1,
        revision: 4,
        layout: [],
        batches: [
          {
            ...batchOf(items),
            verdicts: reasons,
            committed: { revision: 1, at },
          },
        ],
      }),
    });

    return { root, home: path.join(root, "review", "map") };
  }).pipe(Effect.provide(NodeServices.layer));

/** A write the page could send: a JSON object of known fields. */
type Write = Readonly<Record<string, Schema.Json>>;

const post = (url: string, path: string, body: Write) => {
  const request = HttpClientRequest.post(new URL(path, url)).pipe(
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

describe("a group made from two structures, through freeze, verdict and commit", () => {
  const items = [
    groupItem("g1", newGroup),
    structureItem("s1", intoGroup("server")),
    structureItem("s2", intoGroup("proposals")),
  ];

  it.effect(
    "accepts --as with a deliberate build between the agent's edit and verdict",
    () =>
      Effect.gen(function* () {
        const { home } = yield* homeWith(
          items,
          withGroup("data-layer", ["server", "proposals"])
        );

        // The rebuild a serve watcher runs when the agent saves data.mjs.
        const built = yield* runCli(home, ["build", home]);

        assert.strictEqual(built.exitCode, 0, built.stderr);

        const reviewed = yield* runCli(home, ["review", home, "--json"]);
        const report = yield* decodeReview(reviewed.stdout);

        assert.deepStrictEqual(
          Arr.map(report.batch?.items ?? [], ({ id, section }) => [
            id,
            section,
          ]),
          [
            ["g1", "diagram"],
            ["s1", "diagram"],
            ["s2", "diagram"],
          ]
        );

        const group = yield* runCli(home, [
          "verdict",
          home,
          "g1",
          "changed",
          "--reason",
          "Called it data-layer.",
          "--as",
          "data-layer",
        ]);

        assert.strictEqual(group.exitCode, 0, group.stderr);
        assert.include(group.stdout, "changed on g1 as data-layer");

        for (const id of ["s1", "s2"]) {
          const done = yield* runCli(home, ["verdict", home, id, "accepted"]);

          assert.strictEqual(done.exitCode, 0, done.stderr);
        }

        const committed = yield* runCli(home, ["commit", home]);

        assert.strictEqual(committed.exitCode, 0, committed.stderr);

        const revision = yield* decodeRevision(
          committed.files["history/0001.json"] ?? ""
        );

        assert.isTrue(
          Arr.some(revision.data.groups, ({ id }) => id === "data-layer")
        );

        const moved = Arr.filter(
          revision.accepted,
          (entry) => entry.kind === "structure"
        );

        // The structure items follow the group's final id.
        assert.deepStrictEqual(
          Arr.map(moved, (entry) =>
            entry.kind === "structure" && entry.change.action === "group"
              ? entry.change.group
              : ""
          ),
          ["data-layer", "data-layer"]
        );

        const added = Arr.findFirst(
          revision.accepted,
          ({ kind }) => kind === "group"
        );

        assert.isTrue(Option.isSome(added));
        assert.strictEqual(
          Option.match(added, {
            onNone: () => "",
            onSome: (entry) =>
              entry.kind === "group" && entry.as !== undefined ? entry.as : "",
          }),
          "data-layer"
        );

        const proposals = yield* decodeProposals(
          committed.files["proposals.json"] ?? ""
        );

        const verdict = proposals.batches?.[0]?.verdicts.g1;

        assert.strictEqual(
          verdict?.verdict === "changed" ? verdict.as : "",
          "data-layer"
        );
      })
  );

  it.effect("refuses to commit while data.mjs lacks the group", () =>
    Effect.gen(function* () {
      const { home } = yield* homeWith(items);

      for (const id of ["g1", "s1", "s2"]) {
        yield* runCli(home, ["verdict", home, id, "accepted"]);
      }

      const committed = yield* runCli(home, ["commit", home]);

      assert.strictEqual(committed.exitCode, 1);
      assert.include(committed.stderr, "data.mjs has no group");
    })
  );

  it.effect(
    "refuses --as on a group when the accepted map already has it",
    () =>
      Effect.gen(function* () {
        const { home } = yield* homeWith(items);

        const refused = yield* runCli(home, [
          "verdict",
          home,
          "g1",
          "changed",
          "--reason",
          "No.",
          "--as",
          "loop",
        ]);

        assert.strictEqual(refused.exitCode, 1);
        assert.include(refused.stderr, "already has");
      })
  );

  it.effect("lists the items under a Diagram changes heading in review", () =>
    Effect.gen(function* () {
      const { home } = yield* homeWith(items);
      const text = yield* runCli(home, ["review", home]);

      assert.include(text.stdout, "Diagram changes:");
      assert.notInclude(text.stdout, "Chapter changes:");
      assert.include(text.stdout, "add group");
    })
  );
});

describe("a chapter change through review", () => {
  const unrevealedPlay = chapterItem("c1", {
    action: "play",
    chapter: "c-page",
    hop: "h-store",
  });

  it.effect(
    "flags a chapter that plays a hop whose structures it hasn't revealed",
    () =>
      Effect.gen(function* () {
        // h-store runs from server to proposals, which c-save reveals.
        const { home } = yield* homeWith([unrevealedPlay]);
        const reviewed = yield* runCli(home, ["review", home, "--json"]);
        const report = yield* decodeReview(reviewed.stdout);
        const [first] = report.batch?.items ?? [];

        assert.strictEqual(first?.section, "chapter");
        assert.include(first?.breaks ?? "", "write batch");
        assert.include(first?.breaks ?? "", "h-store");
        assert.include(first?.breaks ?? "", "Save server");
        assert.include(first?.breaks ?? "", "Proposals");

        const text = yield* runCli(home, ["review", home]);

        assert.include(text.stdout, "BREAKS THE MAP if accepted:");
        assert.include(text.stdout, "Chapter changes:");
      })
  );

  it.effect("does not flag a hop the chapter's own reveal covers", () =>
    Effect.gen(function* () {
      const { home } = yield* homeWith([
        unrevealedPlay,
        chapterItem("c2", {
          action: "reveal",
          chapter: "c-page",
          structure: "server",
        }),
        chapterItem("c3", {
          action: "reveal",
          chapter: "c-page",
          structure: "proposals",
        }),
      ]);

      const reviewed = yield* runCli(home, ["review", home, "--json"]);
      const report = yield* decodeReview(reviewed.stdout);

      assert.deepStrictEqual(
        Arr.map(report.batch?.items ?? [], ({ breaks }) => breaks),
        [null, null, null]
      );
    })
  );

  it.effect(
    "gives a revision item once the agent has made the change in data.mjs",
    () =>
      Effect.gen(function* () {
        const reveal = chapterItem("c1", {
          action: "reveal",
          chapter: "c-page",
          structure: "server",
        });

        const { home } = yield* homeWith([reveal], (data) =>
          Str.replace(
            'reveals: ["engineer", "page"],',
            'reveals: ["engineer", "page", "server"],'
          )(
            Str.replace(
              'reveals: ["server", "proposals"],',
              'reveals: ["proposals"],'
            )(data)
          )
        );

        const verdict = yield* runCli(home, [
          "verdict",
          home,
          "c1",
          "accepted",
        ]);

        assert.strictEqual(verdict.exitCode, 0, verdict.stderr);

        const committed = yield* runCli(home, ["commit", home]);

        assert.strictEqual(committed.exitCode, 0, committed.stderr);

        const revision = yield* decodeRevision(
          committed.files["history/0001.json"] ?? ""
        );

        assert.deepStrictEqual(
          Arr.map(revision.accepted, ({ kind, id }) => [kind, id]),
          [["chapter", "c1"]]
        );

        const first = Arr.head(revision.data.chapters);

        assert.deepStrictEqual(
          Option.map(first, ({ reveals }) => reveals),
          Option.some(["engineer", "page", "server"])
        );
      })
  );

  it.effect("refuses to commit an accepted change data.mjs doesn't hold", () =>
    Effect.gen(function* () {
      const { home } = yield* homeWith([
        chapterItem("c1", {
          action: "reveal",
          chapter: "c-page",
          structure: "server",
        }),
      ]);

      yield* runCli(home, ["verdict", home, "c1", "accepted"]);

      const committed = yield* runCli(home, ["commit", home]);

      assert.strictEqual(committed.exitCode, 1);
      assert.include(committed.stderr, "does not yet have");
    })
  );

  it.effect("refuses --as on a chapter item", () =>
    Effect.gen(function* () {
      const { home } = yield* homeWith([unrevealedPlay]);

      const refused = yield* runCli(home, [
        "verdict",
        home,
        "c1",
        "changed",
        "--reason",
        "No.",
        "--as",
        "x",
      ]);

      assert.strictEqual(refused.exitCode, 1);
      assert.include(refused.stderr, "--as");
    })
  );
});

describe("group and chapter writes over HTTP", () => {
  it.live(
    "creates a group with its members in one write, and lists the sections apart in the prompt",
    () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const root = yield* makeHome(yield* fullMap);
        const home = path.join(root, "review", "map");
        const serve = yield* startServe(home, ["--port", "0"]);

        const made = yield* post(serve.url, "/api/groups", {
          baseFileRevision: 0,
          id: "g1",
          change: newGroup,
          members: [
            { id: "s1", structure: "server" },
            { id: "s2", structure: "proposals" },
          ],
        });

        assert.strictEqual(made.status, 200, made.text);

        const proposals = yield* decodeProposals(made.text);

        assert.deepStrictEqual(
          Arr.map(proposals.structures ?? [], ({ id }) => id),
          ["s1", "s2"]
        );
        assert.deepStrictEqual(
          Arr.map(proposals.groups ?? [], ({ id }) => id),
          ["g1"]
        );

        const chapter = yield* post(serve.url, "/api/chapters", {
          baseFileRevision: proposals.revision,
          id: "c1",
          change: {
            action: "reveal",
            chapter: "c-page",
            structure: "server",
          },
        });

        assert.strictEqual(chapter.status, 200, chapter.text);

        const frozen = yield* post(serve.url, "/api/review/freeze", {
          baseFileRevision: (yield* decodeProposals(chapter.text)).revision,
        });

        assert.strictEqual(frozen.status, 200, frozen.text);

        const { prompt } = yield* decodeFrozen(frozen.text);
        const lines = Str.split("\n")(prompt);
        const diagram = lines.indexOf("Diagram changes:");
        const chapters = lines.indexOf("Chapter changes:");

        assert.isAbove(diagram, -1);
        assert.isAbove(chapters, diagram);
        assert.include(
          Arr.join(lines.slice(diagram, chapters), "\n"),
          "add group g1"
        );
        assert.include(
          Arr.join(lines.slice(chapters), "\n"),
          'reveal c1: "Save server" (server) in chapter "The page" (c-page)'
        );
      }).pipe(Effect.provide(NodeServices.layer))
  );

  it.live(
    "refuses a group with a title another group has, or a rename of nothing",
    () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const root = yield* makeHome(yield* fullMap);
        const home = path.join(root, "review", "map");
        const serve = yield* startServe(home, ["--port", "0"]);

        const same = yield* post(serve.url, "/api/groups", {
          baseFileRevision: 0,
          id: "g1",
          change: { action: "add", group: { id: "again", title: "the loop" } },
        });

        assert.strictEqual(same.status, 422, same.text);
        assert.include(same.text, "already has a group called");

        const nothing = yield* post(serve.url, "/api/groups", {
          baseFileRevision: 0,
          id: "g2",
          change: { action: "rename", group: "nope", title: "Nope" },
        });

        assert.strictEqual(nothing.status, 422, nothing.text);

        const lost = yield* post(serve.url, "/api/chapters", {
          baseFileRevision: 0,
          id: "c1",
          change: { action: "play", chapter: "c-page", hop: "nope" },
        });

        assert.strictEqual(lost.status, 422, lost.text);
      }).pipe(Effect.provide(NodeServices.layer))
  );

  it.live("guards a frozen group and chapter change", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const root = yield* makeHome(yield* fullMap);
      const home = path.join(root, "review", "map");
      const serve = yield* startServe(home, ["--port", "0"]);

      yield* post(serve.url, "/api/groups", {
        baseFileRevision: 0,
        id: "g1",
        change: newGroup,
      });

      yield* post(serve.url, "/api/chapters", {
        baseFileRevision: 1,
        id: "c1",
        change: { action: "reveal", chapter: "c-page", structure: "server" },
      });

      yield* post(serve.url, "/api/review/freeze", { baseFileRevision: 2 });

      const group = yield* post(serve.url, "/api/groups", {
        baseFileRevision: 3,
        id: "g1",
        change: { action: "add", group: { id: "data-1", title: "Other" } },
      });

      assert.strictEqual(group.status, 422);
      assert.include(group.text, "waiting for the agent");

      const chapter = yield* post(serve.url, "/api/chapters", {
        baseFileRevision: 3,
        id: "c1",
        change: { action: "hide", chapter: "c-page", structure: "server" },
      });

      assert.strictEqual(chapter.status, 422);
      assert.include(chapter.text, "waiting for the agent");

      const discard = yield* post(serve.url, "/api/items/discard", {
        baseFileRevision: 3,
        id: "g1",
      });

      assert.strictEqual(discard.status, 422);
      assert.include(discard.text, "waiting for the agent");
    }).pipe(Effect.provide(NodeServices.layer))
  );
});

// The layout file is untouched by group and chapter items.
describe("a group or chapter commit leaves layout.json as it was", () => {
  it.effect("keeps every structure where it was", () =>
    Effect.gen(function* () {
      const { home } = yield* homeWith(
        [groupItem("g1", newGroup)],
        withGroup("data-1", [])
      );

      yield* runCli(home, ["verdict", home, "g1", "accepted"]);

      const committed = yield* runCli(home, ["commit", home]);

      assert.strictEqual(committed.exitCode, 0, committed.stderr);

      const layout = yield* decodeLayout(committed.files["layout.json"] ?? "");

      assert.deepStrictEqual(layout.structures.server, {
        x: 8,
        y: 0,
        w: 2,
        d: 2,
      });
    })
  );
});

const reopen = (
  url: string,
  id: string,
  extra: Write = {}
): ReturnType<typeof post> =>
  post(url, "/api/review/reopen", {
    baseFileRevision: 4,
    id,
    newId: `${id}-again`,
    ...extra,
  });

describe("editing a rejected group or chapter item again", () => {
  it.live("refuses a title with a line break, with the schema's words", () =>
    Effect.gen(function* () {
      const { home } = yield* rejectedHome([groupItem("g1", newGroup)]);
      const serve = yield* startServe(home, ["--port", "0"]);

      const bad = yield* reopen(serve.url, "g1", { text: "\u0085Data" });

      assert.strictEqual(bad.status, 422, bad.text);
      assert.include(bad.text, "on one line");

      const long = yield* reopen(serve.url, "g1", {
        text: Str.repeat(81)("x"),
      });

      assert.strictEqual(long.status, 422, long.text);

      const fine = yield* reopen(serve.url, "g1", { text: "Storage" });

      assert.strictEqual(fine.status, 200, fine.text);

      const held = yield* decodeProposals(fine.text);

      assert.deepStrictEqual(
        Arr.map(held.groups ?? [], ({ change }) =>
          change.action === "add" ? change.group.title : ""
        ),
        ["Storage"]
      );
    }).pipe(Effect.provide(NodeServices.layer))
  );

  it.live("refuses a title another group has, as a fresh proposal would", () =>
    Effect.gen(function* () {
      const { home } = yield* rejectedHome([groupItem("g1", newGroup)]);
      const serve = yield* startServe(home, ["--port", "0"]);

      const clash = yield* reopen(serve.url, "g1", { text: "the loop" });

      assert.strictEqual(clash.status, 422, clash.text);
      assert.include(clash.text, "already has a group called");
    }).pipe(Effect.provide(NodeServices.layer))
  );

  it.live("refuses a new group whose id the map has taken since", () =>
    Effect.gen(function* () {
      const { home } = yield* rejectedHome([
        groupItem("g1", {
          action: "add",
          group: { id: "loop", title: "Spare" },
        }),
      ]);

      const serve = yield* startServe(home, ["--port", "0"]);
      const taken = yield* reopen(serve.url, "g1");

      assert.strictEqual(taken.status, 422, taken.text);
      assert.include(taken.text, "already has a group with the id");
    }).pipe(Effect.provide(NodeServices.layer))
  );

  it.live("refuses text on a chapter item, which has none", () =>
    Effect.gen(function* () {
      const { home } = yield* rejectedHome([
        chapterItem("c1", {
          action: "reveal",
          chapter: "c-page",
          structure: "server",
        }),
      ]);

      const serve = yield* startServe(home, ["--port", "0"]);
      const bad = yield* reopen(serve.url, "c1", { text: "Hi" });

      assert.strictEqual(bad.status, 422, bad.text);
      assert.include(bad.text, "has no text to edit");
    }).pipe(Effect.provide(NodeServices.layer))
  );

  it.live(
    "refuses a chapter item that plays a hop its chapter hasn't revealed, judged with the items waiting",
    () =>
      Effect.gen(function* () {
        const play: BatchItem = chapterItem("c1", {
          action: "play",
          chapter: "c-page",
          hop: "h-store",
        });

        const { home } = yield* rejectedHome([play]);
        const serve = yield* startServe(home, ["--port", "0"]);
        const alone = yield* reopen(serve.url, "c1");

        assert.strictEqual(alone.status, 422, alone.text);
        assert.include(alone.text, "write batch");
      }).pipe(Effect.provide(NodeServices.layer))
  );

  it.live("refuses a structure name with a line break the same way", () =>
    Effect.gen(function* () {
      const { home } = yield* rejectedHome([
        structureItem("s1", {
          action: "rename",
          structure: "server",
          name: "Server",
        }),
      ]);

      const serve = yield* startServe(home, ["--port", "0"]);
      const bad = yield* reopen(serve.url, "s1", { text: "Server\u0085" });

      assert.strictEqual(bad.status, 422, bad.text);
      assert.include(bad.text, "on one line");
    }).pipe(Effect.provide(NodeServices.layer))
  );
});
