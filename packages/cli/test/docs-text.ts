import { Array as Arr, Option, Record as Rec, String as Str } from "effect";

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

/** The topics the overview lists, as `axonometric docs <topic>`. */
export const listedTopics = (overview: string) =>
  Arr.map(
    Arr.fromIterable(
      Str.matchAll(/`axonometric docs (?<topic>[a-z-]+)`/gu)(overview)
    ),
    (found) => groupOf(found, "topic")
  );

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
export const flagTokensIn = (text: string): readonly string[] => {
  const withoutGit = Str.replaceAll(/`git [^`]*`/gu, "")(text);
  const found = Str.matchAll(/(?<![\w-])(?<flag>--[a-z][a-z-]*)/gu)(withoutGit);

  return Arr.map(Arr.fromIterable(found), (match) => groupOf(match, "flag"));
};

/** The identifiers written inside backticks in `text`. */
const wordsIn = (code: string) =>
  Arr.map(
    Arr.fromIterable(Str.matchAll(/[A-Za-z][\w-]*/gu)(code)),
    ([word = ""]) => word
  );

export const codeWordsIn = (text: string): ReadonlySet<string> => {
  const spans = Arr.fromIterable(Str.matchAll(/`(?<code>[^`\n]+)`/gu)(text));

  return new Set(
    Arr.flatMap(spans, (found) => wordsIn(groupOf(found, "code")))
  );
};

/** The `{ a, b: "c" }` field lists in backticks, each as its field names. */
export const fieldListsIn = (text: string): readonly (readonly string[])[] =>
  Arr.map(
    Arr.fromIterable(Str.matchAll(/`\{ (?<fields>[^`}]+) \}`/gu)(text)),
    (found) =>
      Arr.map(Str.split(", ")(groupOf(found, "fields")), (field) =>
        Arr.headNonEmpty(Str.split(":")(field))
      )
  );
