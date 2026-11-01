import { applyLayoutChanges } from "@axonometric/contracts";
import { cn } from "@axonometric/ui/lib/utils";
import { Array as Arr } from "effect";
import { useMemo, useSyncExternalStore } from "react";

import { App } from "./app.tsx";
import { EditingContext } from "./editing-context.ts";
import type { Editing } from "./editing-context.ts";
import type { EditNotice, Rejection, ServedStore } from "./served-store.ts";

/**
 * The served page's notices. The page shows them under the chapter rail, over
 * the canvas, so they never change its size: a resize refits the view and
 * loses the zoom. A long list of problems scrolls inside the banner.
 */
function ServedNotices({
  rejection,
  stopped,
  notice,
}: {
  readonly rejection: Rejection | null;
  readonly stopped: boolean;
  readonly notice: EditNotice | null;
}) {
  return (
    <>
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
 */
export function ServedApp({ store }: { readonly store: ServedStore }) {
  const view = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const accepted = view.state.layout;
  const { pending } = view;

  const shown = useMemo(
    () => ({ ...view.state, layout: applyLayoutChanges(accepted, pending) }),
    [view.state, accepted, pending]
  );

  const editing = useMemo(
    (): Editing => ({
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
    }),
    [accepted, pending, view.stopped, view.canUndo, view.canRedo, store]
  );

  return (
    <EditingContext value={editing}>
      <App
        state={shown}
        notices={
          <ServedNotices
            rejection={view.rejection}
            stopped={view.stopped}
            notice={view.notice}
          />
        }
      />
    </EditingContext>
  );
}
