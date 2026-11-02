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
  revision,
  base,
}: {
  readonly accepted: MapState;
  readonly revision: Revision;
  /** A fresh change id, which the added changes' ids are built from. */
  readonly base: ChangeId;
}): Edit => {
  const snapshot = { data: revision.data, layout: revision.layout };

  return (changes, layout) => {
    let used = 0;

    return restoreChanges({
      current: accepted.data,
      revision: snapshot,
      changes,
      accepted: layout,
      newId: () => {
        used += 1;

        return `${base}-${used}`;
      },
    });
  };
};

/** What the page does with a past revision that is open. */
export interface HistoryViewState {
  /** The map to draw: the revision when one is open, else the current map. */
  readonly drawn: MapState;
  /** Whether a past revision is open, which turns editing off. */
  readonly past: boolean;
  /** What Compare highlights, or `null` when it is off. */
  readonly marks: CompareMarks | null;
  readonly panel: HistoryPanel;
  /** The banner over the canvas while a revision is open. */
  readonly banner: ReactNode;
  /** Said by the restore dialog, or `null` when it is closed. */
  readonly report: RestoreReport | null;
  readonly handleCloseReport: () => void;
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
  store,
  view,
  shown,
}: {
  readonly store: ServedStore;
  readonly view: ServedView;
  readonly shown: MapState;
}): HistoryViewState => {
  const { opened, open, close } = useOpenedRevision(store.loadRevision);
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
            diff,
            current: state.data,
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
      revision: base,
      diff,
    });

    return { ...base, data, layout };
  }, [past, diff, comparing, shown, state]);

  const panel = useMemo(
    (): HistoryPanel => ({
      entries: view.history,
      opened: opened?.revision ?? null,
      loading: opened?.status === "loading",
      failure: opened?.status === "failed" ? opened.message : null,
      open,
      pendingCount: view.pending.length,
      differences: comparing ? lines : null,
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
      restoring({ accepted: state, revision: past, base: newChangeId() })
    );

    setReport({
      revision: past.revision,
      restored: refusal === undefined ? lines.layout : [],
      refusal,
      meaning: lines.meaning,
      routes: lines.routes,
    });

    if (refusal === undefined) {
      back();
    }
  };

  const banner =
    past === null || lines === null ? null : (
      <RevisionBanner
        revision={past.revision}
        message={past.message}
        savedAt={past.savedAt}
        comparing={comparing}
        onCompare={() => {
          setComparing((now) => !now);
        }}
        differences={{
          layout: lines.layout.length,
          meaning: lines.meaning.length,
        }}
        canRestore={!view.stopped}
        onRestore={restore}
        onBack={back}
      />
    );

  return {
    drawn,
    past: past !== null,
    marks,
    panel,
    banner,
    report,
    handleCloseReport: () => {
      setReport(null);
    },
  };
};
