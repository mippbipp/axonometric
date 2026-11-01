import type { Hop, MapState } from "@axonometric/contracts";
import { useCallback } from "react";

import { useChapterKeys } from "./chapter-keys.ts";
import { ChapterRail } from "./chapter-rail.tsx";
import { FlowPicker } from "./flow-picker.tsx";
import { IsoView } from "./iso-view.tsx";
import { screenRouteOf } from "./iso.ts";
import { PacketLayer } from "./packets.tsx";
import { PlaybackControls } from "./playback-controls.tsx";
import { PlaybackProvider } from "./playback-provider.tsx";
import { SidePanel } from "./side-panel.tsx";
import { useWalkthrough } from "./walkthrough-context.ts";
import { WalkthroughProvider } from "./walkthrough.tsx";

function WalkthroughPage() {
  const { state, stop, revealed, newlyRevealed, fit } = useWalkthrough();

  useChapterKeys(true);

  const isoRouteOf = useCallback(
    (hop: Hop) => screenRouteOf({ layout: state.layout, hop }),
    [state.layout]
  );

  return (
    <main
      data-walkthrough
      data-chapter={stop.id}
      className="bg-paper text-ink flex h-svh flex-col font-mono"
    >
      <header className="border-ink flex items-center gap-4 border-b px-4 py-2">
        <h1 className="text-sm font-medium tracking-widest uppercase">
          {state.system}
        </h1>
        <div className="ml-auto">
          <PlaybackControls />
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          <IsoView
            state={state}
            revealed={revealed}
            newlyRevealed={newlyRevealed}
            fit={fit}
          >
            <PacketLayer routeOf={isoRouteOf} />
          </IsoView>
          <ChapterRail className="absolute top-3 left-3" />
          <FlowPicker className="absolute bottom-3 left-3" />
        </div>
        <SidePanel />
      </div>
      <footer className="border-ink flex flex-wrap gap-x-4 border-t px-4 py-1 text-xs opacity-70">
        <span>→ or ] next chapter</span>
        <span>← or [ back</span>
        <span>click a packet to read its payload</span>
      </footer>
    </main>
  );
}

/**
 * The map page. It draws whatever map state it's given; the caller decides
 * where the state comes from.
 */
export function App({ state }: { readonly state: MapState }) {
  return (
    <WalkthroughProvider state={state}>
      <PlaybackProvider>
        <WalkthroughPage />
      </PlaybackProvider>
    </WalkthroughProvider>
  );
}
