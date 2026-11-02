import {
  addNote,
  applyLayoutChanges,
  frozenLayoutChanges,
  discardNote,
  dismissItem,
  editNote,
  freezeOpen,
  MapFilesUnreadable,
  placeStructures,
  ProposalRefused,
  reopenItem,
  reviewPrompt,
} from "@axonometric/contracts";
import type {
  FreezeWrite,
  FrozenReview,
  Layout,
  ItemWrite,
  NoteAdd,
  NoteEdit,
  Proposals,
  ReopenWrite,
} from "@axonometric/contracts";
import { Array as Arr, DateTime, Effect, Path, Result } from "effect";

import { encodeProposals, loadMap } from "./map-files.ts";
import { loadForWrite } from "./pending-writes.ts";
import { writeAll } from "./write-files.ts";

/**
 * What every review write does, under the lock: reads the map and
 * `proposals.json`, refuses a write based on an older revision, asks `change`
 * for the next `proposals.json`, writes it atomically, and runs `written`,
 * still under the lock, to tell the open pages. A `change` that fails
 * refuses the write with its reason and writes nothing.
 */
const writeProposals = Effect.fnUntraced(function* <A>({
  home,
  baseFileRevision,
  change,
  written,
}: {
  readonly home: string;
  readonly baseFileRevision: number;
  readonly change: (held: {
    readonly proposals: Proposals;
    readonly layout: Layout;
    readonly structures: ReadonlyMap<string, string>;
    readonly now: string;
  }) => Result.Result<
    { readonly proposals: Proposals; readonly answer: A },
    string
  >;
  readonly written: (proposals: Proposals) => Effect.Effect<void>;
}) {
  const path = yield* Path.Path;

  const map = yield* loadForWrite(
    home,
    baseFileRevision,
    loadMap({
      home,
      output: path.dirname(home),
      command: "serve",
      arrange: (data, saved) => placeStructures(data, saved).layout,
      strictProposals: true,
    }).pipe(
      Effect.catchTag("MapInvalid", ({ problems }) =>
        MapFilesUnreadable.make({ problems })
      )
    )
  );

  const now = DateTime.formatIso(yield* DateTime.now);

  const changed = change({
    proposals: map.proposals,
    // The layout an open change lands on: the accepted one with the
    // changes frozen in batches applied.
    layout: applyLayoutChanges(map.layout, frozenLayoutChanges(map.proposals)),
    structures: new Map(
      Arr.map(map.data.structures, ({ id, name }) => [id, name])
    ),
    now,
  });

  if (Result.isFailure(changed)) {
    return yield* ProposalRefused.make({
      reason: changed.failure,
      proposals: map.proposals,
    });
  }

  const { proposals, answer } = changed.success;

  yield* writeAll([
    {
      file: path.join(home, "proposals.json"),
      content: yield* encodeProposals(proposals),
    },
  ]);

  yield* written(proposals);

  return answer;
}, Effect.scoped);

type Told = (proposals: Proposals) => Effect.Effect<void>;

/** Adds the note in `write` to the open notes. */
export const addNoteWrite = Effect.fn("addNoteWrite")(function* (
  home: string,
  write: NoteAdd,
  written: Told
) {
  const { baseFileRevision, ...note } = write;

  return yield* writeProposals({
    home,
    baseFileRevision,
    written,
    change: ({ proposals, structures }) => {
      const added = addNote({
        proposals,
        note,
        known: new Set(structures.keys()),
      });

      return Result.map(added, (next) => ({ proposals: next, answer: next }));
    },
  });
});

/** Changes the text of an open note. */
export const editNoteWrite = Effect.fn("editNoteWrite")(function* (
  home: string,
  write: NoteEdit,
  written: Told
) {
  return yield* writeProposals({
    home,
    baseFileRevision: write.baseFileRevision,
    written,
    change: ({ proposals }) => {
      const edited = editNote({ proposals, id: write.id, text: write.text });

      return Result.map(edited, (next) => ({ proposals: next, answer: next }));
    },
  });
});

/** Removes an open note. */
export const discardNoteWrite = Effect.fn("discardNoteWrite")(function* (
  home: string,
  write: ItemWrite,
  written: Told
) {
  return yield* writeProposals({
    home,
    baseFileRevision: write.baseFileRevision,
    written,
    change: ({ proposals }) => {
      const discarded = discardNote({ proposals, id: write.id });

      return Result.map(discarded, (next) => ({
        proposals: next,
        answer: next,
      }));
    },
  });
});

/** Takes a reviewed item off the page. */
export const dismissWrite = Effect.fn("dismissWrite")(function* (
  home: string,
  write: ItemWrite,
  written: Told
) {
  return yield* writeProposals({
    home,
    baseFileRevision: write.baseFileRevision,
    written,
    change: ({ proposals }) => {
      const dismissed = dismissItem({ proposals, id: write.id });

      return Result.map(dismissed, (next) => ({
        proposals: next,
        answer: next,
      }));
    },
  });
});

/** Reopens a rejected item as a new open item linked to it. */
export const reopenWrite = Effect.fn("reopenWrite")(function* (
  home: string,
  write: ReopenWrite,
  written: Told
) {
  return yield* writeProposals({
    home,
    baseFileRevision: write.baseFileRevision,
    written,
    change: ({ proposals, layout }) => {
      const reopened = reopenItem({
        proposals,
        id: write.id,
        newId: write.newId,
        layout,
        text: write.text,
      });

      return Result.map(reopened, (next) => ({
        proposals: next,
        answer: next,
      }));
    },
  });
});

/**
 * Freezes every open layout change and note into the next batch, and builds
 * the prompt for it. The prompt names the absolute path of the home folder.
 */
export const freezeWrite = Effect.fn("freezeWrite")(function* (
  home: string,
  write: FreezeWrite,
  written: Told
) {
  const path = yield* Path.Path;
  const absolute = path.resolve(home);

  return yield* writeProposals<FrozenReview>({
    home,
    baseFileRevision: write.baseFileRevision,
    written,
    change: ({ proposals, structures, now }) => {
      const frozen = freezeOpen({ proposals, at: now });

      return Result.map(frozen, ({ batch, proposals: next }) => ({
        proposals: next,
        answer: {
          batch,
          proposals: next,
          prompt: reviewPrompt({
            home: absolute,
            batch,
            nameOf: (id) => structures.get(id) ?? id,
          }),
        },
      }));
    },
  });
});
