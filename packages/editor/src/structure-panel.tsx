import {
  normalSourcePath,
  sourceKey,
  statusLabels,
  uniqueSources,
} from "@axonometric/contracts";
import type { Source, Structure } from "@axonometric/contracts";
import { Array as Arr, Option, Result, String as Str } from "effect";
import type { ReactNode } from "react";

import { controlClass } from "./control-class.ts";
import { MapLink } from "./map-link.tsx";
import { NoteForm } from "./note-form.tsx";
import { QuestionBody } from "./questions.tsx";
import { useReview } from "./review-context.ts";
import { VerdictBadge } from "./review-list.tsx";
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

/**
 * The notes on a structure, each with its status and verdict, and a form that
 * pins another. Only a page that can write has the form.
 */
function NotesSection({ structure }: { readonly structure: Structure }) {
  const review = useReview();

  if (review === null) {
    return null;
  }

  const notes = Arr.filter(
    review.notes,
    ({ item, status }) =>
      item.kind === "note" &&
      item.target.id === structure.id &&
      !(status.state === "reviewed" && status.dismissed)
  );

  return (
    <section data-notes-section className="flex flex-col gap-2">
      <h3 className="text-xs tracking-widest uppercase opacity-70">Notes</h3>
      {notes.length === 0 ? null : (
        <ul className="flex flex-col gap-2">
          {Arr.map(notes, ({ item, status }) => (
            <li
              key={item.id}
              data-panel-note={item.id}
              data-note-state={status.state}
              className="border-pending flex flex-col gap-1 border-l-2 pl-2 text-sm"
            >
              <span className="break-words">
                {item.kind === "note" ? item.text : null}
              </span>
              {status.state === "open" ? (
                <span className="text-xs opacity-70">
                  Open. It goes in the next batch.
                </span>
              ) : null}
              {status.state === "frozen" ? (
                <span className="text-xs opacity-70">
                  In batch {status.batch}, waiting for the agent.
                </span>
              ) : null}
              {status.state === "reviewed" ? (
                <VerdictBadge verdict={status.verdict} batch={status.batch} />
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {review.canWrite ? (
        <NoteForm
          label="Pin a note"
          submit="Pin note"
          onSubmit={(text, done) => {
            review.ops.addNote(structure.id, text, (outcome) => {
              done(Option.getOrUndefined(Result.getFailure(outcome)));
            });
          }}
        />
      ) : null}
    </section>
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
      {sources.length === 0 ? null : (
        <Section title="Sources">
          <SourceList sources={sources} />
        </Section>
      )}
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
      <NotesSection structure={structure} />
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
