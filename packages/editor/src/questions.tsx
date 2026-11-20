import type { Question, ResolvedQuestion } from "@axonometric/contracts";
import { Array as Arr } from "effect";

import { QuestionAnswer } from "./question-actions.tsx";
import type { QuestionGroup } from "./revealed-questions.ts";
import { useRevealedQuestions } from "./revealed-questions.ts";
import { useSelection } from "./selection-context.ts";

/** Who answered a resolved question, and when. */
function Answer({ question }: { readonly question: ResolvedQuestion }) {
  return (
    <span className="mt-1 block border-l-2 pl-2">
      <span className="block">{question.answer}</span>
      <span className="block opacity-70">
        Answered by {question.answeredBy} on{" "}
        <time dateTime={question.answeredOn}>{question.answeredOn}</time>
      </span>
    </span>
  );
}

/** A question's ID and text, and its answer when it's resolved. */
export function QuestionBody({ question }: { readonly question: Question }) {
  return (
    <>
      <span className="block">
        <b className="font-medium">{question.id}</b> {question.text}
      </span>
      {question.state === "resolved" ? <Answer question={question} /> : null}
    </>
  );
}

const headingButtonClass =
  "focus-visible:outline-ink w-full cursor-pointer text-left hover:underline focus-visible:outline-2 focus-visible:outline-offset-1";

/**
 * One question: its ID and text as a button that selects its structure, then
 * its answer when it's resolved, or the form that answers it when it's open.
 */
function QuestionItem({
  onPick,
  question,
  structure,
}: {
  readonly onPick: () => void;
  readonly question: Question;
  /** The id of the structure the question is on. */
  readonly structure: string;
}) {
  return (
    <article
      className="border-ink/30 border p-1.5 text-xs"
      data-question={question.id}
      data-state={question.state}
    >
      <h5>
        <button className={headingButtonClass} onClick={onPick} type="button">
          <b className="font-medium">{question.id}</b> {question.text}
        </button>
      </h5>
      {question.state === "resolved" ? (
        <Answer question={question} />
      ) : (
        <QuestionAnswer question={question.id} structure={structure} />
      )}
    </article>
  );
}

function QuestionList<Q extends Question>({
  groups,
  kind,
  onPick,
  title,
}: {
  readonly groups: ReadonlyArray<QuestionGroup<Q>>;
  readonly kind: "open" | "resolved";
  readonly onPick: (structure: string) => void;
  readonly title: string;
}) {
  return (
    <section className="flex flex-col gap-2" data-question-list={kind}>
      <h3 className="text-xs tracking-widest uppercase opacity-70">{title}</h3>
      {groups.length === 0 ? (
        <p className="text-xs opacity-70">None so far.</p>
      ) : (
        Arr.map(groups, ({ questions, structure }) => (
          <div
            className="flex flex-col gap-1"
            data-question-group={structure.id}
            key={structure.id}
          >
            <h4 className="text-xs font-medium">
              {structure.code} · {structure.name}
            </h4>
            <ul className="flex flex-col gap-1">
              {Arr.map(questions, (question) => (
                <li key={question.id}>
                  <QuestionItem
                    onPick={() => {
                      onPick(structure.id);
                    }}
                    question={question}
                    structure={structure.id}
                  />
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}

/**
 * Every question revealed so far, open ones first, grouped by structure.
 * Clicking one selects its structure and calls `onPicked`.
 */
export function QuestionsTab({ onPicked }: { readonly onPicked: () => void }) {
  const { open, resolved } = useRevealedQuestions();
  const { select } = useSelection();

  const pick = (structure: string) => {
    select(structure);
    onPicked();
  };

  return (
    <div className="flex flex-col gap-4" data-questions-tab>
      <QuestionList groups={open} kind="open" onPick={pick} title="Open" />
      <QuestionList
        groups={resolved}
        kind="resolved"
        onPick={pick}
        title="Resolved"
      />
    </div>
  );
}
