import {
  applyLayoutChanges,
  emptyProposals,
  frozenLayoutChanges,
  reviewEntries,
} from "@axonometric/contracts";
import { cn } from "@axonometric/ui/lib/utils";
import { Array as Arr } from "effect";
import { useMemo, useSyncExternalStore } from "react";

import { AcceptingContext } from "./accepting-context.ts";
import type { Accepting } from "./accepting-context.ts";
import { App } from "./app.tsx";
import { CompareContext } from "./compare-context.ts";
import { EditingContext } from "./editing-context.ts";
import type { Editing } from "./editing-context.ts";
import { HistoryContext } from "./history-context.ts";
import { useHistoryView } from "./history-view.tsx";
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

  // Frozen layout changes wait for the agent. They stay drawn as pending,
  // under the open ones.
  const shown = useMemo(
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

  const review = useMemo((): Review => {
    const entries = reviewEntries(proposals);

    return {
      canWrite: !view.stopped,
      entries,
      notes: Arr.filter(entries, ({ item }) => item.kind === "note"),
      openNotes: proposals.notes?.length ?? 0,
      replaces: proposals.replaces ?? {},
      ops: store.review,
    };
  }, [proposals, view.stopped, store]);

  return (
    <EditingContext value={editing}>
      <AcceptingContext value={accepting}>
        <ReviewContext value={review}>
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
        </ReviewContext>
      </AcceptingContext>
    </EditingContext>
  );
}
