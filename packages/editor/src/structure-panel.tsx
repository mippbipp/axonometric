import {
  normalSourcePath,
  sourceKey,
  statusLabels,
  uniqueSources,
} from "@axonometric/contracts";
import type { Source, Structure } from "@axonometric/contracts";
import { Button } from "@axonometric/ui/components/button";
import { Array as Arr, String as Str } from "effect";
import type { ReactNode } from "react";

import { ChangeStructure } from "./change-structure.tsx";
import { ChapterReveal } from "./chapter-reveal-control.tsx";
import { uiControlClass } from "./control-class.ts";
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
  children,
  title,
}: {
  readonly children: ReactNode;
  readonly title: string;
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
          className={
            suggestable ? undefined : "grid grid-cols-[1.5rem_1fr] gap-1"
          }
          key={step.name}
        >
          {suggestable ? (
            <SuggestableStep
              index={index}
              step={step}
              structure={structure.id}
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
function SourceList({ sources }: { readonly sources: ReadonlyArray<Source> }) {
  const { state } = useWalkthrough();
  const links = state.sourceLinks ?? {};

  const listed = uniqueSources(sources);

  return (
    <ul className="flex flex-col gap-1 text-xs">
      {Arr.map(listed, (source) => {
        const file = normalSourcePath(source.path);

        return (
          <li data-source={file} key={file}>
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
  const { goInside, select } = useSelection();
  const { newlyRevealed } = useWalkthrough();
  const questions = structure.questions ?? [];
  const sources = structure.sources ?? [];
  const review = useReview();

  return (
    <section
      className="flex flex-col gap-3"
      data-pinned
      data-structure-panel={structure.id}
    >
      <p className="text-xs tracking-widest uppercase opacity-70">
        {structure.code} · Pinned
        {newlyRevealed.has(structure.id) ? " · New" : null}
      </p>
      <h2 className="text-lg leading-tight font-medium">{structure.name}</h2>
      <p>
        <span
          className="border-ink border px-1.5 py-0.5 text-xs tracking-wider uppercase"
          data-status-label={structure.status}
        >
          {statusLabels[structure.status]}
        </span>
      </p>
      <SuggestableText
        className="text-sm"
        field="oneLiner"
        structure={structure.id}
        text={structure.oneLiner}
      />
      <Section title="What it does">
        <SuggestableText
          className="text-sm"
          field="whatItDoes"
          structure={structure.id}
          text={structure.whatItDoes}
        />
      </Section>
      <Section title="How it's built">
        <SuggestableText
          className="text-sm"
          field="howItsBuilt"
          structure={structure.id}
          text={structure.howItsBuilt}
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
                data-panel-question={question.id}
                data-state={question.state}
                key={question.id}
              >
                <QuestionBody question={question} />
                {question.state === "open" ? (
                  <QuestionAnswer
                    question={question.id}
                    structure={structure.id}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        </Section>
      )}
      <RaisedQuestions structure={structure.id} />
      <NotesSection target={{ id: structure.id, kind: "structure" }} />
      <ChangeStructure structure={structure} />
      <ChapterReveal structure={structure} />
      <div className="flex gap-1.5">
        {hasSteps(structure) ? (
          <Button
            className={uiControlClass}
            data-control="go-inside"
            onClick={() => {
              goInside(structure.id);
            }}
          >
            → Go inside
          </Button>
        ) : null}
        <Button
          className={uiControlClass}
          data-control="unpin"
          onClick={() => {
            select(null);
          }}
        >
          Unpin
        </Button>
      </div>
    </section>
  );
}

/** The open inside view's structure and every step in order. */
export function InsidePanel({ structure }: { readonly structure: Structure }) {
  return (
    <section className="flex flex-col gap-3" data-inside-panel={structure.id}>
      <p className="text-xs tracking-widest uppercase opacity-70">
        Inside {structure.code} · {structure.steps?.length ?? 0} steps
      </p>
      <h2 className="text-lg leading-tight font-medium">{structure.name}</h2>
      <p className="text-sm">{structure.oneLiner}</p>
      <StepList structure={structure} />
    </section>
  );
}
