import { useSyncExternalStore } from "react";

import { App } from "./app.tsx";
import type { LiveStore } from "./live-store.ts";

/**
 * Notices over the map. They're fixed to the window, so they never change
 * the canvas's size: a resize refits the view and loses the zoom.
 */
function LiveNotices({
  error,
  stopped,
}: {
  readonly error: string | null;
  readonly stopped: boolean;
}) {
  return (
    <div className="pointer-events-none fixed inset-x-0 top-12 z-50 flex flex-col items-center gap-2 px-4 font-mono">
      {stopped ? (
        <output
          data-server-stopped
          className="border-ink bg-paper text-ink pointer-events-auto border px-3 py-1.5 text-xs"
        >
          Server stopped. This is the last map it sent. The page reconnects when
          axonometric serve runs again.
        </output>
      ) : null}
      {error === null ? null : (
        <section
          data-map-error
          role="alert"
          className="border-ink bg-paper text-ink pointer-events-auto flex max-h-[40svh] w-full max-w-3xl flex-col gap-1.5 overflow-auto border-2 px-3 py-2 text-xs"
        >
          <h2 className="font-medium tracking-widest uppercase">
            The map files have an error. The last good map is still showing.
          </h2>
          <pre className="whitespace-pre-wrap">{error}</pre>
        </section>
      )}
    </div>
  );
}

/** The map page as `axonometric serve` serves it, kept up to date. */
export function LiveApp({ store }: { readonly store: LiveStore }) {
  const live = useSyncExternalStore(store.subscribe, store.getSnapshot);

  return (
    <>
      <App state={live.state} />
      <LiveNotices error={live.error} stopped={live.stopped} />
    </>
  );
}
