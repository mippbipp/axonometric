import { assert } from "@effect/vitest";
import {
  Array as Arr,
  Effect,
  Option,
  Record as Rec,
  String as Str,
} from "effect";

import { makeHome, runCli } from "./harness.ts";

/** The text a named group matched, or "" when the match or group is missing. */
export const groupOf = (
  match: { readonly groups?: Record<string, string | undefined> } | null,
  name: string
): string =>
  Option.fromNullishOr(match?.groups).pipe(
    Option.flatMap((groups) => Rec.get(groups, name)),
    Option.flatMap(Option.fromNullishOr),
    Option.getOrElse(() => "")
  );

/** What `axonometric docs [topic]` prints, asserting that it succeeds. */
export const printed = Effect.fnUntraced(function* (topic?: string) {
  const home = yield* makeHome({});
  const result = yield* runCli(home, ["docs", ...Arr.fromNullishOr(topic)]);

  assert.strictEqual(result.exitCode, 0, result.stderr);
  assert.strictEqual(result.stderr, "");

  return result.stdout;
});

/** The topics the overview lists, as `axonometric docs <topic>`. */
export const listedTopics = (overview: string) =>
  Arr.map(
    Arr.fromIterable(
      Str.matchAll(/`axonometric docs (?<topic>[a-z-]+)`/gu)(overview)
    ),
    (found) => groupOf(found, "topic")
  );

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

/** The subcommand names in `--help`'s SUBCOMMANDS list. */
export const subcommandsIn = (help: string): readonly string[] =>
  Arr.flatMap(
    Arr.dropWhile(Str.split("\n")(help), (line) => line !== "SUBCOMMANDS"),
    (line: string) => {
      const name = groupOf(/^ {2}(?<name>\S+) {2,}/u.exec(line), "name");

      return name === "" ? [] : [name];
    }
  );

/** The `--flag` names a command's `--help` lists, its global flags included. */
export const flagsIn = (help: string): readonly string[] =>
  Arr.flatMap(Str.split("\n")(help), (line: string) => {
    const flag = groupOf(/^ {2}(?<flag>--[a-z][a-z-]*)/u.exec(line), "flag");

    return flag === "" ? [] : [flag];
  });

/** Every `--flag` token in `text`, leaving out the flags of git commands. */
export const flagTokensIn = (text: string): readonly string[] =>
  Arr.map(
    Arr.fromIterable(
      Str.matchAll(/(?<![\w-])(?<flag>--[a-z][a-z-]*)/gu)(
        Str.replaceAll(/`git [^`]*`/gu, "")(text)
      )
    ),
    (found) => groupOf(found, "flag")
  );

/** The identifiers written inside backticks in `text`. */
export const codeWordsIn = (text: string): ReadonlySet<string> =>
  new Set(
    Arr.flatMap(
      Arr.fromIterable(Str.matchAll(/`(?<code>[^`\n]+)`/gu)(text)),
      (found) =>
        Arr.map(
          Arr.fromIterable(
            Str.matchAll(/[A-Za-z][\w-]*/gu)(groupOf(found, "code"))
          ),
          ([word = ""]) => word
        )
    )
  );

/** The `{ a, b: "c" }` field lists in backticks, each as its field names. */
export const fieldListsIn = (text: string): readonly (readonly string[])[] =>
  Arr.map(
    Arr.fromIterable(Str.matchAll(/`\{ (?<fields>[^`}]+) \}`/gu)(text)),
    (found) =>
      Arr.map(Str.split(", ")(groupOf(found, "fields")), (field) =>
        Arr.headNonEmpty(Str.split(":")(field))
      )
  );
