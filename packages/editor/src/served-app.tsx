import {
  addedIds,
  applyLayoutChanges,
  candidateProblems,
  emptyProposals,
  frozenStructureChanges,
  openStructureChanges,
  frozenLayoutChanges,
  proposedMap,
  openItems,
  reviewEntries,
  structureRenames,
} from "@axonometric/contracts";
import { cn } from "@axonometric/ui/lib/utils";
import { Array as Arr } from "effect";
import { useMemo, useSyncExternalStore } from "react";

import { AcceptingContext } from "./accepting-context.ts";
import type { Accepting } from "./accepting-context.ts";
import { App } from "./app.tsx";
import { ChapterMarksContext } from "./chapter-marks-context.ts";
import { ChapterOpsContext } from "./chapter-ops-context.ts";
import type { ChapterOps } from "./chapter-ops-context.ts";
import { CompareContext } from "./compare-context.ts";
import { EditingContext } from "./editing-context.ts";
import type { Editing } from "./editing-context.ts";
import { ExportStateContext } from "./export-state-context.ts";
import { GroupOpsContext } from "./group-ops-context.ts";
import type { GroupOps } from "./group-ops-context.ts";
import { HistoryContext } from "./history-context.ts";
import { useHistoryView } from "./history-view.tsx";
import { ProposedAddsContext } from "./proposed-adds-context.ts";
import { ProposedContext } from "./proposed-context.ts";
import type { ProposedStructures } from "./proposed-context.ts";
import { RenamesContext } from "./renames-context.ts";
import { RestoreDialog } from "./restore-dialog.tsx";
import { ReviewContext } from "./review-context.ts";
import type { Review } from "./review-context.ts";
import type {
  EditNotice,
  Rejection,
  SavedRevision,
  ServedStore,
} from "./served-store.ts";

/**
 * The served page's notices. The page shows them under the chapter rail, over
 * the canvas, so they never change its size: a resize refits the view and
 * loses the zoom. A long list of problems scrolls inside the banner.
 */
function ServedNotices({
  rejection,
  stopped,
  notice,
  saved,
}: {
  readonly rejection: Rejection | null;
  readonly stopped: boolean;
  readonly notice: EditNotice | null;
  readonly saved: SavedRevision | null;
}) {
  return (
    <>
      {saved === null ? null : (
        <output
          data-saved-revision={saved.revision}
          className="border-ink bg-paper text-ink pointer-events-auto max-w-full shrink-0 border px-3 py-1.5 text-xs"
        >
          <b className="font-medium">Saved revision {saved.revision}</b>
          {`: ${saved.message}`}
        </output>
      )}
      {stopped ? (
        <output
          data-server-stopped
          className="border-ink bg-paper text-ink pointer-events-auto max-w-full shrink-0 border px-3 py-1.5 text-xs"
        >
          Server stopped. This is the last map it sent, and editing is off. If
          serve starts again at this address, the page reconnects. If it starts
          on another port, open the URL it prints.
        </output>
      ) : null}
      {notice === null ? null : (
        <output
          data-edit-notice={notice.kind}
          className={cn(
            "bg-paper text-ink pointer-events-auto max-w-full shrink-0 border-2 px-3 py-1.5 text-xs",
            notice.kind === "info" ? "border-ink" : "border-refused"
          )}
        >
          {notice.message}
        </output>
      )}
      {rejection === null ? null : (
        <section
          data-map-error
          role="alert"
          className="border-ink bg-paper text-ink pointer-events-auto flex min-h-0 w-full max-w-3xl flex-col gap-1.5 overflow-auto border-2 px-3 py-2 text-xs"
        >
          <h2 className="font-medium tracking-widest uppercase">
            The map files have an error
          </h2>
          <p>{rejection.summary}</p>
          <ul className="flex flex-col gap-1">
            {Arr.map(rejection.problems, (problem) => (
              <li
                key={`${problem.file} ${problem.path} ${problem.message}`}
                data-map-problem={problem.severity}
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

const none: readonly string[] = [];

/**
 * The map page as `axonometric serve` serves it, kept up to date. It shows
 * the accepted layout with the pending changes applied, and edits them
 * while the server is up.
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
        state: view.state,
        proposals: { ...proposals, layout: pending },
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

  const renames = useMemo(() => structureRenames(proposals), [proposals]);

  // What an export saves: the map as it was before proposals, with the
  // pending layout changes it always showed.
  const exported = useMemo(
    () => ({
      ...view.state,
      layout: applyLayoutChanges(accepted, [...frozen, ...pending]),
    }),
    [view.state, accepted, frozen, pending]
  );

  const history = useHistoryView({ store, view, shown });

  const editing = useMemo(
    (): Editing | null =>
      history.past
        ? null
        : {
            accepted,
            pending,
            frozen,
            canEdit: !view.stopped,
            refusalOf: store.refusalOf,
            place: store.place,
            discard: store.discard,
            refusalOfMoves: store.refusalOfMoves,
            arrange: store.arrange,
            reroute: store.reroute,
            refusalOfReroute: store.refusalOfReroute,
            canUndo: view.canUndo,
            canRedo: view.canRedo,
            undo: store.undo,
            redo: store.redo,
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
      canAccept: !view.stopped,
      busy: view.accepting,
      accept: store.accept,
    }),
    [view.stopped, view.accepting, store]
  );

  const proposing = useMemo((): ProposedStructures | null => {
    const names = new Map(
      Arr.map(proposed.state.data.structures, ({ id, name }) => [id, name])
    );

    return {
      proposed,
      canPropose: !view.stopped,
      open: proposals.structures ?? [],
      nameOf: (id) => names.get(id) ?? id,
      propose: store.structures.propose,
      refusalOf: store.structures.refusalOf,
      problemsOf: (changes, moved) =>
        candidateProblems({
          before: { data: shown.data, layout: shown.layout },
          changes,
          moved,
        }),
      isOpenAdd: store.structures.isOpenAdd,
      refusalOfPlace: store.structures.refusalOfPlace,
      place: store.structures.place,
      discard: store.structures.discard,
    };
  }, [proposed, shown, proposals.structures, view.stopped, store]);

  const groupOps = useMemo(
    (): GroupOps => ({
      canPropose: !view.stopped,
      open: proposals.groups ?? [],
      propose: store.groups.propose,
      discard: store.groups.discard,
    }),
    [proposals.groups, view.stopped, store]
  );

  const chapterOps = useMemo(
    (): ChapterOps => ({
      canPropose: !view.stopped,
      open: proposals.chapters ?? [],
      propose: store.chapters.propose,
      discard: store.chapters.discard,
    }),
    [proposals.chapters, view.stopped, store]
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
      replaces: proposals.replaces ?? {},
      ops: store.review,
    };
  }, [proposals, view.stopped, store]);

  return (
    <EditingContext value={editing}>
      <AcceptingContext value={accepting}>
        <ReviewContext value={review}>
          <ProposedContext value={history.past ? null : proposing}>
            <GroupOpsContext value={history.past ? null : groupOps}>
              <ChapterOpsContext value={history.past ? null : chapterOps}>
                <ChapterMarksContext value={history.past ? null : proposed}>
                  <RenamesContext value={renames}>
                    <ExportStateContext value={history.past ? null : exported}>
                      <ProposedAddsContext value={history.past ? none : adds}>
                        <HistoryContext value={history.panel}>
                          <CompareContext value={history.marks}>
                            <App
                              state={history.drawn}
                              notices={
                                <>
                                  {history.banner}
                                  <ServedNotices
                                    rejection={view.rejection}
                                    stopped={view.stopped}
                                    notice={view.notice}
                                    saved={view.saved}
                                  />
                                </>
                              }
                            />
                            {history.report === null ? null : (
                              <RestoreDialog
                                report={history.report}
                                onClose={history.handleCloseReport}
                              />
                            )}
                          </CompareContext>
                        </HistoryContext>
                      </ProposedAddsContext>
                    </ExportStateContext>
                  </RenamesContext>
                </ChapterMarksContext>
              </ChapterOpsContext>
            </GroupOpsContext>
          </ProposedContext>
        </ReviewContext>
      </AcceptingContext>
    </EditingContext>
  );
}
