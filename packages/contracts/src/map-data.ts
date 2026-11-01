import { Array as Arr, Option, Schema, String as Str } from "effect";

import {
  fileVersionFields,
  objectMessages,
  requiredList,
  requiredText,
} from "./fields.ts";
import { sourceSegments } from "./sources.ts";

/** A text field that may be left out, but isn't empty when it's there. */
const optionalText = (fix: string) =>
  Schema.optionalKey(
    Schema.String.annotate({ message: `expected a string. ${fix}` }).check(
      Schema.isNonEmpty({
        message: `expected a non-empty string. Leave the field out instead. ${fix}`,
      })
    )
  );

/** A list field that may be left out. */
const optionalList = <S extends Schema.Constraint>(
  item: S,
  fix: string
): Schema.optionalKey<Schema.$Array<S>> =>
  Schema.optionalKey(
    Schema.Array(item).annotate({ message: `expected an array. ${fix}` })
  );

/** A list of ids, such as the hops a flow plays. */
const idList = (fix: string) =>
  Schema.Array(requiredText(fix)).pipe(requiredList(fix));

/**
 * A field that data.mjs must not have. Decoding fails with `message`
 * whenever the key is present.
 */
const forbidden = (message: string) =>
  Schema.optionalKey(Schema.Never.annotate({ message }));

const inLayout = (field: string) =>
  forbidden(
    `${field} doesn't belong in data.mjs. Positions and sizes live in layout.json; remove ${field} here and set the structure's x, y, w and d there.`
  );

/** The shapes a structure can be drawn as. */
export const shapes = [
  "box",
  "tall",
  "store",
  "cards",
  "slab",
  "screen",
  "gate",
  "job",
  "person",
  "document",
  "external",
] as const;

const shapeList = Arr.join(shapes, ", ");

export const Shape = Schema.Literals(shapes)
  .annotate({
    message: `expected one of ${shapeList}. Pick the shape closest to the structure's role.`,
  })
  .pipe(
    Schema.annotateKey({
      messageMissingKey: `missing. Set shape to one of ${shapeList}.`,
    })
  );

export type Shape = typeof Shape.Type;

/** Whether a structure runs today, is designed but not built, or is off. */
export const statuses = ["live", "planned", "off"] as const;

export const Status = Schema.Literals(statuses)
  .annotate({
    message: `expected one of ${Arr.join(statuses, ", ")}. Use live for what runs today, planned for what's designed but not running, and off for what exists but is switched off.`,
  })
  .pipe(
    Schema.annotateKey({
      messageMissingKey: `missing. Set status to one of ${Arr.join(statuses, ", ")}.`,
    })
  );

export type Status = typeof Status.Type;

/**
 * The fixed label for each status. Every place that names a status (SYSTEM.md,
 * tooltips, panels and the index) uses this text.
 */
export const statusLabels = {
  live: "Live",
  planned: "Planned",
  off: "Switched off",
} as const satisfies Record<Status, string>;

/** One step of a structure's inside view. */
export const Step = Schema.Struct({
  name: requiredText("Give every step a short name."),
  detail: requiredText("Say what happens in this step."),
}).annotate(objectMessages("A step has only name and detail."));

export type Step = typeof Step.Type;

const questionId = requiredText(
  "Give every question an id of the form Q-<code><n>, such as Q-G1."
).check(
  Schema.isPattern(/^Q-[A-Z]+[1-9]\d*$/u, {
    message:
      "expected an id of the form Q-<code><n>, such as Q-G1, where the code is capital letters and the number starts at 1. Use the structure's code when you first assign the id, then keep the id even if the code changes.",
  })
);

const questionText = requiredText("Write the question as one sentence.");

export const OpenQuestion = Schema.Struct({
  id: questionId,
  state: Schema.Literal("open"),
  text: questionText,
}).annotate(
  objectMessages(
    'An open question has only id, state and text. To record an answer, set state: "resolved" and add answer, answeredBy and answeredOn.'
  )
);

export type OpenQuestion = typeof OpenQuestion.Type;

export const ResolvedQuestion = Schema.Struct({
  id: questionId,
  state: Schema.Literal("resolved"),
  text: questionText,
  answer: requiredText("A resolved question records its answer."),
  answeredBy: requiredText("A resolved question records who gave the answer."),
  answeredOn: requiredText(
    "A resolved question records the date it was answered, as YYYY-MM-DD."
  ).check(
    Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/u, {
      message: "expected a date as YYYY-MM-DD, such as 2026-10-31.",
    })
  ),
}).annotate(
  objectMessages(
    "A resolved question has only id, state, text, answer, answeredBy and answeredOn."
  )
);

export type ResolvedQuestion = typeof ResolvedQuestion.Type;

/** A question about a structure. Its id never changes and is never reused. */
export const Question = Schema.Union([OpenQuestion, ResolvedQuestion])
  .annotate({
    message:
      'expected a question with state "open" or "resolved". Write { id, state: "open", text }, or add answer, answeredBy and answeredOn with state: "resolved".',
  })
  .pipe(
    Schema.annotateKey({
      messageMissingKey: 'missing. Set state to "open" or "resolved".',
    })
  );

export type Question = typeof Question.Type;

const sourcePathFix =
  "Write the path from the root of the git repo that holds the home folder, with / between folders, such as src/server.ts.";

const sourcePath = requiredText(sourcePathFix).check(
  Schema.makeFilter((path: string) => {
    if (Str.startsWith("/")(path) || /^[A-Za-z]:/u.test(path)) {
      return `expected a path from the repo's root, not an absolute path. Drop everything up to and including the repo's folder. ${sourcePathFix}`;
    }

    if (Str.includes("\\")(path)) {
      return `expected / between folders, not \\. ${sourcePathFix}`;
    }

    return Option.isNone(sourceSegments(path))
      ? `expected a path inside the git repo, but the ".." segments climb out of it. ${sourcePathFix}`
      : undefined;
  })
);

/** A file behind a structure, optionally pinned to the commit its text describes. */
const commitHash = Schema.String.annotate({
  message:
    "expected a string. Set commit to the hash of the commit the structure's text describes, or leave it out.",
}).check(
  Schema.isPattern(/^[0-9a-fA-F]{7,64}$/u, {
    message:
      "expected a commit hash of 7 to 64 hex digits, such as the output of git rev-parse --short HEAD. Leave commit out to follow the current branch.",
  })
);

export const Source = Schema.Struct({
  path: sourcePath,
  commit: Schema.optionalKey(commitHash),
}).annotate(
  objectMessages(
    'A source has only path and commit, such as { path: "src/server.ts", commit: "3f2a9c1" }.'
  )
);

export type Source = typeof Source.Type;

export const Structure = Schema.Struct({
  id: requiredText("Give every structure an id."),
  code: requiredText(
    "Give every structure a short code of capital letters, such as G."
  ).check(
    Schema.isPattern(/^[A-Z]{1,3}$/u, {
      message:
        "expected 1 to 3 capital letters, such as G or BG. Question ids are built from it.",
    })
  ),
  name: requiredText("Give every structure a name."),
  tag: optionalText(
    "tag is the short label on the structure's name tag. Leave it out to show the name."
  ),
  shape: Shape,
  group: requiredText("Set group to the id of one of the map's groups."),
  status: Status,
  oneLiner: requiredText(
    "Sum the structure up in one sentence, for its tooltip."
  ),
  whatItDoes: requiredText(
    "Say what the structure does, in plain words for a newcomer."
  ),
  howItsBuilt: requiredText(
    "Say how the structure is built: the files, tables and APIs behind it."
  ),
  steps: optionalList(
    Step,
    "List the steps of the inside view as { name, detail }."
  ),
  questions: optionalList(Question, "List the structure's questions."),
  sources: optionalList(
    Source,
    "List the files behind the structure as { path, commit }, with paths from the root of the git repo."
  ),
  ghost: forbidden(
    'ghost was replaced by status. Remove ghost and set status: "planned" for a structure that is designed but not built, or "off" for one that is switched off.'
  ),
  x: inLayout("x"),
  y: inLayout("y"),
  w: inLayout("w"),
  d: inLayout("d"),
  h: inLayout("h"),
  gx: inLayout("gx"),
  gy: inLayout("gy"),
}).annotate(
  objectMessages(
    "A structure has only id, code, name, tag, shape, group, status, oneLiner, whatItDoes, howItsBuilt, steps, questions and sources. Positions and sizes go in layout.json."
  )
);

export type Structure = typeof Structure.Type;

export const Hop = Schema.Struct({
  id: requiredText("Give every hop an id."),
  from: requiredText("Set from to the id of the structure the hop starts at."),
  to: requiredText("Set to to the id of the structure the hop ends at."),
  label: requiredText("Give every hop a short label."),
  /** An example of what the hop carries. Any JSON value. */
  payload: Schema.optionalKey(Schema.Json),
}).annotate(objectMessages("A hop has only id, from, to, label and payload."));

export type Hop = typeof Hop.Type;

/** A named, ordered list of hops. */
export const Flow = Schema.Struct({
  id: requiredText("Give every flow an id."),
  name: requiredText("Give every flow a name."),
  hops: idList("List the ids of the hops the flow plays, in order.").check(
    Schema.isMinLength(1, {
      message: "expected at least one hop id. List the hops the flow plays.",
    })
  ),
}).annotate(objectMessages("A flow has only id, name and hops."));

export type Flow = typeof Flow.Type;

/** One stop in the walkthrough. */
export const Chapter = Schema.Struct({
  id: requiredText("Give every chapter an id."),
  title: requiredText("Give every chapter a title."),
  lede: requiredText("Write the chapter's lede as one sentence."),
  story: requiredText("Write the chapter's story in two or three sentences."),
  reveals: idList(
    "List the ids of the structures this chapter reveals. Structures revealed earlier stay revealed."
  ),
  plays: idList(
    "List the ids of the hops this chapter plays, in order. Write [] to play none."
  ),
}).annotate(
  objectMessages(
    "A chapter has only id, title, lede, story, reveals and plays."
  )
);

export type Chapter = typeof Chapter.Type;

/** A named set of structures. Its zone is drawn around them. */
export const Group = Schema.Struct({
  id: requiredText("Give every group an id."),
  title: requiredText("Give every group a title."),
}).annotate(objectMessages("A group has only id and title."));

export type Group = typeof Group.Type;

export const Stat = Schema.Struct({
  label: requiredText("Give every stat a label, such as Structures."),
  value: requiredText("Give every stat a value, as text."),
}).annotate(objectMessages("A stat has only label and value."));

export type Stat = typeof Stat.Type;

export const Decision = Schema.Struct({
  topic: requiredText("Name what the decision is about, such as Runtime."),
  decision: requiredText("State the decision and why, in one line."),
  adr: optionalText(
    "Link the ADR with a path relative to SYSTEM.md, such as ../adr/0001-runtime.md, or a URL."
  ),
}).annotate(objectMessages("A decision has only topic, decision and adr."));

export type Decision = typeof Decision.Type;

export const DeepDive = Schema.Struct({
  title: requiredText("Give every deep dive a title."),
  summary: requiredText("Sum up what the deep dive found."),
  link: optionalText(
    "Link the deep dive's document with a path relative to SYSTEM.md, or a URL."
  ),
}).annotate(objectMessages("A deep dive has only title, summary and link."));

export type DeepDive = typeof DeepDive.Type;

/**
 * The map as a whole. The "How it's built" page and its SYSTEM.md section
 * are generated from these fields.
 */
export const Overview = Schema.Struct({
  title: requiredText("Give the map a title."),
  summary: requiredText(
    "Write one paragraph a newcomer can read in 30 seconds."
  ),
  stats: optionalList(Stat, "List stats as { label, value }."),
  decisions: optionalList(
    Decision,
    "List decisions as { topic, decision, adr }."
  ),
  fileLayout: optionalText(
    "Write the file layout as an indented tree, one path per line."
  ),
  platformProvides: optionalText(
    "Say what the platform or framework provides."
  ),
  weOwn: optionalText("Say what this system has to build itself."),
  costModel: optionalText("Write the cost assumptions as Markdown."),
  deepDives: optionalList(
    DeepDive,
    "List deep dives as { title, summary, link }."
  ),
})
  .annotate(
    objectMessages(
      "An overview has only title, summary, stats, decisions, fileLayout, platformProvides, weOwn, costModel and deepDives."
    )
  )
  .pipe(
    Schema.annotateKey({
      messageMissingKey: "missing. Add overview: { title, summary }.",
    })
  );

export type Overview = typeof Overview.Type;

/**
 * The default export of `data.mjs`: the map's meaning. It holds no positions
 * or sizes; those live in `layout.json`. Checks that span fields, such as
 * references between ids, are in `checkMap`.
 */
export const MapData = Schema.Struct({
  ...fileVersionFields,
  overview: Overview,
  groups: Schema.Array(Group).pipe(
    requiredList("List the map's groups as { id, title }.")
  ),
  structures: Schema.Array(Structure).pipe(
    requiredList("List the map's structures in an array.")
  ),
  hops: Schema.Array(Hop).pipe(
    requiredList("List the map's hops in an array.")
  ),
  flows: Schema.Array(Flow).pipe(
    requiredList("List the map's flows in an array. Write [] for none.")
  ),
  chapters: Schema.Array(Chapter).pipe(
    requiredList("List the walkthrough's chapters in order. Write [] for none.")
  ),
}).annotate(
  objectMessages(
    "A map has only format, revision, overview, groups, structures, hops, flows and chapters. Positions and sizes go in layout.json."
  )
);

export type MapData = typeof MapData.Type;
