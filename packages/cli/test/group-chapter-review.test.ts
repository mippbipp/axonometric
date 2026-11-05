import {
  FreezeAnswer,
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
import { NodeServices } from "@effect/platform-node";
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

import { fullMap } from "./fixtures.ts";
import { makeHome, runCli, startServe } from "./harness.ts";
import { post as postText } from "./revisions.ts";

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

const post = (url: string, path: string, body: Write) =>
  postText(url, path, JSON.stringify(body));

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

        assert.strictEqual(made.status, 200, made.body);

        const proposals = yield* decodeProposals(made.body);

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

        assert.strictEqual(chapter.status, 200, chapter.body);

        const frozen = yield* post(serve.url, "/api/review/freeze", {
          baseFileRevision: (yield* decodeProposals(chapter.body)).revision,
        });

        assert.strictEqual(frozen.status, 200, frozen.body);

        const { prompt } = yield* decodeFrozen(frozen.body);
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
      assert.include(group.body, "waiting for the agent");

      const chapter = yield* post(serve.url, "/api/chapters", {
        baseFileRevision: 3,
        id: "c1",
        change: { action: "hide", chapter: "c-page", structure: "server" },
      });

      assert.strictEqual(chapter.status, 422);
      assert.include(chapter.body, "waiting for the agent");

      const discard = yield* post(serve.url, "/api/items/discard", {
        baseFileRevision: 3,
        id: "g1",
      });

      assert.strictEqual(discard.status, 422);
      assert.include(discard.body, "waiting for the agent");
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

      const before = yield* runCli(home, ["verdict", home, "g1", "accepted"]);
      const committed = yield* runCli(home, ["commit", home]);

      assert.strictEqual(before.exitCode, 0, before.stderr);
      assert.strictEqual(committed.exitCode, 0, committed.stderr);
      assert.strictEqual(
        committed.files["layout.json"],
        before.files["layout.json"]
      );
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
  it.live(
    "refuses a group title or a structure name with a line break, with the schema's words",
    () =>
      Effect.gen(function* () {
        const { home } = yield* rejectedHome([
          groupItem("g1", newGroup),
          structureItem("s1", {
            action: "rename",
            structure: "server",
            name: "Server",
          }),
        ]);

        const serve = yield* startServe(home, ["--port", "0"]);

        for (const [id, text] of [
          ["g1", "\u0085Data"],
          ["s1", "Server\u0085"],
        ] as const) {
          const bad = yield* reopen(serve.url, id, { text });

          assert.strictEqual(bad.status, 422, `${id}: ${bad.body}`);
          assert.include(bad.body, "on one line", id);
        }

        const long = yield* reopen(serve.url, "g1", {
          text: Str.repeat(81)("x"),
        });

        assert.strictEqual(long.status, 422, long.body);

        const fine = yield* reopen(serve.url, "g1", { text: "Storage" });

        assert.strictEqual(fine.status, 200, fine.body);

        const held = yield* decodeProposals(fine.body);

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

      assert.strictEqual(clash.status, 422, clash.body);
      assert.include(clash.body, "already has a group called");
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

      assert.strictEqual(taken.status, 422, taken.body);
      assert.include(taken.body, "already has a group with the id");
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

      assert.strictEqual(bad.status, 422, bad.body);
      assert.include(bad.body, "has no text to edit");
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

        assert.strictEqual(alone.status, 422, alone.body);
        assert.include(alone.body, "write batch");
      }).pipe(Effect.provide(NodeServices.layer))
  );
});
