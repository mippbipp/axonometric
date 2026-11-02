import {
  addItem,
  discardProposal,
  dismissItem,
  editProposal,
  freezeOpen,
  MapFilesUnreadable,
  namesOf,
  proposedMap,
  ProposalRefused,
  proposeChapter,
  proposeFlow,
  proposeGroupWithMembers,
  proposeHop,
  proposeStructure,
  reopenItem,
  reviewPrompt,
} from "@axonometric/contracts";
import type {
  AnswerAdd,
  BatchItem,
  FreezeWrite,
  FreezeAnswer,
  FlowWrite,
  Hop,
  HopWrite,
  Layout,
  ItemWrite,
  Known,
  Mappable,
  MapData,
  ProposedMap,
  NoteAdd,
  ItemEdit,
  Proposals,
  QuestionAdd,
  ReopenWrite,
  ChapterWrite,
  GroupWrite,
  StructureWrite,
  SuggestionAdd,
} from "@axonometric/contracts";
import { Array as Arr, DateTime, Effect, Path, Result } from "effect";

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
  /** The layout open changes land on: the accepted one with frozen items applied. */
  readonly layout: Layout;
  /** The names of the structures the map shows, proposed ones included. */
  readonly structures: ReadonlyMap<string, string>;
  /** The map's hops, with their labels. */
  readonly hops: readonly Hop[];
  /** The map as data.mjs has it, for the items that point into its text. */
  readonly data: MapData;
  /**
   * The map as proposed, with every frozen and open item applied. Checks
   * read it, so a structure or group an earlier proposal adds is known to
   * the later ones.
   */
  readonly proposed: ProposedMap<Mappable>;
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

    // Built once per write: the frozen items alone are what open changes
    // land on, and all of them are what the checks read.
    const state = { data: map.data, layout: map.layout };
    const proposed = proposedMap({ state, proposals: map.proposals });

    const changed = change({
      proposals: map.proposals,
      layout: proposedMap({ state, proposals: map.proposals, open: false })
        .state.layout,
      structures: structureNames(proposed.state.data),
      hops: map.data.hops,
      data: map.data,
      proposed,
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

/** What an item is checked against when it is added. */
const knownIn = ({ structures, proposed, data }: Held): Known => ({
  structureIds: new Set(structures.keys()),
  // A hop the engineer drew can carry a note before the agent adds it.
  hops: proposed.state.data.hops,
  data,
});

/** A write that adds the item `make` builds from the request. */
const adding = <W extends { readonly baseFileRevision: number }>(
  name: string,
  make: (write: Omit<W, "baseFileRevision">) => BatchItem
) =>
  editing<W>(name, (held, { baseFileRevision: _base, ...write }) =>
    addItem({
      proposals: held.proposals,
      item: make(write),
      known: knownIn(held),
    })
  );

/** Adds the note in `write` to the open notes, on a structure, a hop or a spot. */
export const addNoteWrite = adding<NoteAdd>("addNoteWrite", (note) => ({
  kind: "note",
  ...note,
}));

/** Adds a text suggestion. */
export const addSuggestionWrite = adding<SuggestionAdd>(
  "addSuggestionWrite",
  (suggestion) => ({ kind: "suggestion", ...suggestion })
);

/** Adds an answer to an open question. */
export const addAnswerWrite = adding<AnswerAdd>("addAnswerWrite", (answer) => ({
  kind: "answer",
  ...answer,
}));

/** Raises a new question on a structure. */
export const addQuestionWrite = adding<QuestionAdd>(
  "addQuestionWrite",
  (raised) => ({ kind: "question", ...raised })
);

/** Changes the text of an open note, suggestion, answer or raised question. */
export const editItemWrite = editing<ItemEdit>(
  "editItemWrite",
  ({ proposals }, { id, text }) => editProposal({ proposals, id, text })
);

/** Removes an open note, suggestion, answer or raised question. */
export const discardItemWrite = editing<ItemWrite>(
  "discardItemWrite",
  ({ proposals }, { id }) => discardProposal({ proposals, id })
);

/**
 * Sets an open structure proposal: adds a structure, deletes or changes one,
 * or moves a structure the engineer proposed. Refused when it names a group
 * the map lacks or lands on another footprint.
 */
export const setStructureWrite = editing<StructureWrite>(
  "setStructureWrite",
  ({ proposals, proposed }, { id, change }) =>
    proposeStructure({
      proposals,
      id,
      change,
      world: { data: proposed.state.data, layout: proposed.state.layout },
    })
);

/**
 * What a hop or flow proposal is checked against: the map as proposed, so a
 * structure, hop or flow an earlier proposal adds is known to later ones, and
 * the map the frozen items alone make, which an open change lands on.
 */
const connectionWorld = ({ proposed, data, proposals }: Held) => ({
  data: proposed.state.data,
  base: proposedMap({
    state: { data, layout: proposed.state.layout },
    proposals,
    open: false,
  }).state.data,
});

/**
 * Sets an open hop proposal: draws a hop, deletes one or relabels one.
 * Refused when it names a structure or hop the map lacks, or joins a
 * structure to itself.
 */
export const setHopWrite = editing<HopWrite>(
  "setHopWrite",
  (held, { id, change }) =>
    proposeHop({
      proposals: held.proposals,
      id,
      change,
      world: connectionWorld(held),
    })
);

/**
 * Sets an open flow proposal: creates a flow, renames one, sets its ordered
 * hops or reorders the flows. Refused when it names a flow or hop the map
 * lacks.
 */
export const setFlowWrite = editing<FlowWrite>(
  "setFlowWrite",
  (held, { id, change }) =>
    proposeFlow({
      proposals: held.proposals,
      id,
      change,
      world: connectionWorld(held),
    })
);

/**
 * Sets an open group proposal: creates a group, with the structures that go
 * into it as their own group changes in the same write, or renames one. All of
 * it goes in or none of it.
 */
export const setGroupWrite = editing<GroupWrite>(
  "setGroupWrite",
  (held, { id, change, members }) =>
    proposeGroupWithMembers({
      proposals: held.proposals,
      id,
      change,
      members: members ?? [],
      world: connectionWorld(held),
      structures: {
        data: held.proposed.state.data,
        layout: held.proposed.state.layout,
      },
    })
);

/**
 * Sets an open chapter proposal: reveals or hides a structure in one chapter,
 * adds or removes a hop it plays, or puts its hops in a new order.
 */
export const setChapterWrite = editing<ChapterWrite>(
  "setChapterWrite",
  ({ proposals, proposed, data }, { id, change }) =>
    proposeChapter({
      proposals,
      id,
      change,
      world: { data, proposed: proposed.state.data },
    })
);

/** Takes a reviewed item off the page. */
export const dismissWrite = editing<ItemWrite>(
  "dismissWrite",
  ({ proposals }, { id }) => dismissItem({ proposals, id })
);

/** Reopens a rejected item as a new open item linked to it. */
export const reopenWrite = editing<ReopenWrite>(
  "reopenWrite",
  ({ proposals, layout, structures, hops, data }, { id, newId, text }) =>
    reopenItem({
      proposals,
      id,
      newId,
      layout,
      known: new Set(structures.keys()),
      hops,
      text,
      data,
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
    change: ({ proposals, proposed, data, now }) =>
      Result.map(
        freezeOpen({
          proposals,
          at: now,
          known: {
            structure: Arr.map(data.structures, ({ id }) => id),
            hop: Arr.map(data.hops, ({ id }) => id),
            flow: Arr.map(data.flows, ({ id }) => id),
            group: Arr.map(data.groups, ({ id }) => id),
          },
        }),
        (frozen) => ({
          proposals: frozen.proposals,
          answer: {
            batch: frozen.batch,
            home: absolute,
            proposals: frozen.proposals,
            prompt: reviewPrompt({
              home: absolute,
              batch: frozen.batch,
              // A hop the engineer drew has a label on the page and none in
              // data.mjs yet, and so has a group.
              names: namesOf({ shown: proposed.state.data, accepted: data }),
            }),
          },
        })
      ),
  });
});
