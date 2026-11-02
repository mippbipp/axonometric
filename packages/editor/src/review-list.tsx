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
import { cn } from "@axonometric/ui/lib/utils";
import { Array as Arr, Match, Option, Record as Rec, Result } from "effect";
import { useState } from "react";

import { controlClass } from "./control-class.ts";
import { describeChange } from "./describe-change.ts";
import { useEditing } from "./editing-context.ts";
import { useExportState } from "./export-state-context.ts";
import { NoteForm } from "./note-form.tsx";
import { useProposed } from "./proposed-context.ts";
import { listedEntries, useReview } from "./review-context.ts";
import { useWalkthrough } from "./walkthrough-context.ts";

const verdictLabels = {
  accepted: "Accepted",
  changed: "Changed",
  rejected: "Rejected",
} as const;

/** The agent's verdict on an item, with its reason. */
export function VerdictBadge({
  verdict,
  batch,
}: {
  readonly verdict: Verdict;
  readonly batch: number;
}) {
  const reason = "reason" in verdict ? verdict.reason : null;

  return (
    <p
      data-verdict={verdict.verdict}
      className={cn(
        "border-l-2 pl-2 text-xs",
        verdict.verdict === "rejected" ? "border-refused" : "border-ink"
      )}
    >
      <b className="font-medium tracking-wider uppercase">
        {verdictLabels[verdict.verdict]}
      </b>
      <span className="opacity-70"> · batch {batch}</span>
      {reason === null ? null : (
        <span data-verdict-reason className="block break-words">
          {reason}
        </span>
      )}
    </p>
  );
}

/** What an item is, in a few words. */
const useItemDescription = () => {
  const editing = useEditing();
  const proposed = useProposed();
  const { state } = useWalkthrough();
  const exported = useExportState();

  // A new group is on the proposed map under its title, and a rename names
  // the group as the accepted map has it now, so both are told apart. A
  // structure that is only proposed is named from the proposed map.
  const called = namesOf({
    shown: proposed?.proposed.state.data ?? state.data,
    accepted: (exported ?? state).data,
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
            structure: called.structure,
            hop: called.hop,
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

/** One item with its status and the buttons that fit it. */
function ReviewRow({ entry }: { readonly entry: ReviewEntry }) {
  const review = useReview();
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
      data-review-item={item.id}
      data-review-kind={item.kind}
      data-review-action={actionOf(item)}
      data-review-state={status.state}
      className="border-pending flex flex-col gap-1.5 border-l-2 pl-2 text-sm"
    >
      <span className="min-w-0 break-words">{describe(item)}</span>
      {reopenedFrom === null ? null : (
        <span data-reopened-from={reopenedFrom} className="text-xs opacity-70">
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
          <span data-waiting-for-agent className="text-xs opacity-70">
            In batch {batch}, waiting for the agent. It can&rsquo;t change until
            the agent commits.
          </span>
        )),
        Match.when({ state: "reviewed" }, ({ verdict, batch }) => (
          <VerdictBadge verdict={verdict} batch={batch} />
        )),
        Match.exhaustive
      )}
      {failure === undefined ? null : (
        <span
          data-review-failure
          className="border-refused border-l-2 pl-2 text-xs"
        >
          {failure}
        </span>
      )}
      {editing && text !== undefined ? (
        <NoteForm
          label="Your text, edited again"
          initial={text}
          limit={specOf(item).textLimit}
          submit="Send in next batch"
          onSubmit={(next, done) => {
            review.ops.reopen(item.id, next, (outcome) => {
              if (Result.isSuccess(outcome)) {
                setEditing(false);
              }

              done(failureOf(outcome));
            });
          }}
          onCancel={() => {
            setEditing(false);
          }}
        />
      ) : (
        <span className="flex flex-wrap gap-1.5">
          {status.state === "open" && item.kind !== "layout" ? (
            <button
              type="button"
              className={controlClass}
              disabled={!review.canWrite}
              onClick={() => {
                review.ops.discardProposal(item.id, (outcome) => {
                  setFailure(failureOf(outcome));
                });
              }}
            >
              Discard
            </button>
          ) : null}
          {isRejected ? (
            <button
              type="button"
              data-reopen={item.id}
              className={controlClass}
              disabled={!review.canWrite}
              onClick={reopen}
            >
              Edit again
            </button>
          ) : null}
          {status.state === "reviewed" ? (
            <button
              type="button"
              data-dismiss={item.id}
              className={controlClass}
              disabled={!review.canWrite}
              onClick={() => {
                review.ops.dismiss(item.id, (outcome) => {
                  setFailure(failureOf(outcome));
                });
              }}
            >
              Dismiss
            </button>
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
      {Arr.map(sections, ({ section, items }) => (
        <ReviewSection
          key={section}
          section={section}
          entries={Arr.filter(entries, ({ item }) =>
            items.some((held) => held.id === item.id)
          )}
        />
      ))}
    </>
  );
}

/** One section of the review list: a heading and its rows. */
function ReviewSection({
  section,
  entries,
}: {
  readonly section: Section;
  readonly entries: readonly ReviewEntry[];
}) {
  return (
    <section
      data-review-list
      data-review-section={section}
      className="flex flex-col gap-2"
    >
      <h3 className="text-xs tracking-widest uppercase opacity-70">
        {sectionTitles[section]}
      </h3>
      <ul className="flex flex-col gap-2">
        {Arr.map(entries, (entry) => (
          <ReviewRow key={entry.item.id} entry={entry} />
        ))}
      </ul>
    </section>
  );
}
