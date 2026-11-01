import type { Hop, MapState } from "@axonometric/contracts";
import { cn } from "@axonometric/ui/lib/utils";
import { Array as Arr } from "effect";
import { useCallback } from "react";

import { Breadcrumb } from "./breadcrumb.tsx";
import { useChapterKeys } from "./chapter-keys.ts";
import { ChapterRail } from "./chapter-rail.tsx";
import { FlowPicker } from "./flow-picker.tsx";
import { useInsideFocus } from "./inside-focus.ts";
import { InsideView } from "./inside-view.tsx";
import { IsoView } from "./iso-view.tsx";
import { screenRouteOf } from "./iso.ts";
import { MapSurface } from "./map-surface.tsx";
import { PacketLayer } from "./packets.tsx";
import { PlaybackControls } from "./playback-controls.tsx";
import { PlaybackProvider } from "./playback-provider.tsx";
import { useSelection } from "./selection-context.ts";
import { useSelectionKeys } from "./selection-keys.ts";
import { SelectionProvider } from "./selection.tsx";
import { SideIndex } from "./side-index.tsx";
import { SidePanel } from "./side-panel.tsx";
import { hasSteps, useStructuresById } from "./structures.ts";
import { ThemeToggle } from "./theme.tsx";
import { StructureTooltip, TooltipProvider } from "./tooltip.tsx";
import { useWalkthrough } from "./walkthrough-context.ts";
import { WalkthroughProvider } from "./walkthrough.tsx";

/** The keys the hint bar lists, for what's on screen. */
const hintsOf = ({
  selected,
  inside,
  canGoInside,
}: {
  readonly selected: boolean;
  readonly inside: boolean;
  /** Whether the selected structure has steps. */
  readonly canGoInside: boolean;
}) => {
  if (inside) {
    return ["← or Esc come out", "click Step to move the packet"];
  }

  return selected
    ? [
        ...(canGoInside ? ["→ go inside"] : []),
        "← or Esc unpin",
        "] next chapter",
        "[ back",
        "+ and − zoom, 0 fits",
        "click empty space to unpin",
      ]
    : [
        "→ or ] next chapter",
        "← or [ back",
        "hover to read",
        "click to pin",
        "double-click to go inside",
        "click a packet to read its payload",
        "+ and − zoom, 0 fits",
      ];
};

function WalkthroughPage() {
  const { state, stop, revealed, newlyRevealed, fit } = useWalkthrough();
  const { selected, inside } = useSelection();
  const byId = useStructuresById();
  const insideStructure = inside === null ? undefined : byId.get(inside);
  const selectedStructure = selected === null ? undefined : byId.get(selected);

  useChapterKeys(selected === null);
  useSelectionKeys();
  useInsideFocus(inside);

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
          <ThemeToggle />
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <SideIndex />
        <MapSurface>
          {/* The iso view stays mounted, hidden, while the inside view is
              open, so its pan and zoom survive the visit. It keeps its size,
              so the viewport doesn't refit on a resize. */}
          <div
            data-iso-layer
            inert={insideStructure !== undefined}
            className={cn(
              "absolute inset-0",
              insideStructure !== undefined && "invisible"
            )}
          >
            <IsoView
              state={state}
              revealed={revealed}
              newlyRevealed={newlyRevealed}
              fitTo={fit}
              fitKey={stop.id}
            >
              <PacketLayer routeOf={isoRouteOf} />
            </IsoView>
            <ChapterRail className="absolute top-3 left-3" />
            {/* Stops short of the zoom controls at the bottom right, and wraps
                upward when the flows don't fit on one line. */}
            <div
              data-playback-bar
              className="absolute bottom-3 left-3 flex max-w-[calc(100%-13rem)] flex-wrap items-center gap-x-3 gap-y-1.5"
            >
              <PlaybackControls />
              <FlowPicker className="border-ink border-l pl-3" />
            </div>
          </div>
          {insideStructure === undefined ? null : (
            <div className="bg-paper absolute inset-0">
              <InsideView
                key={insideStructure.id}
                structure={insideStructure}
              />
              <Breadcrumb
                structure={insideStructure}
                className="absolute top-3 left-3"
              />
            </div>
          )}
          <StructureTooltip />
        </MapSurface>
        <SidePanel />
      </div>
      {/* One line, fixed height, so changing hints never resizes the canvas:
          a resize refits the view and loses the engineer's zoom. Hints that
          don't fit wrap onto a second line, which the list clips, so a hint
          shows whole or not at all. */}
      <footer
        data-hints
        className="border-ink flex h-6 shrink-0 border-t px-4 py-1 text-xs opacity-70"
      >
        <ul className="flex h-4 min-w-0 flex-wrap gap-x-4 gap-y-2 overflow-hidden">
          {Arr.map(
            hintsOf({
              selected: selected !== null,
              inside: insideStructure !== undefined,
              canGoInside: hasSteps(selectedStructure),
            }),
            (hint) => (
              <li key={hint} data-hint className="shrink-0 whitespace-nowrap">
                {hint}
              </li>
            )
          )}
        </ul>
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
        <SelectionProvider>
          <TooltipProvider>
            <WalkthroughPage />
          </TooltipProvider>
        </SelectionProvider>
      </PlaybackProvider>
    </WalkthroughProvider>
  );
}
