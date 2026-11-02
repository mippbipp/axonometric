import {
  addNote,
  applyLayoutChanges,
  frozenLayoutChanges,
  discardNote,
  dismissItem,
  editNote,
  freezeOpen,
  hopLabelOf,
  MapFilesUnreadable,
  ProposalRefused,
  reopenItem,
  reviewPrompt,
} from "@axonometric/contracts";
import type {
  FreezeWrite,
  FreezeAnswer,
  Hop,
  Layout,
  ItemWrite,
  NoteAdd,
  NoteEdit,
  Proposals,
  ReopenWrite,
} from "@axonometric/contracts";
import { DateTime, Effect, Path, Result } from "effect";

import { encodeProposals } from "./map-files.ts";
import { loadForWrite } from "./pending-writes.ts";
import { loadReviewMap, structureNames } from "./review-shared.ts";
import { writeAll } from "./write-files.ts";

/**
 * What every review write does, under the lock: reads the map and
 * `proposals.json`, refuses a write based on an older revision, asks `change`
 * for the next `proposals.json`, writes it atomically, and runs `written`,
 * still under the lock, to tell the open pages. A `change` that fails
 * refuses the write with its reason and writes nothing.
 */
/** What a write's change is given: the files as read under the lock. */
interface Held {
  readonly proposals: Proposals;
  /** The layout open changes land on: the accepted one with frozen changes applied. */
  readonly layout: Layout;
  readonly structures: ReadonlyMap<string, string>;
  /** The map's hops, with their labels. */
  readonly hops: readonly Hop[];
  readonly now: string;
}

const writeProposals = Effect.fnUntraced(
  function* <A>({
    home,
    baseFileRevision,
    change,
    written,
  }: {
    readonly home: string;
    readonly baseFileRevision: number;
    readonly change: (held: Held) => Change<A>;
    readonly written: (proposals: Proposals) => Effect.Effect<void>;
  }) {
    const path = yield* Path.Path;

    const map = yield* loadForWrite(
      home,
      baseFileRevision,
      loadReviewMap(home, "serve").pipe(
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
      layout: applyLayoutChanges(
        map.layout,
        frozenLayoutChanges(map.proposals)
      ),
      structures: structureNames(map.data),
      hops: map.data.hops,
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
  },
  Effect.scoped,
  Effect.catchTag(
    ["PlatformError", "LockHeld", "SchemaError", "BadArgument", "OutputExists"],
    Effect.die
  )
);

type Told = (proposals: Proposals) => Effect.Effect<void>;

/** What a write changes, and what it answers. */
type Change<A> = Result.Result<
  { readonly proposals: Proposals; readonly answer: A },
  string
>;

/** A change that answers with the file it makes. */
const answeringWithFile = (
  made: Result.Result<Proposals, string>
): Change<Proposals> =>
  Result.map(made, (proposals) => ({ proposals, answer: proposals }));

/**
 * A write that edits `proposals.json` and answers with the file. The edit
 * is given what the lock holder read.
 */
const editing =
  <W extends { readonly baseFileRevision: number }>(
    name: string,
    edit: (held: Held, write: W) => Result.Result<Proposals, string>
  ) =>
  (home: string, write: W, written: Told) =>
    writeProposals({
      home,
      baseFileRevision: write.baseFileRevision,
      written,
      change: (held) => answeringWithFile(edit(held, write)),
    }).pipe(Effect.withSpan(name));

// oxlint-disable effecttsgo/missing-pipeable-signature -- these are request handlers called as `(home, write, written)`, never piped.

/** Adds the note in `write` to the open notes. */
export const addNoteWrite = editing<NoteAdd>(
  "addNoteWrite",
  ({ proposals, structures }, { baseFileRevision: _base, ...note }) =>
    addNote({ proposals, note, known: new Set(structures.keys()) })
);

/** Changes the text of an open note. */
export const editNoteWrite = editing<NoteEdit>(
  "editNoteWrite",
  ({ proposals }, { id, text }) => editNote({ proposals, id, text })
);

/** Removes an open note. */
export const discardNoteWrite = editing<ItemWrite>(
  "discardNoteWrite",
  ({ proposals }, { id }) => discardNote({ proposals, id })
);

/** Takes a reviewed item off the page. */
export const dismissWrite = editing<ItemWrite>(
  "dismissWrite",
  ({ proposals }, { id }) => dismissItem({ proposals, id })
);

/** Reopens a rejected item as a new open item linked to it. */
export const reopenWrite = editing<ReopenWrite>(
  "reopenWrite",
  ({ proposals, layout, structures, hops }, { id, newId, text }) =>
    reopenItem({
      proposals,
      id,
      newId,
      layout,
      known: new Set(structures.keys()),
      hops,
      text,
    })
);

/**
 * Freezes every open item into the next batch, and builds the prompt for it.
 * The answer names the absolute path of the home folder, which the prompt
 * does too.
 */
export const freezeWrite = Effect.fn("freezeWrite")(function* (
  home: string,
  write: FreezeWrite,
  written: Told
) {
  const path = yield* Path.Path;
  const absolute = path.resolve(home);

  return yield* writeProposals<FreezeAnswer>({
    home,
    baseFileRevision: write.baseFileRevision,
    written,
    change: ({ proposals, structures, hops, now }) =>
      Result.map(freezeOpen({ proposals, at: now }), (frozen) => ({
        proposals: frozen.proposals,
        answer: {
          batch: frozen.batch,
          home: absolute,
          proposals: frozen.proposals,
          prompt: reviewPrompt({
            home: absolute,
            batch: frozen.batch,
            names: {
              structure: (id) => structures.get(id) ?? id,
              hop: hopLabelOf(hops),
            },
          }),
        },
      })),
  });
});
