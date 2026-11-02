import type { GridPoint, Structure } from "@axonometric/contracts";
import { Array as Arr, Match } from "effect";
import { useId, useMemo, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";

import { AddStructureForm } from "./add-structure.tsx";
import { useConnections } from "./connections-context.ts";
import { controlClass } from "./control-class.ts";
import { DragWarnings } from "./drag-preview.tsx";
import { DrawHopForm } from "./draw-hop-form.tsx";
import { useEditing } from "./editing-context.ts";
import { FlowsTab } from "./flows-tab.tsx";
import { useHistory } from "./history-context.ts";
import { HistoryTab } from "./history-tab.tsx";
import { useHopDraft } from "./hop-draft-context.ts";
import { HopPanel } from "./hop-panel.tsx";
import { useNoteTool } from "./note-tool-context.ts";
import { PendingTab } from "./pending-tab.tsx";
import { usePlacing } from "./place-context.ts";
import { usePlayback } from "./playback.ts";
import type { SelectedPacket } from "./playback.ts";
import { QuestionsTab } from "./questions.tsx";
import { useRevealedQuestions } from "./revealed-questions.ts";
import { useReview } from "./review-context.ts";
import { useSelection } from "./selection-context.ts";
import { SpotPanel } from "./spot-panel.tsx";
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
  | { readonly kind: "hop"; readonly hop: string }
  | { readonly kind: "spot"; readonly spot: GridPoint }
  | { readonly kind: "packet"; readonly packet: SelectedPacket }
  | { readonly kind: "structure"; readonly structure: Structure }
  | { readonly kind: "inside"; readonly structure: Structure };

const panelContentOf = ({
  packet,
  pinned,
  inside,
  hop,
  spot,
}: {
  readonly packet: SelectedPacket | null;
  readonly pinned: Structure | undefined;
  readonly inside: Structure | undefined;
  readonly hop: string | null;
  readonly spot: GridPoint | null;
}): PanelContent => {
  if (inside !== undefined) {
    return { kind: "inside", structure: inside };
  }

  if (packet !== null) {
    return { kind: "packet", packet };
  }

  if (hop !== null) {
    return { kind: "hop", hop };
  }

  if (spot !== null) {
    return { kind: "spot", spot };
  }

  return pinned === undefined
    ? { kind: "chapter" }
    : { kind: "structure", structure: pinned };
};

const renderContent = Match.type<PanelContent>().pipe(
  Match.discriminatorsExhaustive("kind")({
    chapter: () => <ChapterStory />,
    hop: ({ hop }) => <HopPanel key={hop} id={hop} />,
    spot: ({ spot }) => <SpotPanel key={`${spot.x},${spot.y}`} spot={spot} />,
    packet: ({ packet }) => <PacketDetails packet={packet} />,
    structure: ({ structure }) => (
      <StructurePanel key={structure.id} structure={structure} />
    ),
    inside: ({ structure }) => <InsidePanel structure={structure} />,
  })
);

type Tab = "details" | "questions" | "flows" | "pending" | "history";

const tabClass =
  "focus-visible:outline-ink -mb-px cursor-pointer border border-transparent disabled:cursor-default disabled:opacity-40 px-1 py-1 text-2xs tracking-normal whitespace-nowrap uppercase focus-visible:outline-2 focus-visible:-outline-offset-2 aria-selected:border-ink aria-selected:border-b-paper aria-selected:bg-paper";

/** The tabs to show: Pending only while the page can edit, History only when served. */
const tabsOf = ({
  openCount,
  pendingCount,
  hasHistory,
  pendingOff,
  hasFlows,
  flowsOff,
}: {
  /** Whether the page can propose changes to flows, which gives it a Flows tab. */
  readonly hasFlows: boolean;
  /** Whether the Flows tab is shown but can't be used, as while a past revision is open. */
  readonly flowsOff: boolean;
  readonly openCount: number;
  /** How many changes are pending, or `undefined` on a page that can't edit. */
  readonly pendingCount: number | undefined;
  readonly hasHistory: boolean;
  /** Whether the Pending tab is shown but can't be used, as while a past revision is open. */
  readonly pendingOff: boolean;
}): readonly {
  readonly id: Tab;
  readonly label: string;
  readonly disabled: boolean;
}[] => [
  { id: "details", label: "Details", disabled: false },
  { id: "questions", label: `Questions · ${openCount}`, disabled: false },
  ...(hasFlows
    ? [{ id: "flows" as const, label: "Flows", disabled: flowsOff }]
    : []),
  ...(pendingCount === undefined
    ? []
    : [
        {
          id: "pending" as const,
          label: `Pending · ${pendingCount}`,
          disabled: pendingOff,
        },
      ]),
  ...(hasHistory
    ? [{ id: "history" as const, label: "History", disabled: false }]
    : []),
];

/**
 * One tab's panel. Its content is only rendered while the tab is open, so a
 * closed tab does no work.
 */
function TabPanel({
  id,
  prefix,
  open,
  children,
}: {
  readonly id: Tab;
  readonly prefix: string;
  readonly open: Tab;
  readonly children: ReactNode;
}) {
  return (
    <div
      role="tabpanel"
      id={`${prefix}-${id}`}
      aria-labelledby={`${prefix}-${id}-tab`}
      hidden={open !== id}
      className="min-h-0 flex-1 overflow-y-auto p-4"
    >
      {open === id ? children : null}
    </div>
  );
}

/**
 * How many review items the Pending tab counts beside the pending layout
 * changes: open notes, suggestions, answers and questions, and everything waiting on the agent or turned
 * down.
 */
const useWaitingCount = () =>
  Arr.filter(
    useReview()?.entries ?? [],
    ({ item, status }) =>
      status.state === "frozen" ||
      (status.state === "open" && item.kind !== "layout") ||
      (status.state === "reviewed" &&
        !status.dismissed &&
        status.verdict.verdict === "rejected")
  ).length;

/**
 * The forms docked under the tabs, so the add form and the draw-hop form,
 * and what a drag or a proposal would leave, never cover the drawing.
 */
function DockedForms() {
  const placing = usePlacing();
  const drafting = useHopDraft();

  return (
    <>
      {placing?.open === true ? (
        <section
          data-add-structure-panel
          aria-label="Add a structure"
          className="border-ink bg-paper flex max-h-[55svh] shrink-0 flex-col gap-2 overflow-y-auto border-t p-3"
        >
          <h2 className="text-xs tracking-widest uppercase opacity-70">
            Add a structure
          </h2>
          <AddStructureForm />
        </section>
      ) : null}
      {drafting?.draft === null ? null : (
        <section
          data-draw-hop-panel
          aria-label="Draw a hop"
          className="border-ink bg-paper flex max-h-[55svh] shrink-0 flex-col gap-2 overflow-y-auto border-t p-3"
        >
          <h2 className="text-xs tracking-widest uppercase opacity-70">
            Draw a hop
          </h2>
          <DrawHopForm />
        </section>
      )}
    </>
  );
}

/**
 * The side panel next to the view. Details shows one of the `PanelContent`
 * kinds; Open questions lists every question revealed so far; on a page
 * `serve` serves, Pending lists the pending layout changes and History lists
 * the revisions. Selecting a structure anywhere switches back to Details.
 */
export function SidePanel() {
  const { selected: packet } = usePlayback();
  const { selected, selectedHop, inside } = useSelection();
  const spot = useNoteTool()?.spot ?? null;
  const byId = useStructuresById();
  const { open } = useRevealedQuestions();

  const openCount = Arr.reduce(
    open,
    0,
    (sum, group) => sum + group.questions.length
  );

  const idPrefix = useId();
  const editing = useEditing();
  const history = useHistory();
  const waiting = useWaitingCount();
  const connections = useConnections();

  // A tab other than Details stays open until the selection changes.
  const picked =
    selected ??
    (selectedHop === null
      ? spot === null
        ? null
        : `spot:${spot.x},${spot.y}`
      : `hop:${selectedHop}`);

  const [otherTab, setOtherTab] = useState<{
    readonly tab: Tab;
    readonly selected: string | null;
  } | null>(null);

  // While a past revision is open there is no editing, but the tab strip
  // keeps its Pending tab and count, so it doesn't move.
  const layoutPending = editing?.pending.length ?? history?.pendingCount;

  const pendingCount =
    layoutPending === undefined ? undefined : layoutPending + waiting;

  const tabs = tabsOf({
    openCount,
    pendingCount,
    hasHistory: history !== null,
    pendingOff: editing === null,
    hasFlows: connections !== null || history !== null,
    flowsOff: connections === null,
  });

  const tab: Tab =
    otherTab !== null &&
    otherTab.selected === picked &&
    Arr.some(tabs, ({ id, disabled }) => id === otherTab.tab && !disabled)
      ? otherTab.tab
      : "details";

  const choose = (next: Tab) => {
    setOtherTab(next === "details" ? null : { tab: next, selected: picked });
  };

  const onTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
      return;
    }

    // The tab list owns ← and → while it has focus.
    event.preventDefault();
    event.stopPropagation();

    const usable = Arr.filter(tabs, ({ disabled }) => !disabled);
    const at = usable.findIndex(({ id }) => id === tab);
    const step = event.key === "ArrowRight" ? 1 : -1;

    const next =
      usable[(at + step + usable.length) % usable.length]?.id ?? "details";

    choose(next);
    event.currentTarget
      .querySelector<HTMLElement>(`[data-tab="${next}"]`)
      ?.focus();
  };

  return (
    <aside
      data-side-panel
      className="border-ink flex w-80 min-w-0 shrink-0 flex-col border-l"
    >
      <div
        tabIndex={0}
        role="tablist"
        aria-label="Side panel"
        className="border-ink flex min-w-0 gap-0 overflow-x-auto border-b px-1 pt-2"
        onKeyDown={onTabKeyDown}
      >
        {Arr.map(tabs, ({ id, label, disabled }) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`${idPrefix}-${id}-tab`}
            data-tab={id}
            aria-selected={tab === id}
            aria-controls={`${idPrefix}-${id}`}
            aria-disabled={disabled}
            disabled={disabled}
            title={
              disabled
                ? "Editing is off while a past revision is open"
                : undefined
            }
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
      <TabPanel id="details" prefix={idPrefix} open={tab}>
        {renderContent(
          panelContentOf({
            packet,
            pinned: selected === null ? undefined : byId.get(selected),
            inside: inside === null ? undefined : byId.get(inside),
            hop: selectedHop,
            spot,
          })
        )}
      </TabPanel>
      <TabPanel id="questions" prefix={idPrefix} open={tab}>
        <QuestionsTab
          onPicked={() => {
            choose("details");
          }}
        />
      </TabPanel>
      {connections === null ? null : (
        <TabPanel id="flows" prefix={idPrefix} open={tab}>
          <FlowsTab />
        </TabPanel>
      )}
      {editing === null ? null : (
        <TabPanel id="pending" prefix={idPrefix} open={tab}>
          <PendingTab />
        </TabPanel>
      )}
      {history === null ? null : (
        <TabPanel id="history" prefix={idPrefix} open={tab}>
          <HistoryTab />
        </TabPanel>
      )}
      <DockedForms />
      <DragWarnings className="border-x-0 border-b-0" />
    </aside>
  );
}
