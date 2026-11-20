import {
  Chapter,
  Decision,
  DeepDive,
  Flow,
  Group,
  Hop,
  MapData,
  OpenQuestion,
  Overview,
  ProposalsFile,
  ResolvedQuestion,
  Source,
  Stat,
  Step,
  Structure,
} from "@axonometric/contracts";
import type {
  Batch,
  BatchItem,
  ChapterChange,
  FlowChange,
  GroupChange,
  HopChange,
  LayoutChange,
  Proposals,
  StructureChange,
} from "@axonometric/contracts";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import {
  Array as Arr,
  Effect,
  FileSystem,
  Option,
  Order,
  Path,
  Record as Rec,
  Schema,
  String as Str,
} from "effect";

import {
  codeWordsIn,
  fieldListsIn,
  flagsIn,
  flagTokensIn,
  groupOf,
  listedTopics,
  subcommandsIn,
} from "./docs-text.ts";
import { fullMap } from "./fixtures.ts";
import { makeHome, runCli, startServe, mapKeys, mapIn } from "./harness.ts";

// The docs the CLI prints are checked against the CLI itself: every command
// they show runs as written against the review fixture, so a renamed flag or
// command fails here. Seam 1, the CLI on a temporary home folder.

/** The topics the overview must list: the five the ticket names, and data. */
const requiredTopics = [
  "process",
  "data",
  "chapters",
  "design",
  "review",
  "visual-check",
] as const;

/** Fields the schema rejects in data.mjs, which the docs mention only in passing. */
const rejectedFields = ["ghost", "x", "y", "w", "d", "h", "gx", "gy"];

/**
 * Words the glossary says to avoid for one term that are ordinary words, or
 * field names, in another use: a hop's label, a source's path and commit, the
 * `group` field, "step" in "this step", a reply to a request, and so on.
 * ghost stays in the docs only to say that status replaced it.
 */
const ordinaryWords = [
  "label",
  "link",
  "path",
  "edge",
  "commit",
  "pin",
  "position",
  "decision",
  "reply",
  "version",
  "comment",
  "step",
  "group",
  "port",
  "kind",
  "focus",
  "draft",
  "resolution",
  "type",
  "verdict",
  "depth",
  "highlight",
  "ghost",
];

const at = "2026-11-01T09:00:00.000Z";

/** A structure the page proposed, waiting in batch 1 with a verdict. */
const proposed: BatchItem = {
  change: {
    action: "add",
    at: { d: 2, w: 2, x: 12, y: 12 },
    structure: {
      group: "loop",
      id: "new-1",
      name: "Build cache",
      shape: "store",
      status: "planned",
    },
  },
  id: "p1",
  kind: "structure",
};

const batch: Batch = {
  frozenAt: at,
  items: [proposed],
  number: 1,
  // commit refuses an item with no verdict, and verdict records over it.
  verdicts: { p1: { reason: "Not needed yet.", verdict: "rejected" } },
};

const proposals: Proposals = {
  batches: [batch],
  format: 1,
  layout: [],
  notes: [],
  revision: 4,
};

const encodeProposals = Schema.encodeEffect(ProposalsFile);

/** One item for each value of `K`, keyed by it, so a new one won't compile until it's here. */
type EveryOf<K extends string, A> = Readonly<Record<K, A>>;

const structureChanges: EveryOf<StructureChange["action"], StructureChange> = {
  add: {
    action: "add",
    at: { d: 2, w: 2, x: 12, y: 12 },
    structure: {
      group: "loop",
      id: "new-1",
      name: "Build cache",
      shape: "store",
      status: "planned",
    },
  },
  delete: { action: "delete", structure: "upstream" },
  group: { action: "group", group: "people", structure: "page" },
  rename: { action: "rename", name: "Pager", structure: "page" },
  shape: { action: "shape", shape: "slab", structure: "page" },
  status: { action: "status", status: "planned", structure: "page" },
};

const hopChanges: EveryOf<HopChange["action"], HopChange> = {
  add: {
    action: "add",
    hop: { from: "engineer", id: "new-hop", label: "asks", to: "server" },
  },
  delete: { action: "delete", hop: "h-pr" },
  relabel: { action: "relabel", hop: "h-note", label: "pins" },
};

const flowChanges: EveryOf<FlowChange["action"], FlowChange> = {
  add: {
    action: "add",
    flow: { id: "new-flow", name: "Round trip" },
    hops: ["h-note"],
  },
  hops: { action: "hops", flow: "f-note", hops: ["h-note"] },
  rename: { action: "rename", flow: "f-note", name: "Notes" },
  reorder: { action: "reorder", flows: ["f-note"] },
};

const groupChanges: EveryOf<GroupChange["action"], GroupChange> = {
  add: { action: "add", group: { id: "data-1", title: "Data" } },
  rename: { action: "rename", group: "outside", title: "Elsewhere" },
};

const chapterChanges: EveryOf<ChapterChange["action"], ChapterChange> = {
  hide: { action: "hide", chapter: "c-all", structure: "upstream" },
  order: {
    action: "order",
    chapter: "c-save",
    plays: ["h-store", "h-save", "h-note"],
  },
  play: { action: "play", chapter: "c-save", hop: "h-pr" },
  reveal: { action: "reveal", chapter: "c-page", structure: "server" },
  unplay: { action: "unplay", chapter: "c-page", hop: "h-note" },
};

const layoutChanges: EveryOf<LayoutChange["kind"], LayoutChange> = {
  move: {
    id: "x-move",
    kind: "move",
    moves: [
      {
        position: { x: 0, y: 4 },
        target: { id: "engineer", kind: "structure" },
      },
    ],
  },
  reroute: {
    id: "x-reroute",
    kind: "reroute",
    points: null,
    target: { id: "h-store", kind: "hop" },
  },
  resize: {
    footprint: { d: 2, w: 3 },
    id: "x-resize",
    kind: "resize",
    target: { id: "page", kind: "structure" },
  },
};

/** `items`, which must hold every kind of item; a missing kind won't compile. */
const satisfiesEveryKind = <const I extends ReadonlyArray<BatchItem>>(
  items: I &
    ([BatchItem["kind"]] extends [I[number]["kind"]]
      ? unknown
      : "a kind of item is missing")
): ReadonlyArray<BatchItem> => items;

const itemsOf = <A>(
  kind: string,
  changes: Readonly<Record<string, A>>,
  item: (id: string, change: A) => BatchItem
) =>
  Arr.map(Rec.toEntries(changes), ([action, change]) =>
    item(`x-${kind}-${action}`, change)
  );

/** A batch holding one item of every kind, and of every action each has. */
const everyKind: Proposals = {
  batches: [
    {
      frozenAt: at,
      items: satisfiesEveryKind([
        ...Arr.map(Rec.values(layoutChanges), (change): BatchItem => ({
          change,
          id: change.id,
          kind: "layout",
        })),
        {
          id: "x-note",
          kind: "note",
          target: { id: "server", kind: "structure" },
          text: "Why?",
        },
        {
          after: "Shows the map.",
          before: "Shows the map and records notes.",
          field: "oneLiner",
          id: "x-suggestion",
          kind: "suggestion",
          target: { id: "page", kind: "structure" },
        },
        {
          answeredOn: "2026-11-02",
          id: "x-answer",
          kind: "answer",
          question: "Q-P1",
          target: { id: "page", kind: "structure" },
          text: "Yes.",
        },
        {
          id: "x-question",
          kind: "question",
          target: { id: "server", kind: "structure" },
          text: "Does it retry?",
        },
        ...itemsOf("structure", structureChanges, (id, change) => ({
          change,
          id,
          kind: "structure",
        })),
        ...itemsOf("hop", hopChanges, (id, change) => ({
          change,
          id,
          kind: "hop",
        })),
        ...itemsOf("flow", flowChanges, (id, change) => ({
          change,
          id,
          kind: "flow",
        })),
        ...itemsOf("group", groupChanges, (id, change) => ({
          change,
          id,
          kind: "group",
        })),
        ...itemsOf("chapter", chapterChanges, (id, change) => ({
          change,
          id,
          kind: "chapter",
        })),
      ]),
      number: 1,
      verdicts: {},
    },
  ],
  format: 1,
  layout: [],
  revision: 4,
};

/** The review fixture with a batch waiting, and its home folder. */
const reviewHome = Effect.gen(function* () {
  const root = yield* makeHome({
    ...(yield* fullMap),
    [mapKeys("review").proposalsFile]: yield* encodeProposals(proposals),
  });

  return { home: mapIn(root, "review").home, root };
}).pipe(Effect.provide(NodeServices.layer));

/** What `axonometric docs [topic]` prints, asserting that it succeeds. */
export const printed = Effect.fnUntraced(function* (topic?: string) {
  const home = yield* makeHome({});
  const result = yield* runCli(home, ["docs", ...Arr.fromNullishOr(topic)]);

  assert.strictEqual(result.exitCode, 0, result.stderr);
  assert.strictEqual(result.stderr, "");

  return result.stdout;
});

/** The overview and every topic it lists, keyed by name. */
export const allDocs = Effect.gen(function* () {
  const overview = yield* printed();
  const topics = listedTopics(overview);
  const texts = yield* Effect.forEach(topics, printed, { concurrency: 1 });

  return {
    overview,
    texts: Rec.fromEntries([
      ["overview", overview] as const,
      ...Arr.zip(topics, texts),
    ]),
    topics,
  };
});

/**
 * The commands in a topic's fenced `sh` blocks. Every line in such a block is
 * a command, so a stray non-axonometric line fails the test instead of going
 * unchecked.
 */
const commandsIn = (text: string): ReadonlyArray<string> =>
  Arr.flatMap(
    Arr.fromIterable(Str.matchAll(/```sh\n(?<block>[\s\S]*?)```/gu)(text)),
    (found) => {
      const block = groupOf(found, "block");

      const lines = Arr.filter(
        Arr.map(Str.split("\n")(block), Str.trim),
        Str.isNonEmpty
      );

      for (const line of lines) {
        assert.isTrue(
          Str.startsWith("axonometric ")(line),
          `A sh block holds a line that isn't an axonometric command: ${line}`
        );
      }

      return lines;
    }
  );

/** Splits a command line into words, keeping "quoted text" together. */
const wordsOf = (line: string) =>
  Arr.map(
    Arr.fromIterable(Str.matchAll(/"(?<quoted>[^"]*)"|(?<bare>\S+)/gu)(line)),
    (found) => groupOf(found, "quoted") || groupOf(found, "bare")
  );

/** The terms an `_Avoid_:` line of the glossary lists. */
const termsOf = (line: string) => {
  const list = Str.replaceAll(/\(.*?\)/gu, "")(Str.slice(9)(line));

  return Arr.map(Str.split(", ")(list), (term) =>
    Str.toLowerCase(Str.trim(term))
  );
};

describe("axonometric docs", () => {
  it.effect("lists the topics, and each one prints", () =>
    Effect.gen(function* () {
      const overview = yield* printed();
      const listed = listedTopics(overview);

      for (const topic of requiredTopics) {
        assert.include(listed, topic);
      }

      for (const topic of listed) {
        const text = yield* printed(topic);

        assert.isAbove(text.length, 200, `docs ${topic} is nearly empty`);
      }
    })
  );

  it.effect("an unknown topic fails and lists the valid ones", () =>
    Effect.gen(function* () {
      const home = yield* makeHome({});
      const result = yield* runCli(home, ["docs", "nonsense"]);

      assert.strictEqual(result.exitCode, 1);
      assert.include(
        result.stderr,
        'Invalid value for argument <topic>: "nonsense"'
      );

      for (const topic of requiredTopics) {
        assert.include(result.stderr, `"${topic}"`);
      }
    })
  );

  it.effect("names every subcommand the CLI has", () =>
    Effect.gen(function* () {
      const home = yield* makeHome({});
      const help = yield* runCli(home, ["--help"]);
      const overview = yield* printed();
      const listed = listedTopics(overview);

      const texts = yield* Effect.forEach([undefined, ...listed], printed, {
        concurrency: 1,
      });

      const everything = Arr.join(texts, "\n");

      const subcommands = subcommandsIn(help.stdout);

      assert.isAbove(subcommands.length, 9);

      for (const name of subcommands) {
        assert.include(
          everything,
          `axonometric ${name}`,
          `The docs never show axonometric ${name}`
        );
      }
    })
  );

  it.effect("every command in the prose names a real subcommand", () =>
    Effect.gen(function* () {
      const home = yield* makeHome({});
      const help = yield* runCli(home, ["--help"]);
      const printedHelp = yield* printed();
      const listed = listedTopics(printedHelp);

      const texts = yield* Effect.forEach([undefined, ...listed], printed, {
        concurrency: 1,
      });

      const known = new Set(subcommandsIn(help.stdout));

      const inline = Arr.flatMap(texts, (text) =>
        Arr.map(
          Arr.fromIterable(
            Str.matchAll(/`axonometric (?<name>[a-z][\w-]*)/gu)(text)
          ),
          (found) => groupOf(found, "name")
        )
      );

      assert.isAbove(inline.length, 10);

      for (const name of inline) {
        assert.isTrue(known.has(name), `The docs show axonometric ${name}`);
      }
    })
  );

  it.live("every command the docs show runs as written", () =>
    Effect.gen(function* () {
      const overview = yield* printed();
      const topics = listedTopics(overview);
      const shown: Array<string> = [];

      for (const topic of topics) {
        const printedTopic = yield* printed(topic);

        for (const line of commandsIn(printedTopic)) {
          const { home, root } = yield* reviewHome;
          const path = yield* Path.Path;
          const fresh = mapIn(root, "fresh").home;

          const substitutions = {
            "<home>": Str.startsWith("axonometric init ")(line) ? fresh : home,
            "<item>": "p1",
            "<structure>": "page",
          } satisfies Record<string, string>;

          // `export` writes relative to the test's working directory, so
          // its example output paths go into the temporary folder.
          const args = Arr.map(wordsOf(line).slice(1), (word) => {
            const filled = Rec.reduce(
              substitutions,
              word,
              (text, value, placeholder) =>
                Str.replaceAll(placeholder, value)(text)
            );

            return Str.startsWith("out/")(filled)
              ? path.join(root, filled)
              : filled;
          });

          const joined = Arr.join(args, " ");
          const context = `axonometric ${joined}`;

          assert.isFalse(
            /<[a-z-]+>/u.test(Str.replace(root, "")(joined)),
            `${line} has a placeholder this test doesn't fill`
          );

          // serve runs until Ctrl-C, so it starts for real and stops again.
          if (args[0] === "serve") {
            const running = yield* startServe(
              home,
              Arr.appendAll(
                Arr.drop(args, 2),
                args.includes("--port") ? [] : ["--port", "0"]
              )
            );

            const status = yield* runCli(home, ["status", home, "--json"]);

            assert.include(status.stdout, running.url, line);
            yield* running.stop;
          } else {
            const result = yield* runCli(home, args);

            assert.strictEqual(
              result.exitCode,
              0,
              `${line} exited ${result.exitCode}.\n${result.stdout}${result.stderr}`
            );
            assert.notInclude(result.stderr, "Unrecognized flag", context);
            assert.notInclude(result.stderr, "Unknown subcommand", context);
          }

          shown.push(line);
        }
      }

      // The loop above must actually have run the review loop and the rest.
      for (const name of [
        "init",
        "build",
        "check",
        "layout",
        "export",
        "serve",
        "status",
        "review",
        "verdict",
        "commit",
      ]) {
        assert.isTrue(
          Arr.some(shown, Str.startsWith(`axonometric ${name} `)),
          `The fenced blocks never run axonometric ${name}`
        );
      }
    }).pipe(Effect.provide(NodeServices.layer))
  );

  it.effect("every --flag in the docs is a flag the CLI has", () =>
    Effect.gen(function* () {
      const home = yield* makeHome({});
      const root = yield* runCli(home, ["--help"]);
      const { texts } = yield* allDocs;

      const helps = yield* Effect.forEach(
        subcommandsIn(root.stdout),
        (name) => runCli(home, [name, "--help"]),
        { concurrency: 1 }
      );

      const known = new Set(
        Arr.flatMap([root, ...helps], ({ stdout }) => flagsIn(stdout))
      );

      assert.isAbove(known.size, 15);

      for (const [topic, text] of Rec.toEntries(texts)) {
        for (const flag of flagTokensIn(text)) {
          assert.isTrue(known.has(flag), `docs ${topic} shows ${flag}`);
        }
      }
    })
  );

  it.effect("data covers every field of every type the schema has", () =>
    Effect.gen(function* () {
      const { texts } = yield* allDocs;
      const data = texts.data ?? "";
      const mentioned = codeWordsIn(data);

      const types = {
        Chapter: Rec.keys(Chapter.fields),
        Decision: Rec.keys(Decision.fields),
        DeepDive: Rec.keys(DeepDive.fields),
        Flow: Rec.keys(Flow.fields),
        Group: Rec.keys(Group.fields),
        Hop: Rec.keys(Hop.fields),
        MapData: Rec.keys(MapData.fields),
        OpenQuestion: Rec.keys(OpenQuestion.fields),
        Overview: Rec.keys(Overview.fields),
        ResolvedQuestion: Rec.keys(ResolvedQuestion.fields),
        Source: Rec.keys(Source.fields),
        Stat: Rec.keys(Stat.fields),
        Step: Rec.keys(Step.fields),
        Structure: Rec.keys(Structure.fields),
      } satisfies Record<string, ReadonlyArray<string>>;

      for (const [name, fields] of Rec.toEntries(types)) {
        for (const field of fields) {
          if (!Arr.contains(rejectedFields, field)) {
            assert.isTrue(
              mentioned.has(field),
              `data never mentions ${name}.${field}`
            );
          }
        }
      }

      // Every `{ a, b }` list in the topic is one of those types, whole.
      const wholeTypes = Arr.map(Rec.values(types), (fields) =>
        Arr.join(Arr.sort(fields, Order.String), ",")
      );

      const lists = fieldListsIn(data);

      assert.isAbove(lists.length, 8);

      for (const list of lists) {
        const key = Arr.join(Arr.sort(list, Order.String), ",");

        assert.isTrue(
          Arr.contains(wholeTypes, key),
          `data lists { ${Arr.join(list, ", ")} }, which is no schema type's fields`
        );
      }

      // The structures table: its first column names real fields.
      const rows = Arr.flatMap(Str.split("\n")(data), (line) => {
        const name = groupOf(/^\| `(?<name>\w+)` \|/u.exec(line), "name");

        return name === "" ? [] : [name];
      });

      assert.isAbove(rows.length, 5);

      for (const name of rows) {
        assert.include(Rec.keys(Structure.fields), name);
      }
    })
  );

  it.effect("data says which overview fields are one string", () =>
    Effect.gen(function* () {
      const { texts } = yield* allDocs;
      const data = texts.data ?? "";

      for (const field of [
        "platformProvides",
        "weOwn",
        "fileLayout",
        "costModel",
      ]) {
        const line = Arr.findFirst(
          Str.split("\n")(data),
          (text) =>
            Str.startsWith("- `")(text) && Str.includes(`\`${field}\``)(text)
        );

        assert.isTrue(
          Option.isSome(line) && Str.includes("one string")(line.value),
          `data says ${field} is one string`
        );
      }
    })
  );

  it.effect("data and design say a tag only shortens the name", () =>
    Effect.gen(function* () {
      const { texts } = yield* allDocs;

      for (const topic of ["data", "design"]) {
        assert.match(
          texts[topic] ?? "",
          /shortened[^.]*`name`|`name`[^.]*shortened/u,
          `${topic} describes tag as a shortened name`
        );
        assert.include(texts[topic] ?? "", "howItsBuilt");
      }
    })
  );

  it.effect("every topic the docs point to exists", () =>
    Effect.gen(function* () {
      const { texts, topics } = yield* allDocs;
      let pointers = 0;

      for (const [topic, text] of Rec.toEntries(texts)) {
        for (const found of Str.matchAll(
          /(?:[Ss]ee|[Rr]ead|following|Finish with) `(?<named>[a-z-]+)`/gu
        )(text)) {
          pointers += 1;
          assert.include(
            topics,
            groupOf(found, "named"),
            `docs ${topic} points to ${groupOf(found, "named")}`
          );
        }
      }

      assert.isAbove(pointers, 5);
    })
  );

  it.effect("the README lists the topics the CLI has", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const { topics } = yield* allDocs;

      const readme = yield* fs.readFileString(
        path.join(import.meta.dirname, "..", "..", "..", "README.md")
      );

      const sentence = groupOf(
        /prints one: (?<list>[^.]*)\./u.exec(readme),
        "list"
      );

      assert.isNotEmpty(sentence);
      assert.sameMembers(
        [...codeWordsIn(sentence)],
        [...topics],
        "the README's topic list"
      );
    }).pipe(Effect.provide(NodeServices.layer))
  );

  it.effect("review says what to do for every kind of item", () =>
    Effect.gen(function* () {
      const { texts } = yield* allDocs;
      const review = texts.review ?? "";

      const home = yield* makeHome({
        ...(yield* fullMap),
        [mapKeys("review").proposalsFile]: yield* encodeProposals(everyKind),
      });

      const map = mapIn(home, "review").home;

      const result = yield* runCli(home, ["review", map]);

      assert.strictEqual(result.exitCode, 0, result.stderr);

      // review prints each item as `<id>  <kind>  <targets>`.
      const kinds = new Map(
        Arr.flatMap(Str.split("\n")(result.stdout), (line) => {
          const found = /^(?<id>\S+) {2}(?<kind>.+?) {2}/u.exec(line);

          return found === null
            ? []
            : [[groupOf(found, "id"), groupOf(found, "kind")] as const];
        })
      );

      assert.sameMembers(
        [...kinds.keys()],
        Arr.map(everyKind.batches?.[0]?.items ?? [], ({ id }) => id)
      );

      for (const [id, kind] of kinds) {
        assert.include(
          review,
          `\`${kind}\``,
          `review.md never names the item \`${kind}\` (${id})`
        );
      }
    })
  );

  it.effect("uses the glossary's terms, not the ones it says to avoid", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const { texts } = yield* allDocs;

      const glossary = yield* fs.readFileString(
        path.join(import.meta.dirname, "..", "..", "..", "GLOSSARY.md")
      );

      const avoided = Arr.filter(
        Arr.flatMap(Str.split("\n")(glossary), (line) =>
          Str.startsWith("_Avoid_: ")(line) ? termsOf(line) : []
        ),
        (term) => Str.isNonEmpty(term) && !Arr.contains(ordinaryWords, term)
      );

      assert.isAbove(avoided.length, 40);

      for (const [topic, text] of Rec.toEntries(texts)) {
        // design lists the words to avoid, as "- **map**, not atlas."
        const prose = Arr.filter(
          Str.split("\n")(text),
          (line) => !(topic === "design" && /^- \*\*.*, not /u.test(line))
        );

        for (const term of avoided) {
          const pattern = new RegExp(`(?<![\\w-])${term}(?![\\w-])`, "iu");

          for (const line of prose) {
            assert.isFalse(
              pattern.test(line),
              `docs ${topic} says "${term}", which GLOSSARY.md says to avoid: ${line}`
            );
          }
        }
      }
    }).pipe(Effect.provide(NodeServices.layer))
  );
});
