import { Schema } from "effect";

import { ChapterChange } from "./chapter-change.ts";
import { GroupChange } from "./group-change.ts";
import {
  answerFields,
  Batch,
  ChangeId,
  NoteTarget,
  NoteText,
  Proposals,
  raisedFields,
  SuggestionText,
  suggestionFields,
} from "./proposals.ts";
import { StructureChange, StructureId } from "./structure-change.ts";

/**
 * Adds a note to the open notes, pinned to a structure, a hop or an empty
 * spot. The page makes the id, so a retry can't add it twice.
 */
export const NoteAdd = Schema.Struct({
  /** The `proposals.json` revision the page based the write on. */
  baseFileRevision: Schema.Int,
  id: ChangeId,
  target: NoteTarget,
  text: NoteText,
});

export type NoteAdd = typeof NoteAdd.Type;

/** Adds a text suggestion: the field, the original as the page showed it, and the new text. */
export const SuggestionAdd = Schema.Struct({
  baseFileRevision: Schema.Int,
  id: ChangeId,
  ...suggestionFields,
});

export type SuggestionAdd = typeof SuggestionAdd.Type;

/** Adds an answer to an open question, with the day the engineer gave it. */
export const AnswerAdd = Schema.Struct({
  baseFileRevision: Schema.Int,
  id: ChangeId,
  ...answerFields,
});

export type AnswerAdd = typeof AnswerAdd.Type;

/** Raises a new question on a structure. It has no question id; the agent assigns one. */
export const QuestionAdd = Schema.Struct({
  baseFileRevision: Schema.Int,
  id: ChangeId,
  ...raisedFields,
});

export type QuestionAdd = typeof QuestionAdd.Type;

/**
 * Changes the text of an open note, suggestion, answer or raised question:
 * the note's text, or the suggestion's new text.
 */
export const ItemEdit = Schema.Struct({
  baseFileRevision: Schema.Int,
  id: ChangeId,
  text: SuggestionText,
});

export type ItemEdit = typeof ItemEdit.Type;

/** Names one note, change or item by id: to discard an open note, or dismiss a reviewed item. */
export const ItemWrite = Schema.Struct({
  baseFileRevision: Schema.Int,
  id: ChangeId,
});

export type ItemWrite = typeof ItemWrite.Type;

/**
 * Sets the open structure proposal `id` to `change`. The page makes the id, so
 * a retry can't add it twice. The same id with another change of the same
 * structure and action replaces the change, which is how a proposed
 * structure is moved or resized.
 */
export const StructureWrite = Schema.Struct({
  baseFileRevision: Schema.Int,
  id: ChangeId,
  change: StructureChange,
});

export type StructureWrite = typeof StructureWrite.Type;

/**
 * Sets the open group proposal `id` to `change`: a new group, or a new title
 * for one. `members` are the structures that go into a new group, each with
 * the id of its own group change, which the server adds in the same write, so
 * a group made from a selection is all there or not at all.
 */
/** The most structures a new group takes in when it is made from a selection. */
export const maxGroupMembers = 200;

const membersFix = `expected up to ${maxGroupMembers} structures to move into the group.`;

/** A structure that moves into a new group, with the id of its group change. */
const GroupMember = Schema.Struct({ id: ChangeId, structure: StructureId });

const GroupMembers = Schema.Array(GroupMember)
  .annotate({ message: membersFix })
  .check(Schema.isMaxLength(maxGroupMembers, { message: membersFix }));

export const GroupWrite = Schema.Struct({
  baseFileRevision: Schema.Int,
  id: ChangeId,
  change: GroupChange,
  members: Schema.optionalKey(GroupMembers),
});

export type GroupWrite = typeof GroupWrite.Type;

/** Sets the open chapter proposal `id` to `change`. */
export const ChapterWrite = Schema.Struct({
  baseFileRevision: Schema.Int,
  id: ChangeId,
  change: ChapterChange,
});

export type ChapterWrite = typeof ChapterWrite.Type;

/** Reopens a rejected item as a new open item with the id `newId`. */
export const ReopenWrite = Schema.Struct({
  baseFileRevision: Schema.Int,
  id: ChangeId,
  newId: ChangeId,
  /** For an item of text, the new text. Left out, the new item copies the old one. */
  text: Schema.optionalKey(SuggestionText),
});

export type ReopenWrite = typeof ReopenWrite.Type;

/** "Ready for review": freezes every open change and note into a batch. */
export const FreezeWrite = Schema.Struct({
  baseFileRevision: Schema.Int,
});

export type FreezeWrite = typeof FreezeWrite.Type;

/** The batch just frozen, and the prompt that names it. */
export const FreezeAnswer = Schema.Struct({
  batch: Batch,
  /** The absolute path of the map's home folder, which the prompt names. */
  home: Schema.String,
  /** The review prompt for the engineer to paste into an agent harness. */
  prompt: Schema.String,
  /** What `proposals.json` holds now. */
  proposals: Proposals,
});

export type FreezeAnswer = typeof FreezeAnswer.Type;

/**
 * The write isn't allowed, such as editing a note that is waiting for the
 * agent, or freezing with nothing open. Nothing was written. `proposals` is
 * the file as it is now.
 */
export class ProposalRefused extends Schema.TaggedError<
  ProposalRefused,
  { readonly brand: unique symbol }
>()(
  "ProposalRefused",
  { reason: Schema.String, proposals: Proposals },
  { httpApiStatus: 422 }
) {}
