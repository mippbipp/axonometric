import type { Question, ResolvedQuestion } from "@axonometric/contracts";
import { Array as Arr } from "effect";

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
 * its answer when it's resolved. The item is a container, so an answer form
 * (#25) can sit beside the button.
 */
function QuestionItem({
  question,
  onPick,
}: {
  readonly question: Question;
  readonly onPick: () => void;
}) {
  return (
    <article
      data-question={question.id}
      data-state={question.state}
      className="border-ink/30 border p-1.5 text-xs"
    >
      <h5>
        <button type="button" className={headingButtonClass} onClick={onPick}>
          <b className="font-medium">{question.id}</b> {question.text}
        </button>
      </h5>
      {question.state === "resolved" ? <Answer question={question} /> : null}
    </article>
  );
}

function QuestionList<Q extends Question>({
  kind,
  title,
  groups,
  onPick,
}: {
  readonly kind: "open" | "resolved";
  readonly title: string;
  readonly groups: readonly QuestionGroup<Q>[];
  readonly onPick: (structure: string) => void;
}) {
  return (
    <section data-question-list={kind} className="flex flex-col gap-2">
      <h3 className="text-xs tracking-widest uppercase opacity-70">{title}</h3>
      {groups.length === 0 ? (
        <p className="text-xs opacity-70">None so far.</p>
      ) : (
        Arr.map(groups, ({ structure, questions }) => (
          <div
            key={structure.id}
            data-question-group={structure.id}
            className="flex flex-col gap-1"
          >
            <h4 className="text-xs font-medium">
              {structure.code} · {structure.name}
            </h4>
            <ul className="flex flex-col gap-1">
              {Arr.map(questions, (question) => (
                <li key={question.id}>
                  <QuestionItem
                    question={question}
                    onPick={() => {
                      onPick(structure.id);
                    }}
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
    <div data-questions-tab className="flex flex-col gap-4">
      <QuestionList kind="open" title="Open" groups={open} onPick={pick} />
      <QuestionList
        kind="resolved"
        title="Resolved"
        groups={resolved}
        onPick={pick}
      />
    </div>
  );
}
