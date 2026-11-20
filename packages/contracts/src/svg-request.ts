import { chapterStopsOf } from "./chapters.ts";
import type { MapState } from "./map-state.ts";
import type { View } from "./plan.ts";
import { chapterSpotlightOf } from "./spotlight.ts";
import type { FlowChoice, Spotlight, SpotlightTarget } from "./spotlight.ts";

/** What an exported SVG is of, and how it looks. */
export interface SvgRequest {
  /** The colour behind the drawing: the palette's paper, or white. */
  readonly background: "paper" | "white";
  /** The chapter's index, from 0. */
  readonly chapter: number;
  /** What to draw at full strength, or `null` to fade nothing. */
  readonly spotlight: Spotlight | null;
  readonly state: MapState;
  /**
   * The palette to draw in. White always draws in the light palette, so
   * dark-theme ink doesn't vanish on it.
   */
  readonly theme: "light" | "dark";
  readonly view: View;
}

/**
 * The request an SVG file is drawn from. The page's Export menu and the
 * `export` command both build it here, so the two can't differ. The menu
 * fills `theme`, `hovered` and `pinned` from the page. `export` passes the
 * light theme and `null` for both targets, because nothing in a file is
 * hovered or pinned.
 */
export const svgRequestOf = ({
  background,
  chapter,
  choice,
  hovered,
  pinned,
  state,
  theme,
  view,
}: {
  readonly background: SvgRequest["background"];
  /** The chapter's index, from 0. */
  readonly chapter: number;
  /** What the last chapter's flow picker has chosen to play. */
  readonly choice: FlowChoice;
  readonly hovered: SpotlightTarget | null;
  readonly pinned: SpotlightTarget | null;
  readonly state: MapState;
  readonly theme: SvgRequest["theme"];
  readonly view: View;
}): SvgRequest => {
  const stops = chapterStopsOf(state);
  const index = Math.min(Math.max(chapter, 0), stops.length - 1);
  const stop = stops[index] ?? stops[0];

  return {
    background,
    chapter: index,
    spotlight: chapterSpotlightOf({
      choice,
      data: state.data,
      hovered,
      pinned,
      stop,
    }),
    state,
    theme,
    view,
  };
};
