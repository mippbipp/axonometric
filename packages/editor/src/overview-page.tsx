import type { Overview } from "@axonometric/contracts";
import { cn } from "@axonometric/ui/lib/utils";
import { Array as Arr } from "effect";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";

import { controlClass } from "./control-class.ts";
import { MapLink } from "./map-link.tsx";
import { OverviewPageContext, useOverviewPage } from "./overview-context.ts";
import { useWalkthrough } from "./walkthrough-context.ts";

const pageTitle = "How it's built";

/** Holds whether the "How it's built" page is open. */
export function OverviewPageProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const pageId = useId();

  const close = useCallback(() => {
    setOpen(false);
    buttonRef.current?.focus();
  }, []);

  const toggle = useCallback(() => {
    if (open) {
      close();
    } else {
      setOpen(true);
    }
  }, [open, close]);

  const value = useMemo(
    () => ({ open, toggle, close, buttonRef, pageId }),
    [open, toggle, close, pageId]
  );

  return <OverviewPageContext value={value}>{children}</OverviewPageContext>;
}

/** The header button that opens and closes the "How it's built" page. */
export function OverviewButton() {
  const { open, toggle, buttonRef, pageId } = useOverviewPage();

  return (
    <button
      ref={buttonRef}
      type="button"
      data-control="overview"
      aria-expanded={open}
      aria-controls={open ? pageId : undefined}
      className={cn(controlClass, open && "bg-ink text-paper")}
      onClick={toggle}
    >
      {pageTitle}
    </button>
  );
}

function Section({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs tracking-widest uppercase opacity-70">{title}</h3>
      {children}
    </section>
  );
}

function TextSection({
  title,
  text,
  className,
}: {
  readonly title: string;
  readonly text: string | undefined;
  readonly className?: string;
}) {
  return text === undefined ? null : (
    <Section title={title}>
      <p className={cn("text-sm", className)}>{text}</p>
    </Section>
  );
}

/**
 * A unique key for each item, from its text. The schema allows repeats, so
 * a repeat gets its count after it, such as "Server 2".
 */
const keysOf = <A,>(
  items: readonly A[],
  textOf: (item: A) => string
): readonly string[] => {
  const seen = new Map<string, number>();

  return Arr.map(items, (item) => {
    const text = textOf(item);
    const count = (seen.get(text) ?? 0) + 1;

    seen.set(text, count);

    return count === 1 ? text : `${text} ${count}`;
  });
};

const cellClass = "border-ink border-t py-1.5 pr-4 align-top";

function Decisions({
  decisions,
}: {
  readonly decisions: NonNullable<Overview["decisions"]>;
}) {
  return (
    <Section title="Decisions">
      <div className="overflow-x-auto">
        <table data-overview-decisions className="w-full text-left text-sm">
          <thead className="text-xs tracking-widest uppercase opacity-70">
            <tr>
              <th scope="col" className="pr-4 pb-1 font-normal">
                Topic
              </th>
              <th scope="col" className="pr-4 pb-1 font-normal">
                Decision
              </th>
              <th scope="col" className="pb-1 font-normal">
                ADR
              </th>
            </tr>
          </thead>
          <tbody>
            {Arr.map(decisions, (decision) => (
              <tr key={decision.topic}>
                <td className={cn(cellClass, "font-medium whitespace-nowrap")}>
                  {decision.topic}
                </td>
                <td className={cellClass}>{decision.decision}</td>
                <td className={cn(cellClass, "pr-0 text-xs whitespace-nowrap")}>
                  {decision.adr === undefined ? null : (
                    <MapLink href={decision.adr}>{decision.adr}</MapLink>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function DeepDives({
  deepDives,
}: {
  readonly deepDives: NonNullable<Overview["deepDives"]>;
}) {
  return (
    <Section title="Deep dives">
      <ul className="flex flex-col gap-2 text-sm">
        {Arr.zip(
          deepDives,
          keysOf(deepDives, (deepDive) => deepDive.title)
        ).map(([deepDive, key]) => (
          <li key={key} data-deep-dive>
            <b className="font-medium">
              {deepDive.link === undefined ? (
                deepDive.title
              ) : (
                <MapLink href={deepDive.link}>{deepDive.title}</MapLink>
              )}
              .
            </b>{" "}
            {deepDive.summary}
          </li>
        ))}
      </ul>
    </Section>
  );
}

/**
 * Everything in the overview that's set, in SYSTEM.md's order. Fields that
 * aren't set leave nothing behind, not even a heading.
 */
function OverviewContents({ overview }: { readonly overview: Overview }) {
  const stats = overview.stats ?? [];
  const decisions = overview.decisions ?? [];
  const deepDives = overview.deepDives ?? [];

  return (
    <>
      <p className="text-sm">{overview.summary}</p>
      {stats.length === 0 ? null : (
        <dl className="flex flex-wrap gap-2">
          {Arr.zip(
            stats,
            keysOf(stats, (stat) => stat.label)
          ).map(([stat, key]) => (
            <div
              key={key}
              className="border-ink flex flex-col border px-3 py-1.5"
            >
              <dt className="text-2xs tracking-widest uppercase opacity-70">
                {stat.label}
              </dt>
              <dd className="text-sm font-medium">{stat.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {decisions.length === 0 ? null : <Decisions decisions={decisions} />}
      <TextSection
        title="What the platform provides"
        text={overview.platformProvides}
      />
      <TextSection title="What we own" text={overview.weOwn} />
      {overview.fileLayout === undefined ? null : (
        <Section title="File layout">
          <pre className="border-ink bg-face overflow-x-auto border p-3 text-xs">
            {overview.fileLayout}
          </pre>
        </Section>
      )}
      <TextSection
        title="Cost model"
        text={overview.costModel}
        className="whitespace-pre-line"
      />
      {deepDives.length === 0 ? null : <DeepDives deepDives={deepDives} />}
    </>
  );
}

/**
 * The open page. Mounting it moves focus in, and makes everything it covers
 * inert, so Tab stays inside.
 */
function OpenOverviewPage() {
  const { close, pageId } = useOverviewPage();
  const { state } = useWalkthrough();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  // Runs before every other key handler. The map's keys, such as ] for the
  // next chapter or + to zoom, stay off while the page is open, and Escape
  // closes it instead of unpinning. Default actions, such as Tab and
  // scrolling, still happen.
  const onKey = useEffectEvent((event: KeyboardEvent) => {
    event.stopPropagation();

    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  });

  useEffect(() => {
    const page = ref.current;

    // The panels the page covers stay mounted, so Tab must skip them.
    const covered = Arr.filter(
      [...(page?.parentElement?.children ?? [])],
      (element) => element !== page && !element.hasAttribute("inert")
    );

    for (const element of covered) {
      element.setAttribute("inert", "");
    }

    page?.focus();
    globalThis.addEventListener("keydown", onKey, { capture: true });

    return () => {
      for (const element of covered) {
        element.removeAttribute("inert");
      }

      globalThis.removeEventListener("keydown", onKey, { capture: true });
    };
  }, []);

  return (
    <dialog
      ref={ref}
      open
      id={pageId}
      aria-labelledby={titleId}
      data-overview-page
      tabIndex={-1}
      className="bg-paper text-ink absolute inset-0 z-10 m-0 size-full max-h-none max-w-none overflow-y-auto border-0 p-0 focus:outline-none"
    >
      <article className="mx-auto flex max-w-3xl flex-col gap-5 px-6 py-8">
        <header className="flex flex-col gap-1">
          <p className="text-xs tracking-widest uppercase opacity-70">
            {state.data.overview.title}
          </p>
          <h2 id={titleId} className="text-lg leading-tight font-medium">
            {pageTitle}
          </h2>
        </header>
        <OverviewContents overview={state.data.overview} />
      </article>
    </dialog>
  );
}

/**
 * The "How it's built" page, drawn over the map while it's open. The map
 * stays mounted underneath, so its chapter, selection and zoom survive.
 * Put it in the same box as the panels it covers.
 */
export function OverviewPage() {
  const { open } = useOverviewPage();

  return open ? <OpenOverviewPage /> : null;
}
