import {
  bySection,
  namesOf,
  sectionTitles,
  specOf,
} from "@axonometric/contracts";
import type {
  BatchItem,
  ReviewEntry,
  Section,
  Verdict,
} from "@axonometric/contracts";
import { Button } from "@axonometric/ui/components/button";
import { cn } from "@axonometric/ui/lib/utils";
import { Array as Arr, Match, Option, Record as Rec, Result } from "effect";
import { useState } from "react";

import { uiControlClass } from "./control-class.ts";
import { describeChange } from "./describe-change.ts";
import { useEditOn } from "./edit-context.ts";
import { useEditingIgnoringEdit } from "./editing-context.ts";
import { useExportState } from "./export-state-context.ts";
import { NoteForm } from "./note-form.tsx";
import { useProposedMapIgnoringEdit } from "./proposed-context.ts";
import { listedEntries, useReview } from "./review-context.ts";
import { useWalkthrough } from "./walkthrough-context.ts";

const verdictLabels = {
  accepted: "Accepted",
  changed: "Changed",
  rejected: "Rejected",
} as const;

/** The agent's verdict on an item, with its reason. */
export function VerdictBadge({
  batch,
  verdict,
}: {
  readonly batch: number;
  readonly verdict: Verdict;
}) {
  const reason = "reason" in verdict ? verdict.reason : null;

  return (
    <p
      className={cn(
        "border-l-2 pl-2 text-xs",
        verdict.verdict === "rejected" ? "border-refused" : "border-ink"
      )}
      data-verdict={verdict.verdict}
    >
      <b className="font-medium tracking-wider uppercase">
        {verdictLabels[verdict.verdict]}
      </b>
      <span className="opacity-70"> · batch {batch}</span>
      {reason === null ? null : (
        <span className="block break-words" data-verdict-reason>
          {reason}
        </span>
      )}
    </p>
  );
}

/** What an item is, in a few words. */
const useItemDescription = () => {
  const editing = useEditingIgnoringEdit();
  const proposed = useProposedMapIgnoringEdit();
  const { state } = useWalkthrough();
  const exported = useExportState();

  // A new group is on the proposed map under its title, and a rename names
  // the group as the accepted map has it now, so both are told apart. A
  // structure that is only proposed is named from the proposed map.
  const called = namesOf({
    accepted: (exported ?? state).data,
    shown: proposed?.state.data ?? state.data,
  });

  return (item: BatchItem): string => {
    const described = specOf(item).describe(item, called);

    if (Option.isSome(described)) {
      return described.value;
    }

    return editing === null || item.kind !== "layout"
      ? item.id
      : Arr.join(
          describeChange(item.change, editing.accepted, {
            hop: called.hop,
            structure: called.structure,
          }),
          "; "
        );
  };
};

/** What an item does, such as "group" for a structure's group change, or nothing. */
const actionOf = (item: BatchItem): string | undefined =>
  item.kind === "structure" || item.kind === "group" || item.kind === "chapter"
    ? item.change.action
    : undefined;

/** The failure text of an outcome, or `undefined` when it worked. */
const failureOf = <A,>(outcome: Result.Result<A, string>) =>
  Option.getOrUndefined(Result.getFailure(outcome));

/**
 * Whether the open item can be discarded here. An answer is part of reading,
 * so it can be with Edit off; the other kinds, and layout changes, which the
 * list above discards, need Edit.
 */
const canDiscard = (item: BatchItem, editOn: boolean): boolean =>
  item.kind !== "layout" && (editOn || item.kind === "answer");

/** One item with its status and the buttons that fit it. */
function ReviewRow({ entry }: { readonly entry: ReviewEntry }) {
  const review = useReview();
  const editOn = useEditOn();
  const describe = useItemDescription();
  const [editing, setEditing] = useState(false);
  const [failure, setFailure] = useState<string | undefined>();

  if (review === null) {
    return null;
  }

  const { item, status } = entry;
  const reopenedFrom = Option.getOrNull(Rec.get(review.replaces, item.id));

  const isRejected =
    status.state === "reviewed" && status.verdict.verdict === "rejected";

  const text = Option.getOrUndefined(specOf(item).text(item));

  const reopen = () => {
    if (text !== undefined) {
      setEditing(true);

      return;
    }

    review.ops.reopen(item.id, undefined, (outcome) => {
      setFailure(failureOf(outcome));
    });
  };

  return (
    <li
      className="border-pending flex flex-col gap-1.5 border-l-2 pl-2 text-sm"
      data-review-action={actionOf(item)}
      data-review-item={item.id}
      data-review-kind={item.kind}
      data-review-state={status.state}
    >
      <span className="min-w-0 break-words">{describe(item)}</span>
      {reopenedFrom === null ? null : (
        <span className="text-xs opacity-70" data-reopened-from={reopenedFrom}>
          Edited again after a rejection.
        </span>
      )}
      {Match.value(status).pipe(
        Match.when({ state: "open" }, () => (
          <span className="text-xs opacity-70">
            Open. It goes in the next batch.
          </span>
        )),
        Match.when({ state: "frozen" }, ({ batch }) => (
          <span className="text-xs opacity-70" data-waiting-for-agent>
            In batch {batch}, waiting for the agent. It can&rsquo;t change until
            the agent commits.
          </span>
        )),
        Match.when({ state: "reviewed" }, ({ batch, verdict }) => (
          <VerdictBadge batch={batch} verdict={verdict} />
        )),
        Match.exhaustive
      )}
      {failure === undefined ? null : (
        <span
          className="border-refused border-l-2 pl-2 text-xs"
          data-review-failure
        >
          {failure}
        </span>
      )}
      {editing && text !== undefined ? (
        <NoteForm
          initial={text}
          label="Your text, edited again"
          limit={specOf(item).textLimit}
          onCancel={() => {
            setEditing(false);
          }}
          onSubmit={(next, done) => {
            review.ops.reopen(item.id, next, (outcome) => {
              if (Result.isSuccess(outcome)) {
                setEditing(false);
              }

              done(failureOf(outcome));
            });
          }}
          submit="Send in next batch"
        />
      ) : (
        <span className="flex flex-wrap gap-1.5">
          {status.state === "open" && canDiscard(item, editOn) ? (
            <Button
              className={uiControlClass}
              disabled={!review.canWrite}
              onClick={() => {
                review.ops.discardProposal(item.id, (outcome) => {
                  setFailure(failureOf(outcome));
                });
              }}
            >
              Discard
            </Button>
          ) : null}
          {editOn && isRejected ? (
            <Button
              className={uiControlClass}
              data-reopen={item.id}
              disabled={!review.canWrite}
              onClick={reopen}
            >
              Edit again
            </Button>
          ) : null}
          {editOn && status.state === "reviewed" ? (
            <Button
              className={uiControlClass}
              data-dismiss={item.id}
              disabled={!review.canWrite}
              onClick={() => {
                review.ops.dismiss(item.id, (outcome) => {
                  setFailure(failureOf(outcome));
                });
              }}
            >
              Dismiss
            </Button>
          ) : null}
        </span>
      )}
    </li>
  );
}

/**
 * The proposals for the agent, in the Pending tab: the open notes,
 * suggestions, answers and questions, the items waiting in a batch, and the
 * reviewed ones with the agent's verdict and reason. Diagram changes and
 * chapter changes are listed in sections of their own, as the prompt and
 * `review` list them.
 */
export function ReviewList() {
  const review = useReview();

  if (review === null) {
    return null;
  }

  const entries = listedEntries(review.entries);

  if (entries.length === 0) {
    return null;
  }

  const sections = bySection(Arr.map(entries, ({ item }) => item));

  return (
    <>
      {Arr.map(sections, ({ items, section }) => (
        <ReviewSection
          entries={Arr.filter(entries, ({ item }) =>
            items.some((held) => held.id === item.id)
          )}
          key={section}
          section={section}
        />
      ))}
    </>
  );
}

/** One section of the review list: a heading and its rows. */
function ReviewSection({
  entries,
  section,
}: {
  readonly entries: ReadonlyArray<ReviewEntry>;
  readonly section: Section;
}) {
  return (
    <section
      className="flex flex-col gap-2"
      data-review-list
      data-review-section={section}
    >
      <h3 className="text-xs tracking-widest uppercase opacity-70">
        {sectionTitles[section]}
      </h3>
      <ul className="flex flex-col gap-2">
        {Arr.map(entries, (entry) => (
          <ReviewRow entry={entry} key={entry.item.id} />
        ))}
      </ul>
    </section>
  );
}
