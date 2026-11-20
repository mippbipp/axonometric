import {
  maxSuggestionLength,
  stepDetailField,
  stepNameField,
} from "@axonometric/contracts";
import type { Step, TextField } from "@axonometric/contracts";
import { Array as Arr, Option, Record as Rec, Result } from "effect";
import { useId, useState } from "react";

import { controlClass } from "./control-class.ts";
import { useEditOn } from "./edit-context.ts";
import { ItemStatusLine } from "./item-status.tsx";
import { useReview } from "./review-context.ts";
import {
  DiscardSuggestion,
  EditSuggestion,
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
  readonly found: Entry | undefined;
  readonly label: string;
  readonly text: string;
}

/**
 * The parts of a step the form changes: those with no suggestion waiting in a
 * batch. What the engineer typed for a part counts when it is not empty and
 * differs from the text and from the open suggestion.
 */
const changesOf = (
  parts: ReadonlyArray<Part>,
  values: Readonly<Record<string, string>>
) =>
  Arr.filter(parts, ({ field, found, text }) => {
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
  index,
  onDone,
  parts,
  structure,
}: {
  readonly index: number;
  readonly onDone: () => void;
  readonly parts: ReadonlyArray<Part>;
  readonly structure: string;
}) {
  const review = useReview();
  const id = useId();

  const [values, setValues] = useState<Readonly<Record<string, string>>>(() =>
    Rec.fromEntries(
      Arr.map(parts, ({ field, found, text }) => [
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
    { field, found, text }: Part,
    after: string,
    finish: (outcome: Result.Result<unknown, string>) => void
  ) => {
    const open = openOf(found);

    if (open === undefined) {
      review.ops.add(
        {
          after,
          before: text,
          field,
          kind: "suggestion",
          structureId: structure,
        },
        finish
      );
    } else {
      review.ops.editProposal(open.item.id, after, finish);
    }
  };

  const send = () => {
    const failures: Array<string> = [];
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
      className="flex flex-col gap-1.5"
      data-step-form={index}
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      {Arr.map(parts, ({ field, found, label }) => {
        const locked = !canSuggest(found);

        return (
          <div className="flex flex-col gap-1" key={field}>
            <label
              className="text-xs tracking-widest uppercase opacity-70"
              htmlFor={`${id}-${field}`}
            >
              Step {index + 1} {label}
            </label>
            {field === parts[0]?.field ? (
              <input
                className={inputClass}
                data-step-text={field}
                disabled={sending || locked}
                id={`${id}-${field}`}
                maxLength={maxSuggestionLength}
                onChange={(event) => {
                  setValues({ ...values, [field]: event.target.value });
                }}
                type="text"
                value={values[field] ?? ""}
              />
            ) : (
              <textarea
                className={inputClass}
                data-step-text={field}
                disabled={sending || locked}
                id={`${id}-${field}`}
                maxLength={maxSuggestionLength}
                onChange={(event) => {
                  setValues({ ...values, [field]: event.target.value });
                }}
                rows={3}
                value={values[field] ?? ""}
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
          className="border-refused border-l-2 pl-2 text-xs"
          data-step-failure
          role="alert"
        >
          {failure}
        </p>
      )}
      <div className="flex gap-1.5">
        <button
          className={controlClass}
          data-step-send
          disabled={sending || changes.length === 0}
          type="submit"
        >
          {sending ? "Saving…" : "Save suggestion"}
        </button>
        <button className={controlClass} onClick={onDone} type="button">
          Cancel
        </button>
      </div>
    </form>
  );
}

/**
 * The suggestion's own buttons, together inside its block: Edit, which opens
 * the step's form, and Discard. Nothing when the suggestion is not open.
 */
const suggestionButtons = (found: Entry | undefined, onEdit: () => void) => {
  const open = openOf(found);

  return open === undefined ? null : (
    <>
      <EditSuggestion entry={open} onEdit={onEdit} />
      <DiscardSuggestion entry={open} />
    </>
  );
};

/**
 * One step of a structure's inside view in the panel, with a single Edit that
 * opens both its name and its detail. Each part shows its own suggestion
 * beside the original, as `SuggestableText` does, and an open one has a
 * Discard of its own.
 */
export function SuggestableStep({
  index,
  step,
  structure,
}: {
  readonly index: number;
  readonly step: Step;
  /** The structure's id. */
  readonly structure: string;
}) {
  const review = useReview();
  const editOn = useEditOn();

  const nameFound = Option.getOrUndefined(
    useSuggestionFor(structure, stepNameField(index))
  );

  const detailFound = Option.getOrUndefined(
    useSuggestionFor(structure, stepDetailField(index))
  );

  const [opened, setOpened] = useState(false);
  const editing = opened && editOn;

  const parts: ReadonlyArray<Part> = [
    {
      field: stepNameField(index),
      found: nameFound,
      label: "name",
      text: step.name,
    },
    {
      field: stepDetailField(index),
      found: detailFound,
      label: "detail",
      text: step.detail,
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
    setOpened(true);
  };

  const editable = Arr.some(parts, ({ found }) => canSuggest(found));

  const again = Arr.some(
    parts,
    ({ found }) => found?.status.state === "reviewed" && !wasTaken(found.status)
  );

  const stepNumber = `step ${index + 1}`;

  const head = (
    <span className="flex items-baseline justify-between gap-2">
      <span>
        <span className="opacity-70">{index + 1}</span>{" "}
        <b className="font-medium">{step.name}</b>
      </span>
      {editOn && review.canWrite && !editing && editable ? (
        <StartButton
          again={again}
          field={stepNameField(index)}
          onStart={start}
          what={stepNumber}
        />
      ) : null}
    </span>
  );

  return (
    <span
      className="flex min-w-0 flex-col gap-1.5"
      data-suggestable-step={index}
    >
      {head}
      {editing ? (
        <StepForm
          index={index}
          onDone={() => {
            setOpened(false);
          }}
          parts={parts}
          structure={structure}
        />
      ) : (
        Arr.map(parts, ({ field, found, text }) =>
          // The heading already shows the name, so it gets a block of its own
          // only to show a suggestion or a verdict.
          field === parts[0]?.field && found === undefined ? null : (
            <span
              className="flex flex-col gap-1.5"
              data-suggestable={field}
              data-suggestion-state={found?.status.state ?? "none"}
              key={field}
            >
              {field === parts[0]?.field &&
              found !== undefined &&
              wasTaken(found.status) ? (
                <ItemStatusLine status={found.status} />
              ) : (
                <TextAndSuggestion
                  className={
                    field === parts[0]?.field ? "font-medium" : undefined
                  }
                  found={found}
                  text={text}
                >
                  {editOn ? suggestionButtons(found, start) : null}
                </TextAndSuggestion>
              )}
            </span>
          )
        )
      )}
    </span>
  );
}
