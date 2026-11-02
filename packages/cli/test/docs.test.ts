import { ProposalsFile, Structure } from "@axonometric/contracts";
import type { Batch, BatchItem, Proposals } from "@axonometric/contracts";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import {
  Array as Arr,
  Effect,
  Path,
  Option,
  Record as Rec,
  Schema,
  String as Str,
} from "effect";

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

const printed = Effect.fnUntraced(function* (topic?: string) {
  const home = yield* makeHome({});
  const result = yield* runCli(home, ["docs", ...Arr.fromNullishOr(topic)]);

  assert.strictEqual(result.exitCode, 0, result.stderr);
  assert.strictEqual(result.stderr, "");

  return result.stdout;
});

/** The topics the overview lists, as `axonometric docs <topic>`. */
const listedTopics = (overview: string) =>
  Arr.map(
    Arr.fromIterable(
      Str.matchAll(/`axonometric docs (?<topic>[a-z-]+)`/gu)(overview)
    ),
    (found) => groupOf(found, "topic")
  );

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

/** The text a named group matched, or "" when the match or group is missing. */
const groupOf = (
  match: { readonly groups?: Record<string, string | undefined> } | null,
  name: string
): string =>
  Option.fromNullishOr(match?.groups).pipe(
    Option.flatMap((groups) => Rec.get(groups, name)),
    Option.flatMap(Option.fromNullishOr),
    Option.getOrElse(() => "")
  );

/** The subcommand names in `--help`'s SUBCOMMANDS list. */
const subcommandsIn = (help: string): readonly string[] =>
  Arr.flatMap(
    Arr.dropWhile(Str.split("\n")(help), (line) => line !== "SUBCOMMANDS"),
    (line: string) => {
      const name = groupOf(/^ {2}(?<name>\S+) {2,}/u.exec(line), "name");

      return name === "" ? [] : [name];
    }
  );

/** Splits a command line into words, keeping "quoted text" together. */
const wordsOf = (line: string) =>
  Arr.map(
    Arr.fromIterable(Str.matchAll(/"(?<quoted>[^"]*)"|(?<bare>\S+)/gu)(line)),
    (found) => groupOf(found, "quoted") || groupOf(found, "bare")
  );

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

  it.effect("data names every field the schema has, and no other", () =>
    Effect.gen(function* () {
      const text = yield* printed("data");

      const wanted = Arr.filter(
        Rec.keys(Structure.fields),
        (name) => !Arr.contains(rejectedFields, name)
      );

      for (const name of wanted) {
        assert.include(
          text,
          `\`${name}\``,
          `data never mentions structure.${name}`
        );
      }

      // The structures table: its first column names real fields.
      const rows = Arr.flatMap(Str.split("\n")(text), (line) => {
        const name = groupOf(/^\| `(?<name>\w+)` \|/u.exec(line), "name");

        return name === "" ? [] : [name];
      });

      assert.isAbove(rows.length, 5);

      for (const name of rows) {
        assert.include(Rec.keys(Structure.fields), name);
      }
    })
  );
});
