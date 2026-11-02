import { Schema } from "effect";

import {
  Batch,
  ChangeId,
  NoteText,
  Proposals,
  StructureTarget,
} from "./proposals.ts";
import { StructureChange } from "./structure-change.ts";

/** Adds a note to the open notes. The page makes the id, so a retry can't add it twice. */
export const NoteAdd = Schema.Struct({
  /** The `proposals.json` revision the page based the write on. */
  baseFileRevision: Schema.Int,
  id: ChangeId,
  target: StructureTarget,
  text: NoteText,
});

export type NoteAdd = typeof NoteAdd.Type;

/** Changes the text of an open note. */
export const NoteEdit = Schema.Struct({
  baseFileRevision: Schema.Int,
  id: ChangeId,
  text: NoteText,
});

export type NoteEdit = typeof NoteEdit.Type;

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

/** Removes the open structure proposal `id`. */
export const StructureDiscard = ItemWrite;

export type StructureDiscard = typeof StructureDiscard.Type;

/** Reopens a rejected item as a new open item with the id `newId`. */
export const ReopenWrite = Schema.Struct({
  baseFileRevision: Schema.Int,
  id: ChangeId,
  newId: ChangeId,
  /** For a note, the new words. Left out, the new note copies the old one. */
  text: Schema.optionalKey(NoteText),
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
