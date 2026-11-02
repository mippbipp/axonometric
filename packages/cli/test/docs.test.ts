import {
  Chapter,
  chapterActions,
  Decision,
  DeepDive,
  Flow,
  flowActions,
  Group,
  Hop,
  hopActions,
  kindTable,
  MapData,
  OpenQuestion,
  Overview,
  ProposalsFile,
  ResolvedQuestion,
  Source,
  Stat,
  Step,
  Structure,
  structureActions,
} from "@axonometric/contracts";
import type { Batch, BatchItem, Proposals } from "@axonometric/contracts";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import {
  Array as Arr,
  Effect,
  FileSystem,
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
import { makeHome, runCli, startServe } from "./harness.ts";

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
  id: "p1",
  kind: "structure",
  change: {
    action: "add",
    structure: {
      id: "new-1",
      name: "Build cache",
      shape: "store",
      group: "loop",
      status: "planned",
    },
    at: { x: 12, y: 12, w: 2, d: 2 },
  },
};

const batch: Batch = {
  number: 1,
  frozenAt: at,
  items: [proposed],
  // commit refuses an item with no verdict, and verdict records over it.
  verdicts: { p1: { verdict: "rejected", reason: "Not needed yet." } },
};

const proposals: Proposals = {
  format: 1,
  revision: 4,
  layout: [],
  notes: [],
  batches: [batch],
};

const encodeProposals = Schema.encodeEffect(ProposalsFile);

/** The review fixture with a batch waiting, and its home folder. */
const reviewHome = Effect.gen(function* () {
  const path = yield* Path.Path;

  const root = yield* makeHome({
    ...(yield* fullMap),
    "review/map/proposals.json": yield* encodeProposals(proposals),
  });

  return { root, home: path.join(root, "review", "map") };
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
  const texts = yield* Effect.forEach(topics, printed);

  return {
    overview,
    topics,
    texts: Rec.fromEntries([
      ["overview", overview] as const,
      ...Arr.zip(topics, texts),
    ]),
  };
});

/**
 * The commands in a topic's fenced `sh` blocks. Every line in such a block is
 * a command, so a stray non-axonometric line fails the test instead of going
 * unchecked.
 */
const commandsIn = (text: string): readonly string[] =>
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

      const texts = yield* Effect.forEach([undefined, ...listed], printed);
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
      const listed = listedTopics(yield* printed());
      const texts = yield* Effect.forEach([undefined, ...listed], printed);

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
      const shown: string[] = [];

      for (const topic of topics) {
        for (const line of commandsIn(yield* printed(topic))) {
          const { root, home } = yield* reviewHome;
          const path = yield* Path.Path;
          const fresh = path.join(root, "fresh", "map");

          const substitutions = {
            "<home>": Str.startsWith("axonometric init ")(line) ? fresh : home,
            "<structure>": "page",
            "<item>": "p1",
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

      const helps = yield* Effect.forEach(subcommandsIn(root.stdout), (name) =>
        runCli(home, [name, "--help"])
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
        MapData: Rec.keys(MapData.fields),
        Overview: Rec.keys(Overview.fields),
        Structure: Rec.keys(Structure.fields),
        Hop: Rec.keys(Hop.fields),
        Flow: Rec.keys(Flow.fields),
        Chapter: Rec.keys(Chapter.fields),
        Group: Rec.keys(Group.fields),
        Stat: Rec.keys(Stat.fields),
        Step: Rec.keys(Step.fields),
        Source: Rec.keys(Source.fields),
        Decision: Rec.keys(Decision.fields),
        DeepDive: Rec.keys(DeepDive.fields),
        OpenQuestion: Rec.keys(OpenQuestion.fields),
        ResolvedQuestion: Rec.keys(ResolvedQuestion.fields),
      } satisfies Record<string, readonly string[]>;

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

  it.effect("every topic the docs point to exists", () =>
    Effect.gen(function* () {
      const { topics, texts } = yield* allDocs;
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

      // The names `review` prints for each kind, from the contracts' tables.
      const names = {
        layout: ["move", "resize", "reroute"],
        note: ["note"],
        suggestion: ["suggestion"],
        answer: ["answer"],
        question: ["question"],
        structure: Arr.map(Rec.values(structureActions), ({ label }) => label),
        hop: Arr.map(Rec.values(hopActions), ({ label }) => label),
        flow: Arr.map(Rec.values(flowActions), ({ label }) => label),
        group: ["add group", "rename group"],
        chapter: Arr.map(Rec.values(chapterActions), ({ label }) => label),
      };

      // A new kind of item fails here until it is named above, and so
      // documented below.
      assert.sameMembers(Rec.keys(kindTable), Rec.keys(names));

      for (const [kind, labels] of Rec.toEntries(names)) {
        for (const label of labels) {
          assert.include(
            review,
            `\`${label}\``,
            `review.md never names the ${kind} item \`${label}\``
          );
        }
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
