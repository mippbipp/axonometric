import { statusLabels } from "@axonometric/contracts";
import type { Structure } from "@axonometric/contracts";
import { Array as Arr } from "effect";
import type { ReactNode } from "react";

import { controlClass } from "./control-class.ts";
import { QuestionBody } from "./questions.tsx";
import { useSelection } from "./selection-context.ts";
import { hasSteps } from "./structures.ts";
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

function StepList({ structure }: { readonly structure: Structure }) {
  return (
    <ol className="flex flex-col gap-1.5 text-sm">
      {Arr.map(structure.steps ?? [], (step, index) => (
        <li key={step.name} className="grid grid-cols-[1.5rem_1fr] gap-1">
          <span className="opacity-70">{index + 1}</span>
          <span>
            <b className="font-medium">{step.name}.</b> {step.detail}
          </span>
        </li>
      ))}
    </ol>
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
      <p className="text-sm">{structure.oneLiner}</p>
      <Section title="What it does">
        <p className="text-sm">{structure.whatItDoes}</p>
      </Section>
      <Section title="How it's built">
        <p className="text-sm">{structure.howItsBuilt}</p>
      </Section>
      {hasSteps(structure) ? (
        <Section title="Steps">
          <StepList structure={structure} />
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
              </li>
            ))}
          </ul>
        </Section>
      )}
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
