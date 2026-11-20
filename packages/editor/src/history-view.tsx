import {
  compareMarks,
  describeDifferences,
  diffMaps,
  ghostedMap,
  newChangeId,
  restoreChanges,
} from "@axonometric/contracts";
import type {
  ChangeId,
  CompareMarks,
  MapState,
  Revision,
} from "@axonometric/contracts";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";

import type { HistoryPanel } from "./history-context.ts";
import { useOpenedRevision } from "./opened-revision.ts";
import type { RestoreReport } from "./restore-dialog.tsx";
import { RevisionBanner } from "./revision-banner.tsx";
import type { Edit, ServedView, ServedStore } from "./served-store.ts";

/**
 * The edit that restores `revision`: it puts every structure where the
 * revision has it. It is pure: the ids of the changes it adds come from
 * `base`, so running it again on a fresher list gives the same answer.
 */
export const restoring = ({
  accepted,
  base,
  revision,
}: {
  readonly accepted: MapState;
  /** A fresh change id, which the added changes' ids are built from. */
  readonly base: ChangeId;
  readonly revision: Revision;
}): Edit => {
  const snapshot = { data: revision.data, layout: revision.layout };

  return (changes, layout) => {
    let used = 0;

    return restoreChanges({
      accepted: layout,
      changes,
      current: accepted.data,
      newId: () => {
        used += 1;

        return `${base}-${used}`;
      },
      revision: snapshot,
    });
  };
};

/** What the page does with a past revision that is open. */
export interface HistoryViewState {
  /** The banner over the canvas while a revision is open. */
  readonly banner: ReactNode;
  /** The map to draw: the revision when one is open, else the current map. */
  readonly drawn: MapState;
  readonly handleCloseReport: () => void;
  /** What Compare highlights, or `null` when it is off. */
  readonly marks: CompareMarks | null;
  readonly panel: HistoryPanel;
  /** Whether a past revision is open, which turns editing off. */
  readonly past: boolean;
  /** Said by the restore dialog, or `null` when it is closed. */
  readonly report: RestoreReport | null;
}

/**
 * Opens past revisions, compares them with the accepted map and restores
 * them as pending changes. A revision is an accepted state, so the compare
 * is against the accepted layout and leaves pending changes out.
 *
 * `shown` is the map the page draws when no revision is open: the accepted
 * layout with the pending changes applied.
 */
export const useHistoryView = ({
  shown,
  store,
  view,
}: {
  readonly shown: MapState;
  readonly store: ServedStore;
  readonly view: ServedView;
}): HistoryViewState => {
  const { close, open, opened } = useOpenedRevision(store.loadRevision);
  const [comparing, setComparing] = useState(false);
  const [report, setReport] = useState<RestoreReport | null>(null);
  const past = opened?.status === "ready" ? opened.saved : null;
  const { state } = view;

  const diff = useMemo(
    () =>
      past === null
        ? null
        : diffMaps(state, { data: past.data, layout: past.layout }),
    [state, past]
  );

  const lines = useMemo(
    () =>
      past === null || diff === null
        ? null
        : describeDifferences({
            current: state.data,
            diff,
            revision: past.data,
            revisionName: `revision ${past.revision}`,
          }),
    [diff, state.data, past]
  );

  const marks = useMemo(
    () => (diff === null || !comparing ? null : compareMarks(diff)),
    [diff, comparing]
  );

  const drawn = useMemo((): MapState => {
    if (past === null || diff === null) {
      return shown;
    }

    const base = { ...state, data: past.data, layout: past.layout };

    if (!comparing) {
      return base;
    }

    const { data, layout } = ghostedMap({
      current: state,
      diff,
      revision: base,
    });

    return { ...base, data, layout };
  }, [past, diff, comparing, shown, state]);

  const panel = useMemo(
    (): HistoryPanel => ({
      differences: comparing ? lines : null,
      entries: view.history,
      failure: opened?.status === "failed" ? opened.message : null,
      loading: opened?.status === "loading",
      open,
      opened: opened?.revision ?? null,
      pendingCount: view.pending.length,
    }),
    [view.history, view.pending.length, opened, open, comparing, lines]
  );

  const back = () => {
    close();
    setComparing(false);
  };

  const restore = () => {
    if (past === null || lines === null) {
      return;
    }

    const refusal = store.restore(
      restoring({ accepted: state, base: newChangeId(), revision: past })
    );

    setReport({
      meaning: lines.meaning,
      refusal,
      restored: refusal === undefined ? lines.layout : [],
      revision: past.revision,
      routes: lines.routes,
    });

    if (refusal === undefined) {
      back();
    }
  };

  const banner =
    past === null || lines === null ? null : (
      <RevisionBanner
        canRestore={!view.stopped}
        comparing={comparing}
        differences={{
          layout: lines.layout.length,
          meaning: lines.meaning.length,
        }}
        message={past.message}
        onBack={back}
        onCompare={() => {
          setComparing((now) => !now);
        }}
        onRestore={restore}
        revision={past.revision}
        savedAt={past.savedAt}
      />
    );

  return {
    banner,
    drawn,
    handleCloseReport: () => {
      setReport(null);
    },
    marks,
    panel,
    past: past !== null,
    report,
  };
};
