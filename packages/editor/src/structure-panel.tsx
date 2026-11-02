import {
  normalSourcePath,
  sourceKey,
  statusLabels,
  uniqueSources,
} from "@axonometric/contracts";
import type { Source, Structure } from "@axonometric/contracts";
import { Array as Arr, String as Str } from "effect";
import type { ReactNode } from "react";

import { controlClass } from "./control-class.ts";
import { MapLink } from "./map-link.tsx";
import { NotesSection } from "./notes-section.tsx";
import { QuestionAnswer, RaisedQuestions } from "./question-actions.tsx";
import { QuestionBody } from "./questions.tsx";
import { useReview } from "./review-context.ts";
import { useSelection } from "./selection-context.ts";
import { hasSteps } from "./structures.ts";
import { SuggestableStep } from "./suggestable-step.tsx";
import { SuggestableText } from "./suggestable-text.tsx";
import { useWalkthrough } from "./walkthrough-context.ts";

function Section({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-1">
      <h3 className="text-xs tracking-widest uppercase opacity-70">{title}</h3>
      {children}
    </section>
  );
}

function StepList({
  structure,
  suggestable = false,
}: {
  readonly structure: Structure;
  /** Whether each step can be edited in place, both its name and its detail. */
  readonly suggestable?: boolean;
}) {
  return (
    <ol className="flex flex-col gap-1.5 text-sm">
      {Arr.map(structure.steps ?? [], (step, index) => (
        <li
          key={step.name}
          className={
            suggestable ? undefined : "grid grid-cols-[1.5rem_1fr] gap-1"
          }
        >
          {suggestable ? (
            <SuggestableStep
              structure={structure.id}
              index={index}
              step={step}
            />
          ) : (
            <>
              <span className="opacity-70">{index + 1}</span>
              <span>
                <b className="font-medium">{step.name}.</b> {step.detail}
              </span>
            </>
          )}
        </li>
      ))}
    </ol>
  );
}

/**
 * The files behind a structure. `build` worked out each one's web address
 * from the repo's remote; a source without one shows as a plain path.
 */
function SourceList({ sources }: { readonly sources: readonly Source[] }) {
  const { state } = useWalkthrough();
  const links = state.sourceLinks ?? {};

  const listed = uniqueSources(sources);

  return (
    <ul className="flex flex-col gap-1 text-xs">
      {Arr.map(listed, (source) => {
        const file = normalSourcePath(source.path);

        return (
          <li key={file} data-source={file}>
            <MapLink href={links[sourceKey(source)]}>{file}</MapLink>
            {source.commit === undefined ? null : (
              <span className="opacity-70">
                {" "}
                at {Str.slice(0, 7)(source.commit)}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** The pinned structure: what it is, how it's built and its questions. */
export function StructurePanel({
  structure,
}: {
  readonly structure: Structure;
}) {
  const { select, goInside } = useSelection();
  const { newlyRevealed } = useWalkthrough();
  const questions = structure.questions ?? [];
  const sources = structure.sources ?? [];
  const review = useReview();

  return (
    <section
      data-structure-panel={structure.id}
      data-pinned
      className="flex flex-col gap-3"
    >
      <p className="text-xs tracking-widest uppercase opacity-70">
        {structure.code} · Pinned
        {newlyRevealed.has(structure.id) ? " · New" : null}
      </p>
      <h2 className="text-lg leading-tight font-medium">{structure.name}</h2>
      <p>
        <span
          data-status-label={structure.status}
          className="border-ink border px-1.5 py-0.5 text-xs tracking-wider uppercase"
        >
          {statusLabels[structure.status]}
        </span>
      </p>
      <SuggestableText
        structure={structure.id}
        field="oneLiner"
        text={structure.oneLiner}
        className="text-sm"
      />
      <Section title="What it does">
        <SuggestableText
          structure={structure.id}
          field="whatItDoes"
          text={structure.whatItDoes}
          className="text-sm"
        />
      </Section>
      <Section title="How it's built">
        <SuggestableText
          structure={structure.id}
          field="howItsBuilt"
          text={structure.howItsBuilt}
          className="text-sm"
        />
      </Section>
      {sources.length === 0 ? null : (
        <Section title="Sources">
          <SourceList sources={sources} />
        </Section>
      )}
      {hasSteps(structure) ? (
        <Section title="Steps">
          <StepList structure={structure} suggestable={review !== null} />
        </Section>
      ) : null}
      {questions.length === 0 ? null : (
        <Section title="Questions">
          <ul className="flex flex-col gap-1.5 text-xs">
            {Arr.map(questions, (question) => (
              <li
                key={question.id}
                data-panel-question={question.id}
                data-state={question.state}
              >
                <QuestionBody question={question} />
                {question.state === "open" ? (
                  <QuestionAnswer
                    structure={structure.id}
                    question={question.id}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        </Section>
      )}
      <RaisedQuestions structure={structure.id} />
      <NotesSection target={{ kind: "structure", id: structure.id }} />
      <div className="flex gap-1.5">
        {hasSteps(structure) ? (
          <button
            type="button"
            data-control="go-inside"
            className={controlClass}
            onClick={() => {
              goInside(structure.id);
            }}
          >
            → Go inside
          </button>
        ) : null}
        <button
          type="button"
          data-control="unpin"
          className={controlClass}
          onClick={() => {
            select(null);
          }}
        >
          Unpin
        </button>
      </div>
    </section>
  );
}

/** The open inside view's structure and every step in order. */
export function InsidePanel({ structure }: { readonly structure: Structure }) {
  return (
    <section data-inside-panel={structure.id} className="flex flex-col gap-3">
      <p className="text-xs tracking-widest uppercase opacity-70">
        Inside {structure.code} · {structure.steps?.length ?? 0} steps
      </p>
      <h2 className="text-lg leading-tight font-medium">{structure.name}</h2>
      <p className="text-sm">{structure.oneLiner}</p>
      <StepList structure={structure} />
    </section>
  );
}
