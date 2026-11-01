import type { Hop, MapState, View } from "@axonometric/contracts";
import { cn } from "@axonometric/ui/lib/utils";
import { Array as Arr } from "effect";
import { useCallback, useState } from "react";
import type { ReactNode } from "react";

import { Breadcrumb } from "./breadcrumb.tsx";
import { useChapterKeys } from "./chapter-keys.ts";
import { ChapterRail } from "./chapter-rail.tsx";
import { FlowPicker } from "./flow-picker.tsx";
import { useInsideFocus } from "./inside-focus.ts";
import { InsideView } from "./inside-view.tsx";
import { screenRouteOf } from "./iso.ts";
import { MapSurface } from "./map-surface.tsx";
import { MapView } from "./map-view.tsx";
import { useOverviewPage } from "./overview-context.ts";
import {
  OverviewButton,
  OverviewPage,
  OverviewPageProvider,
} from "./overview-page.tsx";
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
import { useViewKey } from "./view-keys.ts";
import { ViewToggle } from "./view-toggle.tsx";
import { useWalkthrough } from "./walkthrough-context.ts";
import { WalkthroughProvider } from "./walkthrough.tsx";

/** The keys the hint bar lists, for what's on screen. */
const hintsOf = ({
  overviewOpen,
  selected,
  inside,
  canGoInside,
}: {
  /** Whether the How it's built page is open. */
  readonly overviewOpen: boolean;
  readonly selected: boolean;
  readonly inside: boolean;
  /** Whether the selected structure has steps. */
  readonly canGoInside: boolean;
}) => {
  if (overviewOpen) {
    return ["Esc closes this page"];
  }

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
        "v switches view",
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
        "v switches view",
      ];
};

/**
 * Things to show under the chapter rail, such as the live page's notices.
 * They're in the flow under the rail, so a rail that wraps pushes them down
 * instead of being covered.
 */
interface Notices {
  readonly notices?: ReactNode;
}

function WalkthroughPage({ notices }: Notices) {
  const { state, stop, revealed, newlyRevealed, fit } = useWalkthrough();
  const { selected, inside } = useSelection();
  const { open: overviewOpen } = useOverviewPage();
  const byId = useStructuresById();
  const insideStructure = inside === null ? undefined : byId.get(inside);
  const selectedStructure = selected === null ? undefined : byId.get(selected);
  // The view lives here, in memory, so switching it keeps every provider's
  // state: the chapter, the selection and the packets.
  const [view, setView] = useState<View>("iso");

  useChapterKeys(selected === null);
  useSelectionKeys();
  useInsideFocus(inside);
  useViewKey(() => {
    if (insideStructure === undefined && !overviewOpen) {
      setView((current) => (current === "iso" ? "plan" : "iso"));
    }
  });

  const routeOf = useCallback(
    (hop: Hop) =>
      screenRouteOf({
        data: state.data,
        layout: state.layout,
        revealed,
        hop,
        view,
      }),
    [state.data, state.layout, revealed, view]
  );

  return (
    <main
      data-walkthrough
      data-chapter={stop.id}
      data-view={view}
      className="bg-paper text-ink flex h-svh flex-col font-mono"
    >
      <header className="border-ink flex items-center gap-4 border-b px-4 py-2">
        <h1 className="text-sm font-medium tracking-widest uppercase">
          {state.data.overview.title}
        </h1>
        <div className="ml-auto flex gap-1.5">
          <ViewToggle view={view} choose={setView} />
          <OverviewButton />
          <ThemeToggle />
        </div>
      </header>
      <div className="relative flex min-h-0 flex-1">
        <SideIndex />
        <MapSurface>
          {/* The map stays mounted, hidden, while the inside view is open,
              so its pan and zoom survive the visit. It keeps its size, so
              the viewport doesn't refit on a resize. */}
          <div
            data-map-layer
            inert={insideStructure !== undefined}
            className={cn(
              "absolute inset-0",
              insideStructure !== undefined && "invisible"
            )}
          >
            <MapView
              view={view}
              state={state}
              revealed={revealed}
              newlyRevealed={newlyRevealed}
              fitTo={fit}
              fitKey={stop.id}
              labelFirst={stop.plays}
            >
              <PacketLayer routeOf={routeOf} />
            </MapView>
            <div className="pointer-events-none absolute inset-x-3 top-3 bottom-2/3 flex flex-col items-start gap-2">
              <ChapterRail className="pointer-events-auto shrink-0" />
              {/* The inside view shows the notices instead, while it's open. */}
              {insideStructure === undefined ? notices : null}
            </div>
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
              <div className="pointer-events-none absolute inset-x-3 top-3 bottom-2/3 flex flex-col items-start gap-2">
                <Breadcrumb
                  structure={insideStructure}
                  className="pointer-events-auto shrink-0"
                />
                {notices}
              </div>
            </div>
          )}
          <StructureTooltip />
        </MapSurface>
        <SidePanel />
        <OverviewPage />
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
              overviewOpen,
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
export function App({
  state,
  notices,
}: Notices & { readonly state: MapState }) {
  return (
    <WalkthroughProvider state={state}>
      <PlaybackProvider>
        <SelectionProvider>
          <TooltipProvider>
            <OverviewPageProvider>
              <WalkthroughPage notices={notices} />
            </OverviewPageProvider>
          </TooltipProvider>
        </SelectionProvider>
      </PlaybackProvider>
    </WalkthroughProvider>
  );
}
