import type { MapState } from "@axonometric/contracts";

import { IsoView } from "./iso-view.tsx";
import { ThemeToggle } from "./theme.tsx";

/**
 * The map page. It draws whatever map state it's given; the caller decides
 * where the state comes from.
 */
export function App({ state }: { readonly state: MapState }) {
  return (
    <main className="bg-paper text-ink flex h-svh flex-col font-mono">
      <header className="border-ink flex items-center justify-between border-b px-4 py-2">
        <h1 className="text-sm font-medium tracking-widest uppercase">
          {state.system}
        </h1>
        <ThemeToggle />
      </header>
      <div className="min-h-0 flex-1">
        <IsoView state={state} />
      </div>
    </main>
  );
}
