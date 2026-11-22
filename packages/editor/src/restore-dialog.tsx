import type { DifferenceLine } from "@axonometric/contracts";
import {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@axonometric/ui/components/dialog";
import { Array as Arr } from "effect";

import { controlClass } from "./control-class.ts";

/** What a restore did, for the dialog that reports it. */
export interface RestoreReport {
  /** Differences in what the map says, which a restore can't turn into layout changes. */
  readonly meaning: ReadonlyArray<DifferenceLine>;
  /** Why the layout couldn't be restored, when it couldn't. */
  readonly refusal: string | undefined;
  /** The layout differences that became pending changes. */
  readonly restored: ReadonlyArray<DifferenceLine>;
  readonly revision: number;
  /** Route differences, which aren't pending changes yet. */
  readonly routes: ReadonlyArray<DifferenceLine>;
}

/**
 * Where focus goes when the dialog closes. The Restore button that opened it
 * is gone by then, so it goes to the revision's row in the History tab, or to
 * the History tab when the row isn't drawn.
 */
const afterClose = (revision: number) => (): HTMLElement | null =>
  document.querySelector<HTMLElement>(
    `[data-history-list] [data-revision="${revision}"]`
  ) ?? document.querySelector<HTMLElement>('[role="tab"][data-tab="history"]');

/** What the dialog says about the layout changes a restore made. */
const restoredText = (count: number) =>
  count === 1
    ? "1 layout difference is now a pending change. Review it in the Pending tab, or undo it."
    : `${count} layout differences are now pending changes. Review them in the Pending tab, or undo them.`;

function Lines({
  lines,
  name,
}: {
  readonly lines: ReadonlyArray<DifferenceLine>;
  readonly name: string;
}) {
  return (
    <ul className="flex list-disc flex-col gap-1 pl-5" data-restore-list={name}>
      {Arr.map(lines, (line) => (
        <li key={line.key}>{line.text}</li>
      ))}
    </ul>
  );
}

/**
 * Says what a restore did, and lists the differences it couldn't turn into
 * pending layout changes, so none is dropped without a word. A modal dialog
 * on ui-sdk's `Dialog`: it takes focus, traps Tab, Escape closes it, and
 * focus returns to where it came from. It is open while it is mounted, and
 * `onClose` is how it asks to be unmounted.
 */
export function RestoreDialog({
  onClose,
  report,
}: {
  readonly onClose: () => void;
  readonly report: RestoreReport;
}) {
  const { meaning, refusal, restored, revision, routes } = report;

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      open
    >
      <DialogBackdrop />
      <DialogContent
        className="border-ink bg-paper text-ink"
        data-restore-dialog
        finalFocus={afterClose(revision)}
      >
        <div className="flex flex-col gap-3">
          <DialogTitle className="tracking-widest uppercase">
            Restore revision {revision}
          </DialogTitle>
          {refusal === undefined ? (
            restored.length > 0 ? (
              <>
                <p data-restore-done>{restoredText(restored.length)}</p>
                <Lines lines={restored} name="layout" />
              </>
            ) : (
              <p data-restore-done>
                Revision {revision} has the same layout as the accepted map, so
                no layout changes were made.
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
                These differences change the map&apos;s meaning and can&apos;t
                be restored as layout changes:
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
            <DialogClose className={controlClass} data-control="close-restore">
              Close
            </DialogClose>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
