import {
  maxSuggestionLength,
  stepDetailField,
  stepNameField,
} from "@axonometric/contracts";
import type { Step, TextField } from "@axonometric/contracts";
import { Array as Arr, Option, Record as Rec, Result } from "effect";
import { useId, useState } from "react";

import { controlClass } from "./control-class.ts";
import { useReview } from "./review-context.ts";
import {
  DiscardSuggestion,
  StartButton,
  TextAndSuggestion,
} from "./suggestable-text.tsx";
import {
  canSuggest,
  openOf,
  useSuggestionFor,
  wasTaken,
} from "./suggestions.ts";
import type { Entry } from "./suggestions.ts";

const inputClass =
  "border-ink bg-paper text-ink focus-visible:outline-ink w-full border px-2 py-1 text-xs focus-visible:outline-2 focus-visible:outline-offset-1 disabled:opacity-50";

/** One part of a step: its field, the text data.mjs has, and the suggestion for it. */
interface Part {
  readonly field: TextField;
  readonly label: string;
  readonly text: string;
  readonly found: Entry | undefined;
}

/**
 * The parts of a step the form changes: those with no suggestion waiting in a
 * batch. What the engineer typed for a part counts when it is not empty and
 * differs from the text and from the open suggestion.
 */
const changesOf = (
  parts: readonly Part[],
  values: Readonly<Record<string, string>>
) =>
  Arr.filter(parts, ({ field, text, found }) => {
    const value = (values[field] ?? "").trim();

    return (
      canSuggest(found) &&
      value !== "" &&
      value !== text &&
      value !== openOf(found)?.item.after
    );
  });

/**
 * The form for both texts of one step. The name is a line and the detail a
 * box; each starts from the text, or from the engineer's open suggestion. A
 * part with a suggestion waiting in a batch is shown but locked. Saving sends
 * one suggestion for each part that changed.
 */
function StepForm({
  structure,
  parts,
  index,
  onDone,
}: {
  readonly structure: string;
  readonly parts: readonly Part[];
  readonly index: number;
  readonly onDone: () => void;
}) {
  const review = useReview();
  const id = useId();

  const [values, setValues] = useState<Readonly<Record<string, string>>>(() =>
    Rec.fromEntries(
      Arr.map(parts, ({ field, text, found }) => [
        field,
        openOf(found)?.item.after ?? text,
      ])
    )
  );

  const [failure, setFailure] = useState<string | undefined>();
  const [sending, setSending] = useState(false);

  if (review === null) {
    return null;
  }

  const changes = changesOf(parts, values);

  /** Sends one part's suggestion, new or edited again, and says how it ended. */
  const sendPart = (
    { field, text, found }: Part,
    after: string,
    finish: (outcome: Result.Result<unknown, string>) => void
  ) => {
    const open = openOf(found);

    if (open === undefined) {
      review.ops.add(
        {
          kind: "suggestion",
          structureId: structure,
          field,
          before: text,
          after,
        },
        finish
      );
    } else {
      review.ops.editProposal(open.item.id, after, finish);
    }
  };

  const send = () => {
    const failures: string[] = [];
    let left = changes.length;

    setSending(true);

    const finish = (outcome: Result.Result<unknown, string>) => {
      left -= 1;

      if (Result.isFailure(outcome)) {
        failures.push(outcome.failure);
      }

      if (left === 0) {
        setSending(false);
        setFailure(failures[0]);

        if (failures.length === 0) {
          onDone();
        }
      }
    };

    // The writes queue behind each other in the store, so they all start now.
    Arr.forEach(changes, (part) => {
      sendPart(part, (values[part.field] ?? "").trim(), finish);
    });
  };

  return (
    <form
      data-step-form={index}
      className="flex flex-col gap-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      {Arr.map(parts, ({ field, label, found }) => {
        const locked = !canSuggest(found);

        return (
          <div key={field} className="flex flex-col gap-1">
            <label
              htmlFor={`${id}-${field}`}
              className="text-xs tracking-widest uppercase opacity-70"
            >
              Step {index + 1} {label}
            </label>
            {field === parts[0]?.field ? (
              <input
                id={`${id}-${field}`}
                data-step-text={field}
                type="text"
                value={values[field] ?? ""}
                maxLength={maxSuggestionLength}
                disabled={sending || locked}
                className={inputClass}
                onChange={(event) => {
                  setValues({ ...values, [field]: event.target.value });
                }}
              />
            ) : (
              <textarea
                id={`${id}-${field}`}
                data-step-text={field}
                rows={3}
                value={values[field] ?? ""}
                maxLength={maxSuggestionLength}
                disabled={sending || locked}
                className={inputClass}
                onChange={(event) => {
                  setValues({ ...values, [field]: event.target.value });
                }}
              />
            )}
            {locked ? (
              <span className="text-xs opacity-70">
                A suggestion for this is in a batch, waiting for the agent.
              </span>
            ) : null}
          </div>
        );
      })}
      {failure === undefined ? null : (
        <p
          role="alert"
          data-step-failure
          className="border-refused border-l-2 pl-2 text-xs"
        >
          {failure}
        </p>
      )}
      <div className="flex gap-1.5">
        <button
          type="submit"
          data-step-send
          className={controlClass}
          disabled={sending || changes.length === 0}
        >
          {sending ? "Saving…" : "Save suggestion"}
        </button>
        <button type="button" className={controlClass} onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** The Discard of an open suggestion, or nothing when there is none to discard. */
const discardFor = (found: Entry | undefined) => {
  const open = openOf(found);

  return open === undefined ? null : <DiscardSuggestion entry={open} />;
};

/**
 * One step of a structure's inside view in the panel, with a single Edit that
 * opens both its name and its detail. Each part shows its own suggestion
 * beside the original, as `SuggestableText` does, and an open one has a
 * Discard of its own.
 */
export function SuggestableStep({
  structure,
  index,
  step,
}: {
  /** The structure's id. */
  readonly structure: string;
  readonly index: number;
  readonly step: Step;
}) {
  const review = useReview();

  const nameFound = Option.getOrUndefined(
    useSuggestionFor(structure, stepNameField(index))
  );

  const detailFound = Option.getOrUndefined(
    useSuggestionFor(structure, stepDetailField(index))
  );

  const [editing, setEditing] = useState(false);

  const parts: readonly Part[] = [
    {
      field: stepNameField(index),
      label: "name",
      text: step.name,
      found: nameFound,
    },
    {
      field: stepDetailField(index),
      label: "detail",
      text: step.detail,
      found: detailFound,
    },
  ];

  if (review === null) {
    return (
      <span>
        <b className="font-medium">{step.name}.</b> {step.detail}
      </span>
    );
  }

  const start = () => {
    setEditing(true);
  };

  const editable = Arr.some(parts, ({ found }) => canSuggest(found));

  const again = Arr.some(
    parts,
    ({ found }) => found?.status.state === "reviewed" && !wasTaken(found.status)
  );

  return (
    <span
      data-suggestable-step={index}
      className="flex min-w-0 flex-col gap-1.5"
    >
      {editing ? (
        <>
          <span>
            <b className="font-medium">{step.name}.</b> {step.detail}
          </span>
          <StepForm
            structure={structure}
            parts={parts}
            index={index}
            onDone={() => {
              setEditing(false);
            }}
          />
        </>
      ) : (
        Arr.map(parts, ({ field, text, found }) => (
          <span
            key={field}
            data-suggestable={field}
            data-suggestion-state={found?.status.state ?? "none"}
            className="flex flex-col gap-1.5"
          >
            <TextAndSuggestion
              found={found}
              text={text}
              className={field === parts[0]?.field ? "font-medium" : undefined}
            >
              {discardFor(found)}
            </TextAndSuggestion>
          </span>
        ))
      )}
      {review.canWrite && !editing && editable ? (
        <StartButton
          field={stepNameField(index)}
          what={`step ${index + 1}`}
          again={again}
          onStart={start}
        />
      ) : null}
    </span>
  );
}
