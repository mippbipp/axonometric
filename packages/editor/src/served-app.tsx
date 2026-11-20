import {
  addedIds,
  applyLayoutChanges,
  emptyProposals,
  hopCandidateProblems,
  committedRenames,
  frozenStructureChanges,
  openStructureChanges,
  frozenLayoutChanges,
  proposalProblems,
  proposedMap,
  openItems,
  reviewEntries,
} from "@axonometric/contracts";
import type { EditNotice } from "@axonometric/contracts";
import { cn } from "@axonometric/ui/lib/utils";
import { Array as Arr } from "effect";
import { useMemo, useSyncExternalStore } from "react";

import { AcceptingContext } from "./accepting-context.ts";
import type { Accepting } from "./accepting-context.ts";
import { AgentProposalNotice } from "./agent-proposal-notice.tsx";
import { App } from "./app.tsx";
import { CompareContext } from "./compare-context.ts";
import { ConnectionsContext } from "./connections-context.ts";
import type { Connections } from "./connections-context.ts";
import { EditContext } from "./edit-context.ts";
import type { EditSwitch } from "./edit-context.ts";
import { useStoredEdit } from "./edit-store.ts";
import { EditingContext } from "./editing-context.ts";
import type { Editing } from "./editing-context.ts";
import { ExportStateContext } from "./export-state-context.ts";
import { HistoryContext } from "./history-context.ts";
import { useHistoryView } from "./history-view.tsx";
import { ProposalOpsContext } from "./proposal-ops-context.ts";
import type { ProposalOps } from "./proposal-ops-context.ts";
import { ProposedAddsContext } from "./proposed-adds-context.ts";
import { ProposedContext } from "./proposed-context.ts";
import type { ProposedStructures } from "./proposed-context.ts";
import { RenamesContext } from "./renames-context.ts";
import { RestoreDialog } from "./restore-dialog.tsx";
import { ReviewContext } from "./review-context.ts";
import type { Review } from "./review-context.ts";
import type { Rejection, SavedRevision, ServedStore } from "./served-store.ts";

/**
 * The served page's notices. The page shows them under the chapter rail, over
 * the canvas, so they never change its size: a resize refits the view and
 * loses the zoom. A long list of problems scrolls inside the banner.
 */
function ServedNotices({
  notice,
  rejection,
  saved,
  stopped,
}: {
  readonly notice: EditNotice | null;
  readonly rejection: Rejection | null;
  readonly saved: SavedRevision | null;
  readonly stopped: boolean;
}) {
  return (
    <>
      {saved === null ? null : (
        <output
          className="border-ink bg-paper text-ink pointer-events-auto max-w-full shrink-0 border px-3 py-1.5 text-xs"
          data-saved-revision={saved.revision}
        >
          <b className="font-medium">Saved revision {saved.revision}</b>
          {`: ${saved.message}`}
        </output>
      )}
      {stopped ? (
        <output
          className="border-ink bg-paper text-ink pointer-events-auto max-w-full shrink-0 border px-3 py-1.5 text-xs"
          data-server-stopped
        >
          Server stopped. This is the last map it sent, and editing is off. If
          serve starts again at this address, the page reconnects. If it starts
          on another port, open the URL it prints.
        </output>
      ) : null}
      {notice === null ? null : (
        <output
          className={cn(
            "bg-paper text-ink pointer-events-auto max-w-full shrink-0 border-2 px-3 py-1.5 text-xs",
            notice.kind === "info" ? "border-ink" : "border-refused"
          )}
          data-edit-notice={notice.kind}
        >
          {notice.message}
        </output>
      )}
      {rejection === null ? null : (
        <section
          className="border-ink bg-paper text-ink pointer-events-auto flex min-h-0 w-full max-w-3xl flex-col gap-1.5 overflow-auto border-2 px-3 py-2 text-xs"
          data-map-error
          role="alert"
        >
          <h2 className="font-medium tracking-widest uppercase">
            The map files have an error
          </h2>
          <p>{rejection.summary}</p>
          <ul className="flex flex-col gap-1">
            {Arr.map(rejection.problems, (problem) => (
              <li
                data-map-problem={problem.severity}
                key={`${problem.file} ${problem.path} ${problem.message}`}
              >
                <b className="font-medium">{problem.severity}</b> {problem.file}
                {problem.path === "" ? null : ` ${problem.path}`}:{" "}
                {problem.message}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

const none: ReadonlyArray<string> = [];

/**
 * The map page as `axonometric serve` serves it, kept up to date. It shows
 * the accepted layout with the pending changes applied, and edits them
 * while the server is up.
 *
 * Editing is off until the engineer turns Edit on, and the browser remembers
 * the choice. With it off the page hides every editing control and keeps
 * what it draws, such as pending changes and proposals.
 *
 * Opening a revision from the History tab swaps the map for that revision's
 * and takes editing away, under the same providers, so the chapter, the
 * selection, the view and the zoom stay. `useHistoryView` holds that, the
 * compare and the restore.
 */
export function ServedApp({ store }: { readonly store: ServedStore }) {
  const view = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const accepted = view.state.layout;
  const { pending } = view;

  const proposals = view.state.proposals ?? emptyProposals;
  const frozen = useMemo(() => frozenLayoutChanges(proposals), [proposals]);

  // Frozen items wait for the agent. They stay drawn as pending, under the
  // open ones. Layout changes land on the accepted layout last, so a
  // structure that is only proposed can be dragged like any other.
  const proposed = useMemo(
    () =>
      proposedMap({
        proposals: { ...proposals, layout: pending },
        state: view.state,
      }),
    [view.state, proposals, pending]
  );

  const adds = useMemo(
    () =>
      addedIds([
        ...openStructureChanges(proposals),
        ...frozenStructureChanges(proposals),
      ]),
    [proposals]
  );

  const shown = useMemo(
    () => ({
      ...proposed.state,
      layout: applyLayoutChanges(proposed.state.layout, frozen),
    }),
    [proposed.state, frozen]
  );

  const renames = useMemo(() => committedRenames(proposals), [proposals]);

  // What an export saves: the map as it was before proposals, with the
  // pending layout changes it always showed.
  const exported = useMemo(
    () => ({
      ...view.state,
      layout: applyLayoutChanges(accepted, [...frozen, ...pending]),
    }),
    [view.state, accepted, frozen, pending]
  );

  const history = useHistoryView({ shown, store, view });

  const [editOn, setEditOn] = useStoredEdit();

  const editSwitch = useMemo(
    (): EditSwitch => ({ on: editOn, set: setEditOn }),
    [editOn, setEditOn]
  );

  const editing = useMemo(
    (): Editing | null =>
      history.past
        ? null
        : {
            accepted,
            arrange: store.arrange,
            canEdit: !view.stopped,
            canRedo: view.canRedo,
            canUndo: view.canUndo,
            discard: store.discard,
            frozen,
            pending,
            place: store.place,
            redo: store.redo,
            refusalOf: store.refusalOf,
            refusalOfMoves: store.refusalOfMoves,
            refusalOfReroute: store.refusalOfReroute,
            reroute: store.reroute,
            undo: store.undo,
          },
    [
      history.past,
      accepted,
      pending,
      frozen,
      view.stopped,
      view.canUndo,
      view.canRedo,
      store,
    ]
  );

  const accepting = useMemo(
    (): Accepting => ({
      accept: store.accept,
      busy: view.accepting,
      canAccept: !view.stopped,
    }),
    [view.stopped, view.accepting, store]
  );

  const proposing = useMemo((): ProposedStructures | null => {
    const names = new Map(
      Arr.map(proposed.state.data.structures, ({ id, name }) => [id, name])
    );

    return {
      canPropose: !view.stopped,
      discard: store.structures.discard,
      isOpenAdd: store.structures.isOpenAdd,
      nameOf: (id) => names.get(id) ?? id,
      open: proposals.structures ?? [],
      place: store.structures.place,
      problemsOf: (items, options) =>
        proposalProblems({
          before: { data: shown.data, layout: shown.layout },
          items,
          moved: options?.moved,
          scope: options?.scope,
        }),
      propose: store.structures.propose,
      proposed,
      refusalOf: store.structures.refusalOf,
      refusalOfPlace: store.structures.refusalOfPlace,
    };
  }, [proposed, shown, proposals.structures, view.stopped, store]);

  const proposalOps = useMemo(
    (): ProposalOps => ({
      acceptedChapters: view.state.data.chapters,
      canPropose: !view.stopped,
      chapters: {
        discard: store.chapters.discard,
        open: proposals.chapters ?? [],
        propose: store.chapters.propose,
      },
      groups: {
        discard: store.groups.discard,
        open: proposals.groups ?? [],
        propose: store.groups.propose,
      },
      proposed,
    }),
    [
      proposals.groups,
      proposals.chapters,
      view.stopped,
      view.state.data.chapters,
      proposed,
      store,
    ]
  );

  const connecting = useMemo(
    (): Connections => ({
      canPropose: !view.stopped,
      discard: store.review.discardProposal,
      problemsOfHop: (change) =>
        hopCandidateProblems({
          before: { data: shown.data, layout: shown.layout },
          change,
        }),
      proposed,
      proposeFlow: store.flows.propose,
      proposeHop: store.hops.propose,
      refusalOfFlow: store.flows.refusalOf,
      refusalOfHop: store.hops.refusalOf,
    }),
    [proposed, shown, view.stopped, store]
  );

  const review = useMemo((): Review => {
    const entries = reviewEntries(proposals);

    return {
      canWrite: !view.stopped,
      entries,
      openText: Arr.filter(
        openItems(proposals),
        ({ kind }) => kind !== "layout"
      ).length,
      ops: store.review,
      replaces: proposals.replaces ?? {},
    };
  }, [proposals, view.stopped, store]);

  return (
    <EditContext value={editSwitch}>
      <EditingContext value={editing}>
        <AcceptingContext value={accepting}>
          <ReviewContext value={review}>
            <ProposedContext value={history.past ? null : proposing}>
              <ConnectionsContext value={history.past ? null : connecting}>
                <ProposalOpsContext value={history.past ? null : proposalOps}>
                  <RenamesContext value={renames}>
                    <ExportStateContext value={history.past ? null : exported}>
                      <ProposedAddsContext value={history.past ? none : adds}>
                        <HistoryContext value={history.panel}>
                          <CompareContext value={history.marks}>
                            <App
                              notices={
                                <>
                                  {history.banner}
                                  <AgentProposalNotice />
                                  <ServedNotices
                                    notice={view.notice}
                                    rejection={view.rejection}
                                    saved={view.saved}
                                    stopped={view.stopped}
                                  />
                                </>
                              }
                              state={history.drawn}
                            />
                            {history.report === null ? null : (
                              <RestoreDialog
                                onClose={history.handleCloseReport}
                                report={history.report}
                              />
                            )}
                          </CompareContext>
                        </HistoryContext>
                      </ProposedAddsContext>
                    </ExportStateContext>
                  </RenamesContext>
                </ProposalOpsContext>
              </ConnectionsContext>
            </ProposedContext>
          </ReviewContext>
        </AcceptingContext>
      </EditingContext>
    </EditContext>
  );
}
