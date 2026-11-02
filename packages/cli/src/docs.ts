import { Array as Arr, Console, Effect, Option, Record as Rec } from "effect";
import { Argument, Command } from "effect/cli";

import { docsContent } from "./docs-content.ts";
import { DocsNotFound } from "./docs-error.ts";

/** The topics, in the order the overview lists them, with what each covers. */
export const topics = {
  process: "Building a map: the steps, the home folder, and what to report",
  data: "Writing data.mjs: every field, and questions by ID",
  chapters: "The chapter recipe: how to split a system into a walkthrough",
  design: "The design language: shapes, names, wording and layout",
  review:
    "The review loop: review, verdict and commit, for a prompt that starts 'Use the axonometric skill to review batch N'",
  "visual-check": "Looking at the finished map in a browser, or without one",
} as const;

export const topicNames = Rec.keys(topics);

const topicList = Arr.join(
  Arr.map(
    Rec.toEntries(topics),
    ([name, summary]) => `- \`axonometric docs ${name}\`: ${summary}`
  ),
  "\n"
);

const topicHelp = `One of ${Arr.join(topicNames, ", ")}. Without it, docs prints an overview and lists the topics.`;

const missing = (name: string) =>
  Effect.fail(DocsNotFound.make({ file: `${name}.md` }));

const docs = Effect.fn("docs")(function* (topic: Option.Option<string>) {
  const content = yield* docsContent;

  const text = yield* Option.match(topic, {
    onNone: () =>
      Effect.map(
        Rec.get(content, "overview").pipe(
          Option.match({
            onNone: () => missing("overview"),
            onSome: Effect.succeed,
          })
        ),
        (overview) => `${overview}\n## Topics\n\n${topicList}\n`
      ),
    onSome: (name) =>
      Rec.get(content, name).pipe(
        Option.match({ onNone: () => missing(name), onSome: Effect.succeed })
      ),
  });

  yield* Console.log(text);
});

export const docsCommand = Command.make(
  "docs",
  {
    topic: Argument.Literals("topic", topicNames).pipe(
      Argument.optional,
      Argument.withDescription(topicHelp)
    ),
  },
  ({ topic }) => docs(topic)
).pipe(
  Command.withDescription(
    "Print the instructions for building and reviewing a map. Read them before you use any other command. They ship with the CLI, so they match this version."
  ),
  Command.withExamples([
    { command: "axonometric docs", description: "The overview and the topics" },
    {
      command: "axonometric docs review",
      description: "How to review a batch of the engineer's proposals",
    },
  ])
);
