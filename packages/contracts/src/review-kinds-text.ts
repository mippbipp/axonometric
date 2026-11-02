import { Array as Arr, Option } from "effect";

import type { MapData } from "./map-data.ts";
import { maxNoteLength, maxSuggestionLength } from "./proposals.ts";
import type { BatchItem } from "./proposals.ts";
import { plain } from "./review-kind-defaults.ts";
import type { Existing, KindSpec, Pointer } from "./review-kinds.ts";
import { decorate, oneLine, quoteText } from "./review-quote.ts";
import { fieldLabel, textOfField } from "./text-fields.ts";

// The kinds that carry the engineer's text: a text suggestion, an answer to
// a question and a question raised on a structure. Each is one entry of the
// kind table; `review-kinds.ts` lists them.

type SuggestionItem = Extract<BatchItem, { kind: "suggestion" }>;

type AnswerItem = Extract<BatchItem, { kind: "answer" }>;

type QuestionItem = Extract<BatchItem, { kind: "question" }>;

const missingStructure = (id: string, what: string) =>
  `No structure in data.mjs has the id "${id}", so this ${what} has nothing to point at.`;

const noStructure = (
  id: string,
  structureIds: ReadonlySet<string>,
  what: string
) =>
  structureIds.has(id)
    ? Option.none<string>()
    : Option.some(missingStructure(id, what));

/**
 * Why an item can't join one that is waiting. An open one can be edited or
 * discarded first. One in a batch can't be: it waits for the agent's commit.
 */
const waitingMessage = ({
  what,
  id,
  batch,
}: {
  readonly what: string;
  readonly id: string;
  readonly batch: number | undefined;
}) =>
  batch === undefined
    ? `${what} waiting (${id}). Edit or discard that one first.`
    : `${what} waiting (${id}) in batch ${batch}, which is waiting for the agent. Add yours once the agent commits.`;

const danglingStructure = (id: string, known: Existing) =>
  known.structures.has(id)
    ? Option.none<string>()
    : Option.some(`no structure in data.mjs has the id "${id}"`);

/** The question `id` on structure `on`, as data.mjs has it. */
const questionOn = (data: MapData, on: string, id: string) =>
  Option.flatMap(
    Arr.findFirst(data.structures, (structure) => structure.id === on),
    (structure) =>
      Arr.findFirst(structure.questions ?? [], (question) => question.id === id)
  );

export const suggestionKind: KindSpec<SuggestionItem> = {
  ...plain<SuggestionItem>(),
  textLimit: maxSuggestionLength,
  listKey: "suggestions",
  text: ({ after }) => Option.some(after),
  describe: ({ target, field, after }, nameOf) =>
    Option.some(
      `Suggestion for the ${fieldLabel(field)} of ${nameOf(target.id)}: ${after}`
    ),
  open: (proposals) =>
    Arr.map(proposals.suggestions ?? [], (suggestion): SuggestionItem => ({
      kind: "suggestion",
      ...suggestion,
    })),
  clear: (proposals) => ({ ...proposals, suggestions: [] }),
  add: (proposals, { kind: _kind, ...suggestion }) => ({
    ...proposals,
    suggestions: [...(proposals.suggestions ?? []), suggestion],
  }),
  name: () => "suggestion",
  targets: (item): readonly Pointer[] => [
    { kind: "structure", id: item.target.id },
  ],
  dangling: (item, known) => danglingStructure(item.target.id, known),
  summary: (item, nameOf) =>
    `suggestion ${item.id} on ${quoteText(nameOf(item.target.id))}, ${fieldLabel(item.field)}: from ${quoteText(oneLine(item.before, 60))} to ${quoteText(oneLine(item.after, 60))}`,
  facts: (item) => ({
    before: { field: item.field, text: item.before },
    after: { field: item.field, text: item.after },
  }),
  breakage: (item, { structureIds, data }) => {
    const missing = noStructure(item.target.id, structureIds, "suggestion");

    if (Option.isSome(missing) || data === undefined) {
      return missing;
    }

    const structure = Arr.findFirst(
      data.structures,
      ({ id }) => id === item.target.id
    );

    return Option.isSome(structure) &&
      Option.isNone(textOfField(structure.value, item.field))
      ? Option.some(
          `The structure "${item.target.id}" has no ${fieldLabel(item.field)}, so this suggestion has no text to replace.`
        )
      : Option.none();
  },
  outOfDate: (item, data) =>
    Option.flatMap(
      Arr.findFirst(data.structures, ({ id }) => id === item.target.id),
      (structure) =>
        Option.flatMap(textOfField(structure, item.field), (now) =>
          now === item.before
            ? Option.none()
            : Option.some(
                `The original is out of date: data.mjs says ${quoteText(oneLine(now, 200))} now, not what the engineer saw. Weigh the suggestion against the current text.`
              )
        )
    ),
  clash: (item, waiting) =>
    Option.map(
      Arr.findFirst(
        waiting,
        ({ item: other }) =>
          other.kind === "suggestion" &&
          other.target.id === item.target.id &&
          other.field === item.field
      ),
      ({ item: { id }, batch }) =>
        waitingMessage({
          what: `The ${fieldLabel(item.field)} of "${item.target.id}" already has a suggestion`,
          id,
          batch,
        })
    ),
  notice:
    "To take a text suggestion, set the field it names in data.mjs to the suggested text, or to your own wording with the verdict changed. Compare it with the original shown as before.",
  applies: () => [],
  accepted: (item, verdict) =>
    decorate(
      {
        kind: "suggestion",
        id: item.id,
        target: item.target,
        field: item.field,
        before: item.before,
        after: item.after,
      } as const,
      verdict
    ),
  rejected: (item, reason) => ({
    kind: "suggestion",
    id: item.id,
    target: item.target,
    field: item.field,
    before: item.before,
    after: item.after,
    reason,
  }),
  reopened: (item, newId, text) => ({
    ...item,
    id: newId,
    after: text ?? item.after,
  }),
};

export const answerKind: KindSpec<AnswerItem> = {
  ...plain<AnswerItem>(),
  textLimit: maxNoteLength,
  listKey: "answers",
  text: ({ text }) => Option.some(text),
  describe: ({ target, question, text }, nameOf) =>
    Option.some(`Answer to ${question} on ${nameOf(target.id)}: ${text}`),
  open: (proposals) =>
    Arr.map(proposals.answers ?? [], (answer): AnswerItem => ({
      kind: "answer",
      ...answer,
    })),
  clear: (proposals) => ({ ...proposals, answers: [] }),
  add: (proposals, { kind: _kind, ...answer }) => ({
    ...proposals,
    answers: [...(proposals.answers ?? []), answer],
  }),
  name: () => "answer",
  targets: (item): readonly Pointer[] => [
    { kind: "structure", id: item.target.id },
  ],
  dangling: (item, known) => danglingStructure(item.target.id, known),
  summary: (item, nameOf) =>
    `answer ${item.id} to ${item.question} on ${quoteText(nameOf(item.target.id))}, given ${item.answeredOn}: ${quoteText(oneLine(item.text, 80))}`,
  facts: (item, _layout, data) => ({
    before: {
      question: item.question,
      text: Option.match(
        data === undefined
          ? Option.none()
          : questionOn(data, item.target.id, item.question),
        { onNone: () => "", onSome: ({ text }) => text }
      ),
    },
    after: {
      question: item.question,
      text: item.text,
      answeredOn: item.answeredOn,
    },
  }),
  breakage: (item, { structureIds, data }) => {
    const missing = noStructure(item.target.id, structureIds, "answer");

    if (Option.isSome(missing) || data === undefined) {
      return missing;
    }

    const question = questionOn(data, item.target.id, item.question);

    if (Option.isNone(question)) {
      return Option.some(
        `Structure "${item.target.id}" has no question ${item.question} in data.mjs, so this answer has nothing to answer.`
      );
    }

    return question.value.state === "resolved"
      ? Option.some(
          `${item.question} is resolved in data.mjs already, answered by ${question.value.answeredBy} on ${question.value.answeredOn}.`
        )
      : Option.none();
  },
  clash: (item, waiting) =>
    Option.map(
      Arr.findFirst(
        waiting,
        ({ item: other }) =>
          other.kind === "answer" &&
          other.question === item.question &&
          other.target.id === item.target.id
      ),
      ({ item: { id }, batch }) =>
        waitingMessage({
          what: `${item.question} already has an answer`,
          id,
          batch,
        })
    ),
  notice:
    'To take an answer, change its question in data.mjs to state: "resolved" and add answer, answeredOn (the date shown) and answeredBy. Set answeredBy yourself, to the name of the engineer who answered, such as the git user.name: the page does not know who is typing, and the answer must not name you. Ask the engineer if you cannot tell.',
  applies: () => [],
  accepted: (item, verdict) =>
    decorate(
      {
        kind: "answer",
        id: item.id,
        target: item.target,
        question: item.question,
        text: item.text,
        answeredOn: item.answeredOn,
      } as const,
      verdict
    ),
  rejected: (item, reason) => ({
    kind: "answer",
    id: item.id,
    target: item.target,
    question: item.question,
    text: item.text,
    answeredOn: item.answeredOn,
    reason,
  }),
  reopened: (item, newId, text) => ({
    ...item,
    id: newId,
    text: text ?? item.text,
  }),
};

export const questionKind: KindSpec<QuestionItem> = {
  ...plain<QuestionItem>(),
  textLimit: maxNoteLength,
  listKey: "raised",
  text: ({ text }) => Option.some(text),
  describe: ({ target, text }, nameOf) =>
    Option.some(`New question on ${nameOf(target.id)}: ${text}`),
  open: (proposals) =>
    Arr.map(proposals.raised ?? [], (raised): QuestionItem => ({
      kind: "question",
      ...raised,
    })),
  clear: (proposals) => ({ ...proposals, raised: [] }),
  add: (proposals, { kind: _kind, ...raised }) => ({
    ...proposals,
    raised: [...(proposals.raised ?? []), raised],
  }),
  name: () => "question",
  targets: (item): readonly Pointer[] => [
    { kind: "structure", id: item.target.id },
  ],
  dangling: (item, known) => danglingStructure(item.target.id, known),
  summary: (item, nameOf) =>
    `question ${item.id} on ${quoteText(nameOf(item.target.id))}: ${quoteText(oneLine(item.text, 80))}`,
  facts: (item) => ({ before: null, after: { text: item.text } }),
  breakage: (item, { structureIds }) =>
    noStructure(item.target.id, structureIds, "question"),
  notice:
    "To take a raised question, add { id, state: \"open\", text } to the structure's questions in data.mjs. Assign the id yourself: Q- and the structure's code, then the next number never used on the map, resolved questions included. The item id is not a question id.",
  applies: () => [],
  accepted: (item, verdict) =>
    decorate(
      {
        kind: "question",
        id: item.id,
        target: item.target,
        text: item.text,
      } as const,
      verdict
    ),
  rejected: (item, reason) => ({
    kind: "question",
    id: item.id,
    target: item.target,
    text: item.text,
    reason,
  }),
  reopened: (item, newId, text) => ({
    ...item,
    id: newId,
    text: text ?? item.text,
  }),
};
