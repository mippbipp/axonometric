import type { Overview } from "@axonometric/contracts";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@axonometric/ui/components/dialog";
import { Toggle } from "@axonometric/ui/components/toggle";
import { cn } from "@axonometric/ui/lib/utils";
import { Array as Arr } from "effect";
import { useCallback, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";

import { uiControlClass } from "./control-class.ts";
import { MapLink } from "./map-link.tsx";
import { OverviewPageContext, useOverviewPage } from "./overview-context.ts";
import { useWalkthrough } from "./walkthrough-context.ts";

const pageTitle = "How it's built";

/**
 * Keeps keys pressed in the open page, or on its header button, from the
 * viewport's zoom keys, which listen on the window: + and 0 stay off while
 * the page is open. The page's other keys are ui-sdk shortcuts, which the
 * open page pauses. Escape goes on to ui-sdk, which closes the page on it.
 * Default actions such as Tab and scrolling still happen.
 */
const keepFromMap = (event: KeyboardEvent<HTMLElement>) => {
  if (event.key !== "Escape") {
    event.stopPropagation();
  }
};

/** Holds whether the "How it's built" page is open. */
export function OverviewPageProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const pageId = useId();

  // ui-sdk returns focus to the button when the page closes.
  const close = useCallback(() => {
    setOpen(false);
  }, []);

  const toggle = useCallback(() => {
    if (open) {
      close();
    } else {
      setOpen(true);
    }
  }, [open, close]);

  const value = useMemo(
    () => ({ buttonRef, close, open, pageId, toggle }),
    [open, toggle, close, pageId]
  );

  return <OverviewPageContext value={value}>{children}</OverviewPageContext>;
}

/** The header button that opens and closes the "How it's built" page. */
export function OverviewButton() {
  const { buttonRef, open, pageId, toggle } = useOverviewPage();

  return (
    <Toggle
      aria-controls={open ? pageId : undefined}
      className={uiControlClass}
      data-control="overview"
      onKeyDown={open ? keepFromMap : undefined}
      onPressedChange={toggle}
      pressed={open}
      ref={buttonRef}
    >
      {pageTitle}
    </Toggle>
  );
}

function Section({
  children,
  title,
}: {
  readonly children: ReactNode;
  readonly title: string;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs tracking-widest uppercase opacity-70">{title}</h3>
      {children}
    </section>
  );
}

function TextSection({
  className,
  text,
  title,
}: {
  readonly className?: string;
  readonly text: string | undefined;
  readonly title: string;
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
  items: ReadonlyArray<A>,
  textOf: (item: A) => string
): ReadonlyArray<string> => {
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
        <table className="w-full text-left text-sm" data-overview-decisions>
          <thead className="text-xs tracking-widest uppercase opacity-70">
            <tr>
              <th className="pr-4 pb-1 font-normal" scope="col">
                Topic
              </th>
              <th className="pr-4 pb-1 font-normal" scope="col">
                Decision
              </th>
              <th className="pb-1 font-normal" scope="col">
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
          <li data-deep-dive key={key}>
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
              className="border-ink flex flex-col border px-3 py-1.5"
              key={key}
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
        text={overview.platformProvides}
        title="What the platform provides"
      />
      <TextSection text={overview.weOwn} title="What we own" />
      {overview.fileLayout === undefined ? null : (
        <Section title="File layout">
          <pre className="border-ink bg-face overflow-x-auto border p-3 text-xs">
            {overview.fileLayout}
          </pre>
        </Section>
      )}
      <TextSection
        className="whitespace-pre-line"
        text={overview.costModel}
        title="Cost model"
      />
      {deepDives.length === 0 ? null : <DeepDives deepDives={deepDives} />}
    </>
  );
}

/**
 * The "How it's built" page, drawn over the map while it's open. The map
 * stays mounted underneath, so its chapter, selection and zoom survive.
 * Put it in the same box as the panels it covers.
 *
 * A ui-sdk `Dialog` rendered `inline`, so it sits in the box that CSS places
 * it in instead of the top layer. It's modal: the map and panels it covers
 * are inert, Tab stays inside, and Escape closes it. Its header button is a
 * persistent element, so it stays live and can close the page. Opening moves
 * focus in, and closing returns it to that button.
 */
export function OverviewPage() {
  const { buttonRef, close, open, pageId } = useOverviewPage();
  const { state } = useWalkthrough();

  return (
    <Dialog
      closeOnOutsidePress={false}
      onOpenChange={(next) => {
        if (!next) {
          close();
        }
      }}
      open={open}
      persistentElements={() =>
        buttonRef.current === null ? [] : [buttonRef.current]
      }
    >
      <DialogContent
        className="bg-paper text-ink absolute inset-0 z-10 m-0 size-full max-h-none max-w-none overflow-y-auto border-0 p-0"
        data-overview-page
        finalFocus={() => buttonRef.current}
        id={pageId}
        initialFocus="content"
        inline
        onKeyDown={keepFromMap}
      >
        <article className="mx-auto flex max-w-3xl flex-col gap-5 px-6 py-8">
          <header className="flex flex-col gap-1">
            <p className="text-xs tracking-widest uppercase opacity-70">
              {state.data.overview.title}
            </p>
            <DialogTitle className="text-lg leading-tight">
              {pageTitle}
            </DialogTitle>
          </header>
          <OverviewContents overview={state.data.overview} />
        </article>
      </DialogContent>
    </Dialog>
  );
}
