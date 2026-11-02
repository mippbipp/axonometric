import { fieldLabel, maxSuggestionLength } from "@axonometric/contracts";
import type { TextField } from "@axonometric/contracts";
import { cn } from "@axonometric/ui/lib/utils";
import { Option, Result } from "effect";
import { useState } from "react";
import type { ReactNode } from "react";

import { ItemStatusLine } from "./item-status.tsx";
import { NoteForm } from "./note-form.tsx";
import { useReview } from "./review-context.ts";
import { smallButton } from "./small-button.ts";
import {
  canSuggest,
  openOf,
  useSuggestionFor,
  wasTaken,
} from "./suggestions.ts";
import type { Entry } from "./suggestions.ts";

/** Called when the answer to a write is not needed: the page shows the new state itself. */
const noop = () => {};

const labelClass = "text-2xs tracking-widest uppercase opacity-70";

/** The button that discards an open suggestion. */
export function DiscardSuggestion({ entry }: { readonly entry: Entry }) {
  const review = useReview();

  return (
    <button
      type="button"
      data-suggestion-discard={entry.item.field}
      className={smallButton}
      aria-label={`Discard suggestion: ${fieldLabel(entry.item.field)}`}
      disabled={review?.canWrite !== true}
      onClick={() => {
        review?.ops.discardProposal(entry.item.id, noop);
      }}
    >
      Discard
    </button>
  );
}

/** The button that opens an open suggestion to edit it again. */
export function EditSuggestion({
  entry,
  onEdit,
}: {
  readonly entry: Entry;
  readonly onEdit: () => void;
}) {
  const review = useReview();

  return (
    <button
      type="button"
      data-suggestion-edit={entry.item.field}
      className={smallButton}
      aria-label={`Edit suggestion: ${fieldLabel(entry.item.field)}`}
      disabled={review?.canWrite !== true}
      onClick={onEdit}
    >
      Edit
    </button>
  );
}

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
          review.ops.add(
            {
              kind: "suggestion",
              structureId: structure,
              field,
              before: text,
              after: next,
            },
            finish(done)
          );
        } else {
          review.ops.editProposal(open.item.id, next, finish(done));
        }
      }}
      onCancel={onDone}
    />
  );
}

/**
 * A suggestion shown beside the original: its new text, whether the original
 * has changed since, its status, and `children` while it is open, which are
 * the buttons that change or discard it. A suggestion waiting in a batch has
 * none, since it belongs to the agent until the commit.
 */
function SuggestionBeside({
  entry,
  text,
  className,
  children,
}: {
  readonly entry: Entry;
  /** The text as data.mjs has it. */
  readonly text: string;
  readonly className: string | undefined;
  readonly children?: ReactNode;
}) {
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
      {status.state === "open" ? (
        <span className="flex gap-1.5">{children}</span>
      ) : null}
    </div>
  );
}

/**
 * The text with, when there is one, the suggestion beside it, the original
 * marked as current. `children` are the buttons for an open suggestion.
 */
export function TextAndSuggestion({
  found,
  text,
  className,
  children,
}: {
  readonly found: Entry | undefined;
  /** The text as data.mjs has it. */
  readonly text: string;
  readonly className: string | undefined;
  readonly children?: ReactNode;
}) {
  if (found === undefined) {
    return <p className={className}>{text}</p>;
  }

  if (wasTaken(found.status)) {
    return (
      <>
        <p className={className}>{text}</p>
        <ItemStatusLine status={found.status} />
      </>
    );
  }

  return (
    <>
      <div data-current className="flex flex-col gap-0.5">
        <span className={labelClass}>Current</span>
        <p className={className}>{text}</p>
      </div>
      <SuggestionBeside entry={found} text={text} className={className}>
        {children}
      </SuggestionBeside>
    </>
  );
}

/**
 * The button that starts a suggestion for `what`, such as "the one-liner" or
 * "step 2": Edit, or Suggest again after the agent turned one down.
 */
export function StartButton({
  field,
  what,
  again,
  onStart,
}: {
  /** The field it starts, or the step's name field for a whole step. */
  readonly field: TextField;
  readonly what: string;
  /** Whether the text was suggested before, and the agent turned that down. */
  readonly again: boolean;
  readonly onStart: () => void;
}) {
  const label = again ? "Suggest again" : "Edit";

  return (
    <span>
      <button
        type="button"
        data-suggest={field}
        className={smallButton}
        aria-label={`${label}: ${what}`}
        onClick={onStart}
      >
        {label}
      </button>
    </span>
  );
}

/**
 * One text of a structure that the engineer can edit in place: its one-liner,
 * what it does or how it's built. (A step's two texts are edited together, by
 * `SuggestableStep`.) Pressing Edit opens the text in a box; saving makes a
 * text suggestion, and the page shows it next to the original, which is
 * marked as current, until the agent has its say.
 *
 * - An open suggestion can be edited again or discarded here.
 * - One waiting in a batch shows as waiting on the agent, with no button.
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

  const open = openOf(found);

  const start = () => {
    setEditing(true);
  };

  return (
    <div
      data-suggestable={field}
      data-suggestion-state={found?.status.state ?? "none"}
      className="flex flex-col gap-1.5"
    >
      {editing ? (
        <>
          <p className={className}>{text}</p>
          <SuggestionForm
            structure={structure}
            field={field}
            text={text}
            open={open}
            onDone={() => {
              setEditing(false);
            }}
          />
        </>
      ) : (
        <TextAndSuggestion found={found} text={text} className={className}>
          {open === undefined ? null : (
            <>
              <EditSuggestion entry={open} onEdit={start} />
              <DiscardSuggestion entry={open} />
            </>
          )}
        </TextAndSuggestion>
      )}
      {review.canWrite &&
      !editing &&
      open === undefined &&
      canSuggest(found) ? (
        <StartButton
          field={field}
          what={fieldLabel(field)}
          again={found !== undefined && !wasTaken(found.status)}
          onStart={start}
        />
      ) : null}
    </div>
  );
}
