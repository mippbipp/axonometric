import type { Structure } from "@axonometric/contracts";
import { Array as Arr, Match } from "effect";
import { useId, useMemo, useState } from "react";
import type { KeyboardEvent } from "react";

import { controlClass } from "./control-class.ts";
import { useEditing } from "./editing-context.ts";
import { PendingTab } from "./pending-tab.tsx";
import { usePlayback } from "./playback.ts";
import type { SelectedPacket } from "./playback.ts";
import { QuestionsTab } from "./questions.tsx";
import { useRevealedQuestions } from "./revealed-questions.ts";
import { useSelection } from "./selection-context.ts";
import { InsidePanel, StructurePanel } from "./structure-panel.tsx";
import { useStructuresById } from "./structures.ts";
import { useWalkthrough } from "./walkthrough-context.ts";

/** Structure names by id, for showing ids as names. */
const useStructureNames = () => {
  const { state } = useWalkthrough();

  return useMemo(
    () => new Map(Arr.map(state.data.structures, (s) => [s.id, s.name])),
    [state.data.structures]
  );
};

function ChapterStory() {
  const { stop, index, stops, back, next, isLast } = useWalkthrough();
  const names = useStructureNames();

  return (
    <section data-chapter-story className="flex flex-col gap-3">
      <p className="text-xs tracking-widest uppercase opacity-70">
        Chapter {index + 1} of {stops.length}
      </p>
      <h2 className="text-lg leading-tight font-medium">{stop.title}</h2>
      <p className="text-sm">{stop.lede}</p>
      <p className="text-sm opacity-80">{stop.story}</p>
      {stop.newlyRevealed.length === 0 ? null : (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs tracking-widest uppercase opacity-70">
            New in this chapter
          </p>
          <ul className="flex flex-wrap gap-1.5">
            {Arr.map(stop.newlyRevealed, (id) => (
              <li
                key={id}
                className="border-ink border border-dashed px-1.5 py-0.5 text-xs"
              >
                {names.get(id) ?? id}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex gap-1.5">
        <button
          type="button"
          className={controlClass}
          disabled={index === 0}
          onClick={back}
        >
          ◂ Back
        </button>
        <button
          type="button"
          className={controlClass}
          disabled={isLast}
          onClick={next}
        >
          Next ▸
        </button>
      </div>
    </section>
  );
}

function PacketDetails({ packet }: { readonly packet: SelectedPacket }) {
  const { play, step, reducedMotion, closePacket } = usePlayback();
  const { run, hop, index } = packet;
  const names = useStructureNames();
  const nameOf = (id: string) => names.get(id) ?? id;

  return (
    <section data-packet-panel={hop.id} className="flex flex-col gap-3">
      <p className="text-xs tracking-widest uppercase opacity-70">
        Packet · {run.name} · hop {index + 1} of {run.hops.length}
      </p>
      <h2 data-packet-label className="text-lg leading-tight font-medium">
        {hop.label}
      </h2>
      <p className="text-sm">
        {nameOf(hop.from)} → {nameOf(hop.to)}
      </p>
      <p className="text-xs tracking-widest uppercase opacity-70">
        Example payload
      </p>
      {hop.payload === undefined ? (
        <p className="text-sm opacity-80">This hop has no example payload.</p>
      ) : (
        <pre
          data-packet-payload
          className="border-ink bg-face overflow-auto border p-2 text-xs"
        >
          {JSON.stringify(hop.payload, null, 2)}
        </pre>
      )}
      <div className="flex gap-1.5">
        <button type="button" className={controlClass} onClick={step}>
          Step
        </button>
        {reducedMotion ? null : (
          <button type="button" className={controlClass} onClick={play}>
            ▸ Play
          </button>
        )}
        <button
          type="button"
          data-control="close"
          className={controlClass}
          onClick={closePacket}
        >
          Close
        </button>
      </div>
    </section>
  );
}

/**
 * What the side panel's Details tab shows, in the order they win: the open
 * inside view, then a selected packet, then the pinned structure, then the
 * chapter story. A packet clicked while a structure is pinned shows until
 * it's closed or playback resumes, then the pinned structure returns.
 *
 * To add a kind of content: add a member here, return it from
 * `panelContentOf` in the order it should win, and render it in
 * `renderContent`, whose match fails to compile until every kind is handled.
 */
export type PanelContent =
  | { readonly kind: "chapter" }
  | { readonly kind: "packet"; readonly packet: SelectedPacket }
  | { readonly kind: "structure"; readonly structure: Structure }
  | { readonly kind: "inside"; readonly structure: Structure };

const panelContentOf = ({
  packet,
  pinned,
  inside,
}: {
  readonly packet: SelectedPacket | null;
  readonly pinned: Structure | undefined;
  readonly inside: Structure | undefined;
}): PanelContent => {
  if (inside !== undefined) {
    return { kind: "inside", structure: inside };
  }

  if (packet !== null) {
    return { kind: "packet", packet };
  }

  return pinned === undefined
    ? { kind: "chapter" }
    : { kind: "structure", structure: pinned };
};

const renderContent = Match.type<PanelContent>().pipe(
  Match.discriminatorsExhaustive("kind")({
    chapter: () => <ChapterStory />,
    packet: ({ packet }) => <PacketDetails packet={packet} />,
    structure: ({ structure }) => (
      <StructurePanel key={structure.id} structure={structure} />
    ),
    inside: ({ structure }) => <InsidePanel structure={structure} />,
  })
);

type Tab = "details" | "questions" | "pending";

const tabClass =
  "focus-visible:outline-ink -mb-px cursor-pointer border border-transparent px-2 py-1 text-xs tracking-widest uppercase focus-visible:outline-2 focus-visible:-outline-offset-2 aria-selected:border-ink aria-selected:border-b-paper aria-selected:bg-paper";

/**
 * The side panel next to the view. Details shows one of the `PanelContent`
 * kinds; Open questions lists every question revealed so far; on a page
 * `serve` serves, Pending lists the pending layout changes. Selecting a
 * structure anywhere switches back to Details.
 */
export function SidePanel() {
  const { selected: packet } = usePlayback();
  const { selected, inside } = useSelection();
  const byId = useStructuresById();
  const { open } = useRevealedQuestions();

  const openCount = Arr.reduce(
    open,
    0,
    (sum, group) => sum + group.questions.length
  );

  const idPrefix = useId();
  const editing = useEditing();

  // A tab other than Details stays open until the selection changes.
  const [otherTab, setOtherTab] = useState<{
    readonly tab: Tab;
    readonly selected: string | null;
  } | null>(null);

  const tabs: readonly { readonly id: Tab; readonly label: string }[] = [
    { id: "details", label: "Details" },
    { id: "questions", label: `Open questions · ${openCount}` },
    ...(editing === null
      ? []
      : [
          {
            id: "pending" as const,
            label: `Pending · ${editing.pending.length}`,
          },
        ]),
  ];

  const tab: Tab =
    otherTab !== null &&
    otherTab.selected === selected &&
    Arr.some(tabs, ({ id }) => id === otherTab.tab)
      ? otherTab.tab
      : "details";

  const choose = (next: Tab) => {
    setOtherTab(next === "details" ? null : { tab: next, selected });
  };

  const onTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
      return;
    }

    // The tab list owns ← and → while it has focus.
    event.preventDefault();
    event.stopPropagation();

    const at = tabs.findIndex(({ id }) => id === tab);
    const step = event.key === "ArrowRight" ? 1 : -1;
    const next = tabs[(at + step + tabs.length) % tabs.length]?.id ?? "details";

    choose(next);
    event.currentTarget
      .querySelector<HTMLElement>(`[data-tab="${next}"]`)
      ?.focus();
  };

  return (
    <aside
      data-side-panel
      className="border-ink flex w-80 shrink-0 flex-col border-l"
    >
      <div
        tabIndex={0}
        role="tablist"
        aria-label="Side panel"
        className="border-ink flex gap-1 border-b px-3 pt-2"
        onKeyDown={onTabKeyDown}
      >
        {Arr.map(tabs, ({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`${idPrefix}-${id}-tab`}
            data-tab={id}
            aria-selected={tab === id}
            aria-controls={`${idPrefix}-${id}`}
            tabIndex={tab === id ? 0 : -1}
            className={tabClass}
            onClick={() => {
              choose(id);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`${idPrefix}-details`}
        aria-labelledby={`${idPrefix}-details-tab`}
        hidden={tab !== "details"}
        className="min-h-0 flex-1 overflow-y-auto p-4"
      >
        {tab === "details"
          ? renderContent(
              panelContentOf({
                packet,
                pinned: selected === null ? undefined : byId.get(selected),
                inside: inside === null ? undefined : byId.get(inside),
              })
            )
          : null}
      </div>
      <div
        role="tabpanel"
        id={`${idPrefix}-questions`}
        aria-labelledby={`${idPrefix}-questions-tab`}
        hidden={tab !== "questions"}
        className="min-h-0 flex-1 overflow-y-auto p-4"
      >
        {tab === "questions" ? (
          <QuestionsTab
            onPicked={() => {
              choose("details");
            }}
          />
        ) : null}
      </div>
      {editing === null ? null : (
        <div
          role="tabpanel"
          id={`${idPrefix}-pending`}
          aria-labelledby={`${idPrefix}-pending-tab`}
          hidden={tab !== "pending"}
          className="min-h-0 flex-1 overflow-y-auto p-4"
        >
          {tab === "pending" ? <PendingTab /> : null}
        </div>
      )}
    </aside>
  );
}
