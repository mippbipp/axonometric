import { Array as Arr } from "effect";
import { useSyncExternalStore } from "react";

import { App } from "./app.tsx";
import type { LiveStore, Rejection } from "./live-store.ts";

/**
 * The live page's notices. The page shows them under the chapter rail, over
 * the canvas, so they never change its size: a resize refits the view and
 * loses the zoom. A long list of problems scrolls inside the banner.
 */
function LiveNotices({
  rejection,
  stopped,
}: {
  readonly rejection: Rejection | null;
  readonly stopped: boolean;
}) {
  return (
    <>
      {stopped ? (
        <output
          data-server-stopped
          className="border-ink bg-paper text-ink pointer-events-auto max-w-full shrink-0 border px-3 py-1.5 text-xs"
        >
          Server stopped. This is the last map it sent. The page reconnects when
          axonometric serve runs again.
        </output>
      ) : null}
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

/** The map page as `axonometric serve` serves it, kept up to date. */
export function LiveApp({ store }: { readonly store: LiveStore }) {
  const live = useSyncExternalStore(store.subscribe, store.getSnapshot);

  return (
    <App
      state={live.state}
      notices={
        <LiveNotices rejection={live.rejection} stopped={live.stopped} />
      }
    />
  );
}
