import { fieldLabel, maxSuggestionLength } from "@axonometric/contracts";
import type { ItemStatus, TextField } from "@axonometric/contracts";
import { cn } from "@axonometric/ui/lib/utils";
import { Array as Arr, Option, Result } from "effect";
import { useState } from "react";

import { controlClass } from "./control-class.ts";
import { ItemStatusLine } from "./item-status.tsx";
import { NoteForm } from "./note-form.tsx";
import { entriesOfKind, useReview } from "./review-context.ts";
import type { KindEntry } from "./review-context.ts";

/** Called when the answer to a discard is not needed: the page shows the new state itself. */
const noop = () => {};

const smallButton = cn(controlClass, "text-2xs px-1 py-0");

const labelClass = "text-2xs tracking-widest uppercase opacity-70";

type Entry = KindEntry<"suggestion">;

/** Whether the agent took the suggestion, so data.mjs says it now. */
const wasTaken = (status: ItemStatus) =>
  status.state === "reviewed" && status.verdict.verdict !== "rejected";

/**
 * The suggestion for `field` of `structure` that the page shows: the one
 * waiting on the agent if there is one, else the latest reviewed.
 */
const useSuggestionFor = (
  structure: string,
  field: TextField
): Option.Option<Entry> => {
  const entries = useReview()?.entries ?? [];

  const mine = Arr.filter(
    entriesOfKind(entries, "suggestion"),
    ({ item }) => item.target.id === structure && item.field === field
  );

  return Option.orElse(
    Arr.findFirst(mine, ({ status }) => status.state !== "reviewed"),
    () => Arr.last(mine)
  );
};

/** The box a suggestion is written in, for a new one or an open one edited again. */
function SuggestionForm({
  structure,
  field,
  text,
  open,
  onDone,
}: {
  readonly structure: string;
  readonly field: TextField;
  /** The text as data.mjs has it. */
  readonly text: string;
  /** The open suggestion being edited again, if any. */
  readonly open: Entry | undefined;
  readonly onDone: () => void;
}) {
  const review = useReview();

  if (review === null) {
    return null;
  }

  const finish =
    (done: (failure: string | undefined) => void) =>
    (outcome: Result.Result<unknown, string>) => {
      if (Result.isSuccess(outcome)) {
        onDone();
      }

      done(Option.getOrUndefined(Result.getFailure(outcome)));
    };

  return (
    <NoteForm
      label={`Your suggestion for the ${fieldLabel(field)}`}
      initial={open?.item.after ?? text}
      submit={open === undefined ? "Suggest this" : "Save suggestion"}
      placeholder="Write the text as you'd like it to read…"
      limit={maxSuggestionLength}
      rows={4}
      canSend={(next) => next !== text && next !== open?.item.after}
      onSubmit={(next, done) => {
        if (open === undefined) {
          review.ops.addSuggestion(
            { structureId: structure, field, before: text, after: next },
            finish(done)
          );
        } else {
          review.ops.editNote(open.item.id, next, finish(done));
        }
      }}
      onCancel={onDone}
    />
  );
}

/** A suggestion shown beside the original: its new text, status and buttons. */
function SuggestionBeside({
  entry,
  text,
  className,
  onEdit,
}: {
  readonly entry: Entry;
  /** The text as data.mjs has it. */
  readonly text: string;
  readonly className: string | undefined;
  readonly onEdit: () => void;
}) {
  const review = useReview();
  const { item, status } = entry;

  return (
    <div
      data-suggested
      className="border-pending flex flex-col gap-1 border-l-2 pl-2"
    >
      <span className={labelClass}>Suggested</span>
      <p className={cn(className, "break-words")}>{item.after}</p>
      {item.before === text ? null : (
        <span data-original-changed className="text-xs">
          The current text has changed since you wrote this.
        </span>
      )}
      <ItemStatusLine status={status} />
      {status.state === "open" && review !== null ? (
        <span className="flex gap-1.5">
          <button
            type="button"
            data-suggestion-edit={item.field}
            className={smallButton}
            disabled={!review.canWrite}
            onClick={onEdit}
          >
            Edit
          </button>
          <button
            type="button"
            data-suggestion-discard={item.field}
            className={smallButton}
            disabled={!review.canWrite}
            onClick={() => {
              review.ops.discardNote(item.id, noop);
            }}
          >
            Discard
          </button>
        </span>
      ) : null}
    </div>
  );
}

/**
 * One text of a structure that the engineer can edit in place: its one-liner,
 * what it does, how it's built, or a part of a step. Pressing Edit opens the
 * text in a box; saving makes a text suggestion, and the page shows it next
 * to the original, which is marked as current, until the agent has its say.
 *
 * - An open suggestion can be edited again or discarded here.
 * - One waiting in a batch shows as waiting.
 * - A rejected one stays next to the text with the agent's reason, and the
 *   text can be suggested again.
 * - One the agent took shows as the text with the verdict, since data.mjs
 *   says it now.
 *
 * On a page that can't write, this is just the text.
 */
export function SuggestableText({
  structure,
  field,
  text,
  className,
}: {
  /** The structure's id. */
  readonly structure: string;
  readonly field: TextField;
  /** The text as data.mjs has it. */
  readonly text: string;
  /** How the text is set. */
  readonly className?: string;
}) {
  const review = useReview();
  const found = Option.getOrUndefined(useSuggestionFor(structure, field));
  const [editing, setEditing] = useState(false);

  if (review === null) {
    return <p className={className}>{text}</p>;
  }

  const taken = found !== undefined && wasTaken(found.status);
  const beside = found !== undefined && !taken;
  const open = found?.status.state === "open" ? found : undefined;
  const canStart = review.canWrite && !editing && open === undefined;
  const startLabel = beside ? "Suggest again" : "Edit";

  return (
    <div
      data-suggestable={field}
      data-suggestion-state={found?.status.state ?? "none"}
      className="flex flex-col gap-1.5"
    >
      {beside ? (
        <div data-current className="flex flex-col gap-0.5">
          <span className={labelClass}>Current</span>
          <p className={className}>{text}</p>
        </div>
      ) : (
        <p className={className}>{text}</p>
      )}
      {beside && !editing ? (
        <SuggestionBeside
          entry={found}
          text={text}
          className={className}
          onEdit={() => {
            setEditing(true);
          }}
        />
      ) : null}
      {taken && !editing ? <ItemStatusLine status={found.status} /> : null}
      {editing ? (
        <SuggestionForm
          structure={structure}
          field={field}
          text={text}
          open={open}
          onDone={() => {
            setEditing(false);
          }}
        />
      ) : null}
      {canStart ? (
        <span>
          <button
            type="button"
            data-suggest={field}
            className={smallButton}
            aria-label={`${startLabel}: ${fieldLabel(field)}`}
            onClick={() => {
              setEditing(true);
            }}
          >
            {startLabel}
          </button>
        </span>
      ) : null}
    </div>
  );
}
