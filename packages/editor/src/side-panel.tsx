import type { GridPoint, Group, Structure } from "@axonometric/contracts";
import {
  Tabs,
  TabsList,
  TabsPanel,
  TabsTab,
} from "@axonometric/ui/components/tabs";
import { Array as Arr, Match, Option } from "effect";
import { useMemo } from "react";

import { AddStructureForm } from "./add-structure.tsx";
import { ChapterEditor } from "./chapter-editor.tsx";
import { useConnections } from "./connections-context.ts";
import { controlClass } from "./control-class.ts";
import { DragWarnings } from "./drag-preview.tsx";
import { DrawHopForm } from "./draw-hop-form.tsx";
import { useEditOn } from "./edit-context.ts";
import { useEditingIgnoringEdit } from "./editing-context.ts";
import { FlowsTab } from "./flows-tab.tsx";
import { GroupPanel } from "./group-panel.tsx";
import { useHistory } from "./history-context.ts";
import { HistoryTab } from "./history-tab.tsx";
import { useHopDraft } from "./hop-draft-context.ts";
import { HopPanel } from "./hop-panel.tsx";
import { useNewGroupForm } from "./new-group-context.ts";
import { NewGroupForm } from "./new-group.tsx";
import { useNoteTool } from "./note-tool-context.ts";
import { PendingTab } from "./pending-tab.tsx";
import { usePlacing } from "./place-context.ts";
import { usePlayback } from "./playback.ts";
import type { SelectedPacket } from "./playback.ts";
import { QuestionsTab } from "./questions.tsx";
import { useRevealedQuestions } from "./revealed-questions.ts";
import { useReview } from "./review-context.ts";
import { useSelection } from "./selection-context.ts";
import { useSideTab } from "./side-tab-context.ts";
import type { Tab } from "./side-tab-context.ts";
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
  const { back, index, isLast, next, stop, stops } = useWalkthrough();
  const names = useStructureNames();

  return (
    <section className="flex flex-col gap-3" data-chapter-story>
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
                className="border-ink border border-dashed px-1.5 py-0.5 text-xs"
                key={id}
              >
                {names.get(id) ?? id}
              </li>
            ))}
          </ul>
        </div>
      )}
      <ChapterEditor />
      <div className="flex gap-1.5">
        <button
          className={controlClass}
          disabled={index === 0}
          onClick={back}
          type="button"
        >
          ◂ Back
        </button>
        <button
          className={controlClass}
          disabled={isLast}
          onClick={next}
          type="button"
        >
          Next ▸
        </button>
      </div>
    </section>
  );
}

function PacketDetails({ packet }: { readonly packet: SelectedPacket }) {
  const { closePacket, play, reducedMotion, step } = usePlayback();
  const { hop, index, run } = packet;
  const names = useStructureNames();
  const nameOf = (id: string) => names.get(id) ?? id;

  return (
    <section className="flex flex-col gap-3" data-packet-panel={hop.id}>
      <p className="text-xs tracking-widest uppercase opacity-70">
        Packet · {run.name} · hop {index + 1} of {run.hops.length}
      </p>
      <h2 className="text-lg leading-tight font-medium" data-packet-label>
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
          className="border-ink bg-face overflow-auto border p-2 text-xs"
          data-packet-payload
        >
          {/* oxlint-disable-next-line effecttsgo/global-json -- displays a payload example, which is plain JSON */}
          {JSON.stringify(hop.payload, null, 2)}
        </pre>
      )}
      <div className="flex gap-1.5">
        <button className={controlClass} onClick={step} type="button">
          Step
        </button>
        {reducedMotion ? null : (
          <button className={controlClass} onClick={play} type="button">
            ▸ Play
          </button>
        )}
        <button
          className={controlClass}
          data-control="close"
          onClick={closePacket}
          type="button"
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
  | { readonly hop: string; readonly kind: "hop" }
  | { readonly group: Group; readonly kind: "group" }
  | { readonly kind: "spot"; readonly spot: GridPoint }
  | { readonly kind: "packet"; readonly packet: SelectedPacket }
  | { readonly kind: "structure"; readonly structure: Structure }
  | { readonly kind: "inside"; readonly structure: Structure };

const panelContentOf = ({
  group,
  hop,
  inside,
  packet,
  pinned,
  spot,
}: {
  readonly group: Group | undefined;
  readonly hop: string | null;
  readonly inside: Structure | undefined;
  readonly packet: SelectedPacket | null;
  readonly pinned: Structure | undefined;
  readonly spot: GridPoint | null;
}): PanelContent => {
  if (inside !== undefined) {
    return { kind: "inside", structure: inside };
  }

  if (packet !== null) {
    return { kind: "packet", packet };
  }

  if (hop !== null) {
    return { hop, kind: "hop" };
  }

  if (group !== undefined) {
    return { group, kind: "group" };
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
    group: ({ group }) => <GroupPanel group={group} key={group.id} />,
    hop: ({ hop }) => <HopPanel id={hop} key={hop} />,
    inside: ({ structure }) => <InsidePanel structure={structure} />,
    packet: ({ packet }) => <PacketDetails packet={packet} />,
    spot: ({ spot }) => <SpotPanel key={`${spot.x},${spot.y}`} spot={spot} />,
    structure: ({ structure }) => (
      <StructurePanel key={structure.id} structure={structure} />
    ),
  })
);

const tabListClass =
  "border-ink h-auto w-full min-w-0 flex-wrap justify-start gap-1 border-b bg-transparent px-3 py-2 group-data-[orientation=horizontal]/tabs:h-auto";

const tabClass =
  "border-ink focus-visible:border-transparent focus-visible:outline-ink h-auto transition-none flex-none px-2 py-0.5 font-normal text-ink uppercase hover:border-ink hover:text-ink focus-visible:ring-0 focus-visible:outline-2 focus-visible:-outline-offset-2 data-[disabled]:hover:border-transparent data-[selected]:bg-ink data-[selected]:text-paper";

const panelClass =
  "focus-visible:outline-ink min-h-0 flex-1 overflow-y-auto p-4 focus-visible:outline-2 focus-visible:-outline-offset-2";

/** The tabs to show: Pending only while the page can edit, History only when served. */
const tabsOf = ({
  flowsOff,
  hasFlows,
  hasHistory,
  openCount,
  pendingCount,
  pendingOff,
}: {
  /** Whether the Flows tab is shown but can't be used, as while a past revision is open. */
  readonly flowsOff: boolean;
  /** Whether the page shows the Flows tab: it can propose changes to flows and Edit is on, or a past revision is open. */
  readonly hasFlows: boolean;
  readonly hasHistory: boolean;
  readonly openCount: number;
  /** How many changes are pending, or `undefined` on a page that can't edit. */
  readonly pendingCount: number | undefined;
  /** Whether the Pending tab is shown but can't be used, as while a past revision is open. */
  readonly pendingOff: boolean;
}): ReadonlyArray<{
  readonly disabled: boolean;
  readonly id: Tab;
  readonly label: string;
}> => [
  { disabled: false, id: "details", label: "Details" },
  { disabled: false, id: "questions", label: `Questions · ${openCount}` },
  ...(hasFlows
    ? [{ disabled: flowsOff, id: "flows" as const, label: "Flows" }]
    : []),
  ...(pendingCount === undefined
    ? []
    : [
        {
          disabled: pendingOff,
          id: "pending" as const,
          label: `Pending · ${pendingCount}`,
        },
      ]),
  ...(hasHistory
    ? [{ disabled: false, id: "history" as const, label: "History" }]
    : []),
];

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
  const newGroup = useNewGroupForm();

  return (
    <>
      {newGroup?.open === true ? (
        <section
          aria-label="Create a group"
          className="border-ink bg-paper flex max-h-[55svh] shrink-0 flex-col gap-2 overflow-y-auto border-t p-3"
          data-new-group-panel
        >
          <h2 className="text-xs tracking-widest uppercase opacity-70">
            Create a group
          </h2>
          <NewGroupForm
            onDone={() => {
              newGroup.setOpen(false);
            }}
          />
        </section>
      ) : null}
      {placing?.open === true ? (
        <section
          aria-label="Add a structure"
          className="border-ink bg-paper flex max-h-[55svh] shrink-0 flex-col gap-2 overflow-y-auto border-t p-3"
          data-add-structure-panel
        >
          <h2 className="text-xs tracking-widest uppercase opacity-70">
            Add a structure
          </h2>
          <AddStructureForm />
        </section>
      ) : null}
      {drafting?.draft === null ? null : (
        <section
          aria-label="Draw a hop"
          className="border-ink bg-paper flex max-h-[55svh] shrink-0 flex-col gap-2 overflow-y-auto border-t p-3"
          data-draw-hop-panel
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

/** How many questions are open across the groups. */
const openQuestionCount = (
  groups: ReadonlyArray<{ readonly questions: ReadonlyArray<unknown> }>
): number =>
  Arr.reduce(groups, 0, (sum, group) => sum + group.questions.length);

/** The Pending tab's count, or `undefined` on a page that can't edit. */
const pendingCountOf = ({
  editing,
  past,
  waiting,
}: {
  readonly editing: number | undefined;
  readonly past: number | undefined;
  readonly waiting: number;
}): number | undefined => {
  const layout = editing ?? past;

  return layout === undefined ? undefined : layout + waiting;
};

/**
 * The side panel next to the view. Details shows one of the `PanelContent`
 * kinds; Open questions lists every question revealed so far; on a page
 * `serve` serves, Pending lists the pending layout changes and History lists
 * the revisions. Selecting a structure anywhere switches back to Details.
 */
export function SidePanel() {
  const { selected: packet } = usePlayback();
  const { inside, selected, selectedGroup, selectedHop } = useSelection();
  const { state } = useWalkthrough();
  const spot = useNoteTool()?.spot ?? null;
  const byId = useStructuresById();
  const { open } = useRevealedQuestions();

  const openCount = openQuestionCount(open);

  const editing = useEditingIgnoringEdit();
  const editOn = useEditOn();
  const history = useHistory();
  const waiting = useWaitingCount();
  const connections = useConnections();

  // While a past revision is open there is no editing, but the tab strip
  // keeps its Pending tab and count, so it doesn't move.
  const pendingCount = pendingCountOf({
    editing: editing?.pending.length,
    past: history?.pendingCount,
    waiting,
  });

  const tabs = tabsOf({
    flowsOff: connections === null,
    hasFlows: editOn && (connections !== null || history !== null),
    hasHistory: history !== null,
    openCount,
    pendingCount,
    pendingOff: editing === null,
  });

  // A tab other than Details stays open until the selection changes.
  const { choose, chosen } = useSideTab();

  const tab: Tab = Arr.some(
    tabs,
    ({ disabled, id }) => id === chosen && !disabled
  )
    ? chosen
    : "details";

  return (
    <aside
      className="border-ink flex w-80 min-w-0 shrink-0 flex-col border-l"
      data-side-panel
    >
      <Tabs<Tab>
        className="min-h-0 flex-1 gap-0"
        onValueChange={(next) => {
          if (next !== null) {
            choose(next);
          }
        }}
        value={tab}
      >
        <TabsList aria-label="Side panel" className={tabListClass}>
          {Arr.map(tabs, ({ disabled, id, label }) => (
            <TabsTab
              className={tabClass}
              data-tab={id}
              disabled={disabled}
              key={id}
              title={
                disabled
                  ? "Editing is off while a past revision is open"
                  : undefined
              }
              value={id}
            >
              {label}
            </TabsTab>
          ))}
        </TabsList>
        <TabsPanel className={panelClass} value="details">
          {renderContent(
            panelContentOf({
              group: Arr.findFirst(
                state.data.groups,
                ({ id }) => id === selectedGroup
              ).pipe(Option.getOrUndefined),
              hop: selectedHop,
              inside: inside === null ? undefined : byId.get(inside),
              packet,
              pinned: selected === null ? undefined : byId.get(selected),
              spot,
            })
          )}
        </TabsPanel>
        <TabsPanel className={panelClass} value="questions">
          <QuestionsTab
            onPicked={() => {
              choose("details");
            }}
          />
        </TabsPanel>
        {connections === null ? null : (
          <TabsPanel className={panelClass} value="flows">
            <FlowsTab />
          </TabsPanel>
        )}
        {editing === null ? null : (
          <TabsPanel className={panelClass} value="pending">
            <PendingTab />
          </TabsPanel>
        )}
        {history === null ? null : (
          <TabsPanel className={panelClass} value="history">
            <HistoryTab />
          </TabsPanel>
        )}
      </Tabs>
      <DockedForms />
      <DragWarnings className="border-x-0 border-b-0" />
    </aside>
  );
}
