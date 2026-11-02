import { Array as Arr } from "effect";
import { useEffect, useId, useRef } from "react";

import { controlClass } from "./control-class.ts";

/** What a restore did, for the dialog that reports it. */
export interface RestoreReport {
  readonly revision: number;
  /** The layout differences that became pending changes. */
  readonly restored: readonly string[];
  /** Why the layout couldn't be restored, when it couldn't. */
  readonly refusal: string | undefined;
  /** Differences in what the map says, which a restore can't turn into layout changes. */
  readonly meaning: readonly string[];
  /** Route differences, which aren&apos;t pending changes yet. */
  readonly routes: readonly string[];
}

function Lines({
  lines,
  name,
}: {
  readonly lines: readonly string[];
  readonly name: string;
}) {
  return (
    <ul className="flex list-disc flex-col gap-1 pl-5" data-restore-list={name}>
      {Arr.map(lines, (line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  );
}

/**
 * Says what a restore did, and lists the differences it couldn't turn into
 * pending layout changes, so none is dropped without a word. A modal dialog:
 * it takes focus, Escape closes it, and focus returns to where it came from.
 */
export function RestoreDialog({
  report,
  onClose,
}: {
  readonly report: RestoreReport;
  readonly onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const { revision, restored, refusal, meaning, routes } = report;

  useEffect(() => {
    const dialog = ref.current;

    if (dialog !== null && !dialog.open) {
      dialog.showModal();
    }

    return () => {
      dialog?.close();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      data-restore-dialog
      aria-labelledby={titleId}
      className="border-ink bg-paper text-ink m-auto max-h-[80svh] w-[min(36rem,90vw)] overflow-auto border-2 p-4 font-mono text-xs backdrop:bg-black/40"
      onClose={onClose}
    >
      <div className="flex flex-col gap-3">
        <h2
          id={titleId}
          className="text-sm font-medium tracking-widest uppercase"
        >
          Restore revision {revision}
        </h2>
        {refusal === undefined ? (
          restored.length > 0 ? (
            <>
              <p data-restore-done>
                {restored.length === 1
                  ? "1 layout difference is now a pending change."
                  : `${restored.length} layout differences are now pending changes.`}{" "}
                Review them in the Pending tab, or undo them.
              </p>
              <Lines lines={restored} name="layout" />
            </>
          ) : (
            <p data-restore-done>
              Revision {revision} has the same layout as the current map, so no
              layout changes were made.
            </p>
          )
        ) : (
          <p data-restore-refused role="alert">
            The layout wasn&apos;t restored: {refusal}
          </p>
        )}
        {meaning.length === 0 ? null : (
          <>
            <p data-restore-meaning>
              These differences change the map&apos;s meaning and can&apos;t be
              restored as layout changes:
            </p>
            <Lines lines={meaning} name="meaning" />
          </>
        )}
        {routes.length === 0 ? null : (
          <>
            <p data-restore-routes>
              These route overrides differ, and routes aren&apos;t pending
              changes yet:
            </p>
            <Lines lines={routes} name="routes" />
          </>
        )}
        <div className="flex justify-end">
          <button
            type="button"
            data-control="close-restore"
            className={controlClass}
            onClick={() => {
              ref.current?.close();
            }}
          >
            Close
          </button>
        </div>
      </div>
    </dialog>
  );
}
