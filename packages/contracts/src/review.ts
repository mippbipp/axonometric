import {
  Array as Arr,
  Option,
  Order,
  Record as Rec,
  Result,
  String as Str,
} from "effect";
import { dual } from "effect/Function";

import { acceptLayoutChanges } from "./accept.ts";
import type { Layout } from "./layout.ts";
import { layoutRefusal, structuresOf } from "./proposals.ts";
import type {
  Batch,
  BatchItem,
  ChangeId,
  LayoutChange,
  Note,
  Proposals,
  Verdict,
} from "./proposals.ts";
import type { AcceptedItem, RejectedItem } from "./revisions.ts";

/** The list a batch's items and a proposals file's open items share. */
type Listed = Pick<Proposals, "layout" | "notes" | "batches">;

/** A batch no commit has closed yet. */
const isOpenBatch = (batch: Batch) => batch.committed === undefined;

/** The batches `proposals` holds, in number order. */
export const batchesOf = (proposals: Listed): readonly Batch[] =>
  Arr.sort(
    proposals.batches ?? [],
    Order.mapInput(Order.Number, ({ number }: Batch) => number)
  );

/** The oldest batch with no commit: the one `review` shows. */
export const oldestOpenBatch = (proposals: Listed): Option.Option<Batch> =>
  Arr.findFirst(batchesOf(proposals), isOpenBatch);

/** The number the next batch takes: one more than the highest so far. */
export const nextBatchNumber = (proposals: Listed): number =>
  (batchesOf(proposals).at(-1)?.number ?? 0) + 1;

/**
 * The layout changes frozen in batches that no commit has closed. The page
 * draws them as pending, under the open layout changes, and the engineer
 * can't edit or discard them.
 */
export const frozenLayoutChanges = (
  proposals: Listed
): readonly LayoutChange[] => {
  const open = Arr.filter(batchesOf(proposals), (batch) => isOpenBatch(batch));

  return Arr.flatMap(open, (batch) =>
    Arr.flatMap(batch.items, (item) =>
      item.kind === "layout" ? [item.change] : []
    )
  );
};

/** How many open items, layout changes and notes, are not in a batch yet. */
export const openItemCount = (proposals: Listed): number =>
  proposals.layout.length + (proposals.notes?.length ?? 0);

/** The batch that holds item `id`, and the item. */
export const findBatchItem: {
  (
    id: string
  ): (
    proposals: Listed
  ) => Option.Option<{ readonly batch: Batch; readonly item: BatchItem }>;
  (
    proposals: Listed,
    id: string
  ): Option.Option<{ readonly batch: Batch; readonly item: BatchItem }>;
} = dual(2, (proposals: Listed, id: string) =>
  Arr.findFirst(
    Arr.flatMap(batchesOf(proposals), (batch) =>
      Arr.map(batch.items, (item) => ({ batch, item }))
    ),
    ({ item }) => item.id === id
  )
);

/** Why an item in an open batch can't be changed, or nothing when it can. */
export const frozenRefusal: {
  (id: string): (proposals: Listed) => Option.Option<string>;
  (proposals: Listed, id: string): Option.Option<string>;
} = dual(2, (proposals: Listed, id: string): Option.Option<string> =>
  Option.flatMap(findBatchItem(proposals, id), ({ batch }) =>
    isOpenBatch(batch)
      ? Option.some(
          `"${id}" is in batch ${batch.number}, which is waiting for the agent. Edits go in the next batch.`
        )
      : Option.none()
  )
);

/** The result of freezing the open items. */
export interface Frozen {
  readonly proposals: Proposals;
  readonly batch: Batch;
}

const asItem = (note: Note): BatchItem => ({
  id: note.id,
  kind: "note",
  target: note.target,
  text: note.text,
});

/**
 * Moves every open layout change and note into a new batch, numbered one
 * more than the last, frozen at `at`. Items keep their ids. The file's
 * revision goes up by one. Fails when nothing is open.
 */
export const freezeOpen = ({
  proposals,
  at,
}: {
  readonly proposals: Proposals;
  /** When the batch is frozen, as an ISO date and time in UTC. */
  readonly at: string;
}): Result.Result<Frozen, string> => {
  if (openItemCount(proposals) === 0) {
    return Result.fail(
      "Nothing is ready for review. Add a note or move a structure first."
    );
  }

  const batch: Batch = {
    number: nextBatchNumber(proposals),
    frozenAt: at,
    items: [
      ...Arr.map(proposals.layout, (change): BatchItem => ({
        id: change.id,
        kind: "layout",
        change,
      })),
      ...Arr.map(proposals.notes ?? [], asItem),
    ],
    verdicts: {},
  };

  return Result.succeed({
    batch,
    proposals: {
      ...proposals,
      revision: proposals.revision + 1,
      layout: [],
      notes: [],
      batches: [...(proposals.batches ?? []), batch],
    },
  });
};

/**
 * Adds `note` to the open notes, where the next batch will pick it up.
 * Fails, and changes nothing, when its structure isn't in `known` or its id
 * is taken.
 */
export const addNote = ({
  proposals,
  note,
  known,
}: {
  readonly proposals: Proposals;
  readonly note: Note;
  /** The ids of the structures data.mjs has. */
  readonly known: ReadonlySet<string>;
}): Result.Result<Proposals, string> => {
  if (!known.has(note.target.id)) {
    return Result.fail(
      `No structure in data.mjs has the id "${note.target.id}", so a note can't be pinned to it.`
    );
  }

  const taken = Arr.some(
    reviewEntries(proposals),
    ({ item }) => item.id === note.id
  );

  if (taken) {
    return Result.fail(`The id "${note.id}" is already in use.`);
  }

  return Result.succeed({
    ...proposals,
    revision: proposals.revision + 1,
    notes: [...(proposals.notes ?? []), note],
  });
};

/**
 * Reopens rejected item `id` as a new open item `newId`, which lands in the
 * next batch. The new item starts as a copy of the rejected one, and
 * `replaces` links it back. The rejected item leaves the page, as a dismiss
 * would. A reopened layout change is checked against `layout`, the accepted
 * layout with the frozen changes applied. Fails, and changes nothing, when
 * `id` is not a rejected item in a committed batch, is already dismissed, or
 * `newId` is taken.
 */
export const reopenItem = ({
  proposals,
  id,
  newId,
  layout,
  text,
}: {
  readonly proposals: Proposals;
  readonly id: ChangeId;
  readonly newId: ChangeId;
  readonly layout: Layout;
  /** For a note, the words the new note starts with instead of the old ones. */
  readonly text?: string | undefined;
}): Result.Result<Proposals, string> => {
  const found = findBatchItem(proposals, id);

  if (Option.isNone(found)) {
    return Result.fail(`No reviewed item has the id "${id}".`);
  }

  const { batch, item } = found.value;
  const verdict = Rec.get(batch.verdicts, id);

  if (
    batch.committed === undefined ||
    !Option.exists(verdict, ({ verdict: kind }) => kind === "rejected")
  ) {
    return Result.fail(
      `"${id}" was not rejected, so there is nothing to edit again.`
    );
  }

  if ((batch.dismissed ?? []).includes(id)) {
    return Result.fail(`"${id}" is already dismissed.`);
  }

  if (Arr.some(reviewEntries(proposals), (entry) => entry.item.id === newId)) {
    return Result.fail(`The id "${newId}" is already in use.`);
  }

  const dismissed = dismissItem({ proposals, id });

  if (Result.isFailure(dismissed)) {
    return dismissed;
  }

  const base = {
    ...dismissed.success,
    replaces: { ...proposals.replaces, [newId]: id },
  };

  if (item.kind === "note") {
    return Result.succeed({
      ...base,
      notes: [
        ...(proposals.notes ?? []),
        { id: newId, target: item.target, text: text ?? item.text },
      ],
    });
  }

  const reopened: LayoutChange = { ...item.change, id: newId };

  const after = [...proposals.layout, reopened];

  const refusal = layoutRefusal({
    accepted: layout,
    before: proposals.layout,
    after,
  });

  return Option.match(refusal, {
    onNone: () => Result.succeed({ ...base, layout: after }),
    onSome: (why) => Result.fail(why),
  });
};

/** Why note `id` can't be found among the open notes. */
const noOpenNote = (proposals: Listed, id: string) =>
  Option.getOrElse(
    frozenRefusal(proposals, id),
    () => `No open note has the id "${id}". It may have been discarded already.`
  );

/**
 * Changes the text of open note `id`. Fails when the note is in a batch,
 * which is waiting for the agent, or isn't there.
 */
export const editNote = ({
  proposals,
  id,
  text,
}: {
  readonly proposals: Proposals;
  readonly id: ChangeId;
  readonly text: string;
}): Result.Result<Proposals, string> => {
  const notes = proposals.notes ?? [];

  if (!Arr.some(notes, (note) => note.id === id)) {
    return Result.fail(noOpenNote(proposals, id));
  }

  return Result.succeed({
    ...proposals,
    revision: proposals.revision + 1,
    notes: Arr.map(notes, (note) =>
      note.id === id ? { ...note, text } : note
    ),
  });
};

/** Removes open note `id`. Fails when it is in a batch, or isn't there. */
export const discardNote = ({
  proposals,
  id,
}: {
  readonly proposals: Proposals;
  readonly id: ChangeId;
}): Result.Result<Proposals, string> => {
  const notes = proposals.notes ?? [];

  if (!Arr.some(notes, (note) => note.id === id)) {
    return Result.fail(noOpenNote(proposals, id));
  }

  return Result.succeed({
    ...proposals,
    revision: proposals.revision + 1,
    notes: Arr.filter(notes, (note) => note.id !== id),
  });
};

/** What the agent can say about the items still without a verdict. */
export const withoutVerdict = (batch: Batch): readonly BatchItem[] =>
  Arr.filter(batch.items, ({ id }) => !Rec.has(batch.verdicts, id));

/**
 * Records `verdict` on item `id` in the oldest batch with no commit. Fails,
 * and changes nothing, when no batch is waiting, the item isn't in the oldest
 * one, or it is in a batch that was committed. A verdict can be given again
 * until the commit.
 */
export const recordVerdict = ({
  proposals,
  id,
  verdict,
}: {
  readonly proposals: Proposals;
  readonly id: string;
  readonly verdict: Verdict;
}): Result.Result<Proposals, string> => {
  const oldest = oldestOpenBatch(proposals);

  if (Option.isNone(oldest)) {
    return Result.fail(
      "No batch is waiting for a verdict. The engineer presses Ready for review to send one."
    );
  }

  const { number, items } = oldest.value;

  if (!Arr.some(items, (item) => item.id === id)) {
    const elsewhere = findBatchItem(proposals, id);

    return Result.fail(
      Option.match(elsewhere, {
        onNone: () =>
          `No item in batch ${number} has the id "${id}". Use one of: ${Arr.join(
            Arr.map(items, (item) => item.id),
            ", "
          )}.`,
        onSome: ({ batch }) =>
          batch.committed === undefined
            ? `"${id}" is in batch ${batch.number}, but batch ${number} is the oldest without a commit. Review and commit batch ${number} first.`
            : `"${id}" is in batch ${batch.number}, which was committed already.`,
      })
    );
  }

  const batches = Arr.map(proposals.batches ?? [], (batch) =>
    batch.number === number
      ? { ...batch, verdicts: { ...batch.verdicts, [id]: verdict } }
      : batch
  );

  return Result.succeed({
    ...proposals,
    revision: proposals.revision + 1,
    batches,
  });
};

/**
 * Why accepting `item` would break the map, or nothing when it wouldn't.
 * A layout change is checked against `layout` as the accepted layout. A note
 * needs its structure to be in the map.
 */
export const breakageOf = ({
  item,
  layout,
  structureIds,
}: {
  readonly item: BatchItem;
  readonly layout: Layout;
  readonly structureIds: ReadonlySet<string>;
}): Option.Option<string> => {
  if (item.kind === "layout") {
    return layoutRefusal({
      accepted: layout,
      before: [],
      after: [item.change],
    });
  }

  return structureIds.has(item.target.id)
    ? Option.none()
    : Option.some(
        `No structure in data.mjs has the id "${item.target.id}", so this note has nothing to point at.`
      );
};

/** What committing a batch makes. */
export interface Committing {
  readonly batch: Batch;
  /** `proposals.json` with the batch closed. */
  readonly proposals: Proposals;
  /** The accepted layout, with the accepted and changed layout changes applied. */
  readonly layout: Layout;
  readonly accepted: readonly AcceptedItem[];
  readonly rejected: readonly RejectedItem[];
}

const accepted = (item: BatchItem, verdict: Verdict): AcceptedItem => {
  const reason = "reason" in verdict ? verdict.reason : undefined;
  const changed = verdict.verdict === "changed";

  const base =
    item.kind === "layout"
      ? ({ kind: "layout", change: item.change } as const)
      : ({
          kind: "note",
          id: item.id,
          target: item.target,
          text: item.text,
        } as const);

  const withReason = reason === undefined ? base : { ...base, reason };

  return changed ? { ...withReason, changed: true } : withReason;
};

const rejected = (item: BatchItem, reason: string): RejectedItem =>
  item.kind === "layout"
    ? { kind: "layout", change: item.change, reason }
    : {
        kind: "note",
        id: item.id,
        target: item.target,
        text: item.text,
        reason,
      };

/**
 * Applies the oldest open batch with its verdicts to a map state. The
 * accepted and changed layout changes go into `layout`; every item goes into
 * the revision's accepted or rejected list with its reason; and the batch is
 * marked committed at `revision`. Fails, and changes nothing, when no batch
 * is waiting, an item has no verdict, or the accepted layout changes can't
 * all be applied, as `acceptLayoutChanges` says.
 */
export const commitBatch = ({
  proposals,
  layout,
  revision,
  at,
}: {
  readonly proposals: Proposals;
  readonly layout: Layout;
  /** The number of the revision this commit saves. */
  readonly revision: number;
  /** When the commit is made, as an ISO date and time in UTC. */
  readonly at: string;
}): Result.Result<Committing, string> => {
  const oldest = oldestOpenBatch(proposals);

  if (Option.isNone(oldest)) {
    return Result.fail("No batch is waiting to be committed.");
  }

  const batch = oldest.value;
  const missing = withoutVerdict(batch);

  if (missing.length > 0) {
    return Result.fail(
      `Batch ${batch.number} has ${missing.length} ${missing.length === 1 ? "item" : "items"} without a verdict: ${Arr.join(
        Arr.map(missing, ({ id }) => id),
        ", "
      )}. Give each one with axonometric verdict.`
    );
  }

  const decided = Arr.flatMap(batch.items, (item) =>
    Option.match(Rec.get(batch.verdicts, item.id), {
      onNone: () => [],
      onSome: (verdict) => [{ item, verdict }],
    })
  );

  const taken = Arr.filter(
    decided,
    ({ verdict }) => verdict.verdict !== "rejected"
  );

  const takenLayout = Arr.flatMap(taken, ({ item }) =>
    item.kind === "layout" ? [item.change] : []
  );

  const applied =
    takenLayout.length === 0
      ? Result.succeed(layout)
      : Result.map(
          acceptLayoutChanges({ layout, pending: takenLayout, ids: "all" }),
          (result) => result.layout
        );

  return Result.map(applied, (nextLayout): Committing => {
    const batches = Arr.map(proposals.batches ?? [], (other) =>
      other.number === batch.number
        ? { ...other, committed: { revision, at } }
        : other
    );

    return {
      batch,
      layout: nextLayout,
      proposals: {
        ...proposals,
        revision: proposals.revision + 1,
        batches,
      },
      accepted: Arr.map(taken, ({ item, verdict }) => accepted(item, verdict)),
      rejected: Arr.flatMap(decided, ({ item, verdict }) =>
        verdict.verdict === "rejected" ? [rejected(item, verdict.reason)] : []
      ),
    };
  });
};

/** The message a commit gets when the agent gives none. */
export const commitMessage = (batch: Batch): string => {
  const count = (kind: Verdict["verdict"]) =>
    Arr.filter(Rec.values(batch.verdicts), ({ verdict }) => verdict === kind)
      .length;

  return `Review of batch ${batch.number}: ${count("accepted")} accepted, ${count("changed")} changed, ${count("rejected")} rejected`;
};

/** Where an item is in its life. */
export type ItemStatus =
  | { readonly state: "open" }
  | { readonly state: "frozen"; readonly batch: number }
  | {
      readonly state: "reviewed";
      readonly batch: number;
      readonly verdict: Verdict;
      readonly dismissed: boolean;
    };

/** One item with its status, as the page lists it. */
export interface ReviewEntry {
  readonly item: BatchItem;
  readonly status: ItemStatus;
}

/**
 * Every item `proposals` holds with its status: the open layout changes and
 * notes first, then each batch's items in batch order. A batch with a commit
 * has its items "reviewed"; one without has them "frozen". Entries a
 * committed batch left without a verdict stay "frozen".
 */
export const reviewEntries = (proposals: Listed): readonly ReviewEntry[] => [
  ...Arr.map(proposals.layout, (change): ReviewEntry => ({
    item: { id: change.id, kind: "layout", change },
    status: { state: "open" },
  })),
  ...Arr.map(proposals.notes ?? [], (note): ReviewEntry => ({
    item: asItem(note),
    status: { state: "open" },
  })),
  ...Arr.flatMap(batchesOf(proposals), (batch) =>
    Arr.map(batch.items, (item): ReviewEntry => {
      const verdict = Rec.get(batch.verdicts, item.id);

      return {
        item,
        status:
          batch.committed !== undefined && Option.isSome(verdict)
            ? {
                state: "reviewed",
                batch: batch.number,
                verdict: verdict.value,
                dismissed: (batch.dismissed ?? []).includes(item.id),
              }
            : { state: "frozen", batch: batch.number },
      };
    })
  ),
];

/** The entries for notes that the page shows on the map and in panels. */
export const noteEntries = (
  proposals: Listed
): readonly (ReviewEntry & {
  readonly item: Extract<BatchItem, { kind: "note" }>;
})[] =>
  Arr.flatMap(reviewEntries(proposals), (entry) =>
    entry.item.kind === "note" &&
    !(entry.status.state === "reviewed" && entry.status.dismissed)
      ? [{ ...entry, item: entry.item }]
      : []
  );

/**
 * Takes item `id` off the page: marks it dismissed in its committed batch.
 * Fails when the item isn't in a committed batch, or is already dismissed.
 */
export const dismissItem = ({
  proposals,
  id,
}: {
  readonly proposals: Proposals;
  readonly id: ChangeId;
}): Result.Result<Proposals, string> => {
  const found = findBatchItem(proposals, id);

  if (Option.isNone(found)) {
    return Result.fail(`No reviewed item has the id "${id}".`);
  }

  const { batch } = found.value;

  if (batch.committed === undefined) {
    return Result.fail(
      `"${id}" is in batch ${batch.number}, which is waiting for the agent. It can be dismissed once the agent commits.`
    );
  }

  if ((batch.dismissed ?? []).includes(id)) {
    return Result.fail(`"${id}" is already dismissed.`);
  }

  return Result.succeed({
    ...proposals,
    revision: proposals.revision + 1,
    batches: Arr.map(proposals.batches ?? [], (other) =>
      other.number === batch.number
        ? { ...other, dismissed: [...(other.dismissed ?? []), id] }
        : other
    ),
  });
};

/** What a note's text becomes in a one-line summary: one line, and short. */
const oneLine = (text: string, limit: number) => {
  const flat = Arr.join(Str.split(/\s+/u)(Str.trim(text)), " ");

  return flat.length <= limit ? flat : `${Str.slice(0, limit - 1)(flat)}…`;
};

/** One line that says what an item is. */
export const summaryLine: {
  (nameOf: (id: string) => string): (item: BatchItem) => string;
  (item: BatchItem, nameOf: (id: string) => string): string;
} = dual(2, (item: BatchItem, nameOf: (id: string) => string): string => {
  if (item.kind === "note") {
    return `note ${item.id} on ${nameOf(item.target.id)}: "${oneLine(item.text, 80)}"`;
  }

  const names = Arr.join(Arr.map(structuresOf(item.change), nameOf), ", ");

  return `${item.change.kind} ${item.id}: ${names}`;
});

const needsQuotes = /[\s"'$`\\]/u;

const quoted = (path: string) =>
  needsQuotes.test(path)
    ? `"${Str.replaceAll('"', String.raw`\"`)(path)}"`
    : path;

/**
 * The prompt the engineer pastes into any agent harness. It names the skill,
 * the home folder and the batch, says the list is a summary and where the
 * details are, and gives one line per item.
 */
export const reviewPrompt = ({
  home,
  batch,
  nameOf,
}: {
  /** The absolute path of the home folder. */
  readonly home: string;
  readonly batch: Batch;
  readonly nameOf: (id: string) => string;
}): string =>
  Arr.join(
    [
      `Use the axonometric skill to review batch ${batch.number} of the map in ${home}.`,
      "",
      `This list is a summary. The full details are in ${home}/proposals.json.`,
      "",
      `Run axonometric review ${quoted(home)}, give every item a verdict with axonometric verdict, then run axonometric commit ${quoted(home)}.`,
      "",
      ...Arr.map(batch.items, (item) => `- ${summaryLine(item, nameOf)}`),
    ],
    "\n"
  );
