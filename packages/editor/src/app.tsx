import type { Hop, MapState, View } from "@axonometric/contracts";
import { cn } from "@axonometric/ui/lib/utils";
import { Array as Arr } from "effect";
import { useCallback, useState } from "react";
import type { ReactNode } from "react";

import { Breadcrumb } from "./breadcrumb.tsx";
import { useChapterKeys } from "./chapter-keys.ts";
import { ChapterRail } from "./chapter-rail.tsx";
import { DragPreviewProvider } from "./drag-preview.tsx";
import { useEditSwitch } from "./edit-context.ts";
import { useArrowOwner, useEditKeys } from "./edit-keys.ts";
import { useEditToggleKey } from "./edit-toggle-key.ts";
import { EditToggle } from "./edit-toggle.tsx";
import { EditToolbar } from "./edit-toolbar.tsx";
import { useEditing } from "./editing-context.ts";
import { ExportMenu } from "./export-menu.tsx";
import { FlowPicker } from "./flow-picker.tsx";
import { HopDraftProvider } from "./hop-draft-provider.tsx";
import { HopMenu } from "./hop-menu.tsx";
import { useInsideFocus } from "./inside-focus.ts";
import { InsideView } from "./inside-view.tsx";
import { MapSurface } from "./map-surface.tsx";
import { MapView } from "./map-view.tsx";
import { NewGroupProvider } from "./new-group-provider.tsx";
import { NoteToolProvider } from "./note-tool.tsx";
import { useOverviewPage } from "./overview-context.ts";
import {
  OverviewButton,
  OverviewPage,
  OverviewPageProvider,
} from "./overview-page.tsx";
import { PacketLayer } from "./packets.tsx";
import { PlacingProvider } from "./placing-provider.tsx";
import { PlaybackControls } from "./playback-controls.tsx";
import { PlaybackProvider } from "./playback-provider.tsx";
import { screenRouteOf } from "./projection.ts";
import { ReadyForReview } from "./ready-for-review.tsx";
import { useSelection } from "./selection-context.ts";
import { useSelectionKeys } from "./selection-keys.ts";
import { SelectionProvider } from "./selection.tsx";
import { SideIndex } from "./side-index.tsx";
import { SidePanel } from "./side-panel.tsx";
import { SideTabProvider } from "./side-tab.tsx";
import { SpotlightProvider } from "./spotlight.tsx";
import { StructureMenu } from "./structure-menu.tsx";
import { hasSteps, useStructuresById } from "./structures.ts";
import { ThemeToggle } from "./theme.tsx";
import { StructureTooltip, TooltipProvider } from "./tooltip.tsx";
import { useViewKey } from "./view-keys.ts";
import { ViewToggle } from "./view-toggle.tsx";
import { useWalkthrough } from "./walkthrough-context.ts";
import { WalkthroughProvider } from "./walkthrough.tsx";

/** The keys the hint bar lists, for what's on screen. */
const hintsOf = ({
  canGoInside,
  editable,
  editing,
  inside,
  multiSelected,
  overviewOpen,
  selected,
}: {
  /** Whether the selected structure has steps. */
  readonly canGoInside: boolean;
  /** Whether the page has an Edit button, which `e` presses. */
  readonly editable: boolean;
  /** Whether Edit is on, so the page can edit the layout. */
  readonly editing: boolean;
  readonly inside: boolean;
  /** How many structures are in the multi-selection. */
  readonly multiSelected: number;
  /** Whether the How it's built page is open. */
  readonly overviewOpen: boolean;
  readonly selected: boolean;
}) => {
  const editHint = editable ? [editing ? "e stops editing" : "e edits"] : [];

  if (overviewOpen) {
    return ["Esc closes this page"];
  }

  if (inside) {
    return ["← or Esc come out", "click Step to move the packet"];
  }

  if (multiSelected > 0) {
    return [
      "arrows nudge half a unit",
      "drag to move them together",
      "Esc clears the selection",
      "Ctrl+Z undo",
      "Shift-click adds or removes",
    ];
  }

  return selected
    ? [
        ...(canGoInside ? ["→ go inside"] : []),
        "← or Esc unpin",
        "] next chapter",
        "[ back",
        ...editHint,
        "+ and − zoom, 0 zooms to fit",
        "v switches view",
        "click empty space to unpin",
      ]
    : [
        "→ or ] next chapter",
        "← or [ back",
        ...editHint,
        "hover to read",
        "click to pin",
        "double-click to go inside",
        "click a packet to read its payload",
        "+ and − zoom, 0 zooms to fit",
        "v switches view",
        ...(editing ? ["Shift-click or Shift-drag selects several"] : []),
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
  const { fit, newlyRevealed, revealed, state, stop } = useWalkthrough();
  const { inside, multiSelection, selected } = useSelection();
  const editing = useEditing();
  const editable = useEditSwitch() !== null;
  const { open: overviewOpen } = useOverviewPage();
  const byId = useStructuresById();
  const insideStructure = inside === null ? undefined : byId.get(inside);
  const selectedStructure = selected === null ? undefined : byId.get(selected);
  // The view lives here, in memory, so switching it keeps every provider's
  // state: the chapter, the selection and the packets.
  const [view, setView] = useState<View>("iso");

  const arrowOwner = useArrowOwner();

  useChapterKeys(arrowOwner === "chapter");
  useSelectionKeys(arrowOwner === "selection");
  useEditKeys(arrowOwner);
  useInsideFocus(inside);

  // Switching views while a page covers the map would change what's under
  // it unseen, so the toggle and `v` both wait until it's closed.
  const blockedBy = [
    ...(insideStructure === undefined
      ? []
      : ["Come out of the inside view to switch views"]),
    ...(overviewOpen ? ["Close How it's built to switch views"] : []),
  ];

  const [switchBlocked] = blockedBy;

  useEditToggleKey();

  useViewKey(() => {
    if (switchBlocked === undefined) {
      setView((current) => (current === "iso" ? "plan" : "iso"));
    }
  });

  const routeOf = useCallback(
    (hop: Hop) =>
      screenRouteOf({
        data: state.data,
        hop,
        layout: state.layout,
        revealed,
        view,
      }),
    [state.data, state.layout, revealed, view]
  );

  return (
    <main
      className="bg-paper text-ink flex h-svh flex-col font-mono"
      data-chapter={stop.id}
      data-view={view}
      data-walkthrough
    >
      <header className="border-ink flex items-center gap-4 border-b px-4 py-2">
        <h1 className="text-sm font-medium tracking-widest uppercase">
          {state.data.overview.title}
        </h1>
        <div className="ml-auto flex items-stretch gap-1.5">
          <ReadyForReview />
          <ViewToggle
            choose={setView}
            disabledBecause={switchBlocked}
            view={view}
          />
          <EditToggle />
          <OverviewButton />
          <ExportMenu view={view} />
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
            className={cn(
              "absolute inset-0",
              insideStructure !== undefined && "invisible"
            )}
            data-map-layer
            inert={insideStructure !== undefined}
          >
            <MapView
              fitKey={stop.id}
              fitTo={fit}
              labelFirst={stop.plays}
              newlyRevealed={newlyRevealed}
              revealed={revealed}
              state={state}
              view={view}
            >
              <PacketLayer routeOf={routeOf} />
            </MapView>
            <div className="pointer-events-none absolute inset-x-3 top-3 bottom-2/3 flex flex-col items-start gap-2">
              {/* The toolbar shares the rail's row and wraps below it when
                  both don't fit, so it never covers the chapter title. */}
              <div className="flex w-full flex-wrap items-start gap-x-3 gap-y-2">
                <ChapterRail className="pointer-events-auto min-w-0 flex-1 basis-80" />
                <EditToolbar
                  className="pointer-events-auto ml-auto shrink-0"
                  view={view}
                />
              </div>
              {/* The inside view shows the notices instead, while it's open. */}
              {insideStructure === undefined ? notices : null}
            </div>
            {/* Stops short of the zoom controls at the bottom right, and wraps
                upward when the flows don't fit on one line. */}
            <div
              className="absolute bottom-3 left-3 flex max-w-[calc(100%-13rem)] flex-wrap items-center gap-x-3 gap-y-1.5"
              data-playback-bar
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
                  className="pointer-events-auto shrink-0"
                  structure={insideStructure}
                />
                {notices}
              </div>
            </div>
          )}
          <StructureTooltip />
        </MapSurface>
        {/* Beside the surface, not in it: ui-sdk renders a menu where it is
            placed, and a click on an item would reach the surface's
            click-to-deselect listener. */}
        <StructureMenu />
        <HopMenu />
        <SidePanel />
        <OverviewPage />
      </div>
      {/* One line, fixed height, so changing hints never resizes the canvas:
          a resize refits the view and loses the engineer's zoom. Hints that
          don't fit wrap onto a second line, which the list clips, so a hint
          shows whole or not at all. */}
      <footer
        className="border-ink flex h-6 shrink-0 border-t px-4 py-1 text-xs opacity-70"
        data-hints
      >
        <ul className="flex h-4 min-w-0 flex-wrap gap-x-4 gap-y-2 overflow-hidden">
          {Arr.map(
            hintsOf({
              canGoInside: hasSteps(selectedStructure),
              editable,
              editing: editing?.canEdit === true,
              inside: insideStructure !== undefined,
              multiSelected: arrowOwner === "nudge" ? multiSelection.size : 0,
              overviewOpen,
              selected: selected !== null,
            }),
            (hint) => (
              <li className="shrink-0 whitespace-nowrap" data-hint key={hint}>
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
  notices,
  state,
}: Notices & { readonly state: MapState }) {
  return (
    <WalkthroughProvider state={state}>
      <PlaybackProvider>
        <SelectionProvider>
          <TooltipProvider>
            <DragPreviewProvider state={state}>
              <HopDraftProvider>
                <SpotlightProvider>
                  <OverviewPageProvider>
                    <NoteToolProvider>
                      <SideTabProvider>
                        <PlacingProvider>
                          <NewGroupProvider>
                            <WalkthroughPage notices={notices} />
                          </NewGroupProvider>
                        </PlacingProvider>
                      </SideTabProvider>
                    </NoteToolProvider>
                  </OverviewPageProvider>
                </SpotlightProvider>
              </HopDraftProvider>
            </DragPreviewProvider>
          </TooltipProvider>
        </SelectionProvider>
      </PlaybackProvider>
    </WalkthroughProvider>
  );
}
