import {
  applyLayoutChanges,
  compareMarks,
  describeDifferences,
  diffMaps,
  ghostedMap,
  newChangeId,
  restoreChanges,
} from "@axonometric/contracts";
import type { ChangeId, MapState, Revision } from "@axonometric/contracts";
import { cn } from "@axonometric/ui/lib/utils";
import { Array as Arr } from "effect";
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";

import { AcceptingContext } from "./accepting-context.ts";
import type { Accepting } from "./accepting-context.ts";
import { App } from "./app.tsx";
import { CompareContext } from "./compare-context.ts";
import { EditingContext } from "./editing-context.ts";
import type { Editing } from "./editing-context.ts";
import { HistoryContext } from "./history-context.ts";
import type { HistoryPanel } from "./history-context.ts";
import { useOpenedRevision } from "./opened-revision.ts";
import { RestoreDialog } from "./restore-dialog.tsx";
import type { RestoreReport } from "./restore-dialog.tsx";
import { RevisionBanner } from "./revision-banner.tsx";
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
 * An edit that restores `revision`: it puts every structure where the
 * revision has it. The ids of the changes it adds are made once, on first
 * use, so running it again on a fresher list gives the same answer.
 */
const restoring = (current: MapState, revision: Revision) => {
  const ids: ChangeId[] = [];

  return (changes: Parameters<typeof applyLayoutChanges>[1], accepted: MapState["layout"]) => {
    let used = 0;

    return restoreChanges({
      current: current.data,
      revision: { data: revision.data, layout: revision.layout },
      changes,
      accepted,
      newId: () => {
        const made = ids[used] ?? newChangeId();

        ids[used] = made;
        used += 1;

        return made;
      },
    });
  };
};

/**
 * The map page as `axonometric serve` serves it, kept up to date. It shows
 * the accepted layout with the pending changes applied, and edits them
 * while the server is up.
 *
 * Opening a revision from the History tab swaps the map for that revision's
 * and takes editing away, under the same providers, so the chapter, the
 * selection, the view and the zoom stay. Compare adds the highlights and the
 * ghosts of what only the current map has. Restore turns the layout
 * differences into pending changes through the store, and lists the rest.
 */
export function ServedApp({ store }: { readonly store: ServedStore }) {
  const view = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const accepted = view.state.layout;
  const { pending } = view;
  const [comparing, setComparing] = useState(false);
  const [report, setReport] = useState<RestoreReport | null>(null);
  const { opened, open, close } = useOpenedRevision(store.loadRevision);

  const shown = useMemo(
    () => ({ ...view.state, layout: applyLayoutChanges(accepted, pending) }),
    [view.state, accepted, pending]
  );

  const past = opened?.status === "ready" ? opened.saved : null;

  const diff = useMemo(
    () =>
      past === null
        ? null
        : diffMaps(shown, { data: past.data, layout: past.layout }),
    [shown, past]
  );

  const marks = useMemo(
    () => (diff === null || !comparing ? null : compareMarks(diff)),
    [diff, comparing]
  );

  const drawn = useMemo((): MapState => {
    if (past === null || diff === null) {
      return shown;
    }

    const base = { ...view.state, data: past.data, layout: past.layout };

    if (!comparing) {
      return base;
    }

    const { data, layout } = ghostedMap({
      current: shown,
      revision: base,
      diff,
    });

    return { ...base, data, layout };
  }, [past, diff, comparing, shown, view.state]);

  const editing = useMemo(
    (): Editing | null =>
      past === null
        ? {
            accepted,
            pending,
            canEdit: !view.stopped,
            refusalOf: store.refusalOf,
            place: store.place,
            discard: store.discard,
            refusalOfMoves: store.refusalOfMoves,
            arrange: store.arrange,
            canUndo: view.canUndo,
            canRedo: view.canRedo,
            undo: store.undo,
            redo: store.redo,
          }
        : null,
    [
      past,
      accepted,
      pending,
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

  const panel = useMemo(
    (): HistoryPanel => ({
      entries: view.history,
      opened: opened?.revision ?? null,
      loading: opened?.status === "loading",
      failure: opened?.status === "failed" ? opened.message : null,
      open: (revision) => {
        open(revision);
      },
    }),
    [view.history, opened, open]
  );

  const restore = useCallback(() => {
    if (past === null || diff === null) {
      return;
    }

    const lines = describeDifferences({
      diff,
      current: shown.data,
      revision: past.data,
      revisionName: `revision ${past.revision}`,
    });

    const refusal = store.restore(restoring(shown, past));

    setReport({
      revision: past.revision,
      restored: refusal === undefined ? lines.layout : [],
      refusal,
      meaning: lines.meaning,
      routes: lines.routes,
    });

    if (refusal === undefined) {
      close();
      setComparing(false);
    }
  }, [past, diff, shown, store, close]);

  const differences = useMemo(() => {
    if (diff === null || past === null) {
      return { layout: 0, meaning: 0 };
    }

    const lines = describeDifferences({
      diff,
      current: shown.data,
      revision: past.data,
      revisionName: "",
    });

    return { layout: lines.layout.length, meaning: lines.meaning.length };
  }, [diff, past, shown.data]);

  return (
    <EditingContext value={editing}>
      <AcceptingContext value={accepting}>
        <HistoryContext value={panel}>
          <CompareContext value={marks}>
            <App
              state={drawn}
              notices={
                <>
                  {past === null ? null : (
                    <RevisionBanner
                      revision={past.revision}
                      message={past.message}
                      savedAt={past.savedAt}
                      comparing={comparing}
                      onCompare={() => {
                        setComparing((now) => !now);
                      }}
                      differences={differences}
                      canRestore={!view.stopped}
                      onRestore={restore}
                      onBack={() => {
                        close();
                        setComparing(false);
                      }}
                    />
                  )}
                  <ServedNotices
                    rejection={view.rejection}
                    stopped={view.stopped}
                    notice={view.notice}
                    saved={view.saved}
                  />
                </>
              }
            />
            {report === null ? null : (
              <RestoreDialog
                report={report}
                onClose={() => {
                  setReport(null);
                }}
              />
            )}
          </CompareContext>
        </HistoryContext>
      </AcceptingContext>
    </EditingContext>
  );
}
