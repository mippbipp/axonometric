import { maxNoteLength } from "@axonometric/contracts";
import { Array as Arr, Option, Result } from "effect";
import { useState } from "react";

import { controlClass } from "./control-class.ts";
import { useEditOn } from "./edit-context.ts";
import { ItemStatusLine } from "./item-status.tsx";
import { NoteForm } from "./note-form.tsx";
import { entriesOfKind, useReview } from "./review-context.ts";
import { today } from "./today.ts";

/** Called when the answer to a discard is not needed: the page shows the new state itself. */
const noop = () => {};

/**
 * What the engineer can do with one open question: answer it. The answer
 * saves as a proposal with today's date. While one waits, it shows here with
 * its status, and an open one can be discarded. A rejected answer stays with
 * the agent's reason, and the question can be answered again.
 *
 * The agent records who answered when it folds the answer into data.mjs, so
 * the form doesn't ask.
 */
export function QuestionAnswer({
  question,
  structure,
}: {
  /** The question's id, such as Q-P1. */
  readonly question: string;
  /** The id of the structure the question is on. */
  readonly structure: string;
}) {
  const review = useReview();
  const [answering, setAnswering] = useState(false);

  if (review === null) {
    return null;
  }

  const answers = Arr.filter(
    entriesOfKind(review.entries, "answer"),
    ({ item }) => item.target.id === structure && item.question === question
  );

  const waiting = Arr.some(
    answers,
    ({ status }) => status.state !== "reviewed"
  );

  return (
    <div className="mt-1 flex flex-col gap-1.5" data-question-answer={question}>
      {Arr.map(answers, ({ item, status }) => (
        <div
          className="border-pending flex flex-col gap-1 border-l-2 pl-2"
          data-answer={item.id}
          data-answer-state={status.state}
          key={item.id}
        >
          <span className="block break-words">{item.text}</span>
          <span className="block opacity-70">Answered {item.answeredOn}</span>
          <ItemStatusLine status={status} />
          {status.state === "open" ? (
            <span>
              <button
                aria-label={`Discard answer: ${question}`}
                className={controlClass}
                data-answer-discard={item.id}
                disabled={!review.canWrite}
                onClick={() => {
                  review.ops.discardProposal(item.id, noop);
                }}
                type="button"
              >
                Discard
              </button>
            </span>
          ) : null}
        </div>
      ))}
      {answering ? (
        <NoteForm
          label={`Your answer to ${question}`}
          onCancel={() => {
            setAnswering(false);
          }}
          onSubmit={(text, done) => {
            review.ops.add(
              {
                answeredOn: today(),
                kind: "answer",
                question,
                structureId: structure,
                text,
              },
              (outcome) => {
                if (Result.isSuccess(outcome)) {
                  setAnswering(false);
                }

                done(Option.getOrUndefined(Result.getFailure(outcome)));
              }
            );
          }}
          placeholder="Write the answer…"
          submit="Save answer"
        />
      ) : null}
      {!answering && !waiting && review.canWrite ? (
        <span>
          <button
            aria-label={`${answers.length === 0 ? "Answer" : "Answer again"}: ${question}`}
            className={controlClass}
            data-answer-open={question}
            onClick={() => {
              setAnswering(true);
            }}
            type="button"
          >
            {answers.length === 0 ? "Answer" : "Answer again"}
          </button>
        </span>
      ) : null}
    </div>
  );
}

/**
 * The questions the engineer raised on a structure that are still on the
 * page, each with its status, and a form that raises another. The agent
 * assigns the question's id when it accepts it, so none shows here.
 */
export function RaisedQuestions({
  structure,
}: {
  /** The id of the structure. */
  readonly structure: string;
}) {
  const review = useReview();
  const editOn = useEditOn();

  if (review === null) {
    return null;
  }

  const raised = Arr.filter(
    entriesOfKind(review.entries, "question"),
    ({ item }) => item.target.id === structure
  );

  if (!editOn && raised.length === 0) {
    return null;
  }

  return (
    <section className="flex flex-col gap-2" data-raised-section>
      <h3 className="text-xs tracking-widest uppercase opacity-70">
        Raise a question
      </h3>
      {raised.length === 0 ? null : (
        <ul className="flex flex-col gap-2">
          {Arr.map(raised, ({ item, status }) => (
            <li
              className="border-pending flex flex-col gap-1 border-l-2 pl-2 text-sm"
              data-raised-question={item.id}
              data-raised-state={status.state}
              key={item.id}
            >
              <span className="break-words">{item.text}</span>
              <ItemStatusLine status={status} />
            </li>
          ))}
        </ul>
      )}
      {editOn && review.canWrite ? (
        <NoteForm
          hideLabel
          label="A new question about this"
          limit={maxNoteLength}
          onSubmit={(text, done) => {
            review.ops.add(
              { kind: "question", structureId: structure, text },
              (outcome) => {
                done(Option.getOrUndefined(Result.getFailure(outcome)));
              }
            );
          }}
          placeholder="Write the question as one sentence…"
          rows={2}
          submit="Raise question"
        />
      ) : null}
    </section>
  );
}
