import { Schema } from "effect";

import { Batch, ChangeId, NoteText, Proposals, Target } from "./proposals.ts";

/** Adds a note to the open notes. The page makes the id, so a retry can't add it twice. */
export const NoteAdd = Schema.Struct({
  /** The `proposals.json` revision the page based the write on. */
  baseFileRevision: Schema.Int,
  id: ChangeId,
  target: Target,
  text: NoteText,
  /** The rejected note this one takes up again. */
  replaces: Schema.optionalKey(ChangeId),
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

/** "Ready for review": freezes every open change and note into a batch. */
export const FreezeWrite = Schema.Struct({
  baseFileRevision: Schema.Int,
});

export type FreezeWrite = typeof FreezeWrite.Type;

/** The batch just frozen, and the prompt that names it. */
export const Frozen = Schema.Struct({
  batch: Batch,
  /** The review prompt for the engineer to paste into an agent harness. */
  prompt: Schema.String,
  /** What `proposals.json` holds now. */
  proposals: Proposals,
});

export type Frozen = typeof Frozen.Type;

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
