import { Array as Arr } from "effect";

import type { MapState } from "./map-state.ts";

/**
 * One chapter as the walkthrough shows it, with the structures revealed so
 * far worked out.
 */
export interface ChapterStop {
  readonly id: string;
  readonly title: string;
  readonly lede: string;
  readonly story: string;
  /** Every structure revealed by this chapter or an earlier one. */
  readonly revealed: ReadonlySet<string>;
  /** The structures this chapter reveals for the first time, in map order. */
  readonly newlyRevealed: readonly string[];
  /** The ids of the hops the chapter plays, in order. */
  readonly plays: readonly string[];
}

/** The id of the one chapter a map with no chapters gets. */
export const wholeMapChapterId = "whole-map";

/**
 * The walkthrough's chapters, with reveals made cumulative. A map with no
 * chapters gets one chapter that shows every structure and plays nothing, so
 * the last-chapter flow picker still offers its flows.
 */
export const chapterStopsOf = (
  state: MapState
): Arr.NonEmptyReadonlyArray<ChapterStop> => {
  const { structures, chapters } = state.data;

  if (!Arr.isReadonlyArrayNonEmpty(chapters)) {
    return [
      {
        id: wholeMapChapterId,
        title: "The whole map",
        lede: "Every structure at once.",
        story: "This map has no chapters yet, so it shows everything.",
        revealed: new Set(Arr.map(structures, ({ id }) => id)),
        newlyRevealed: [],
        plays: [],
      },
    ];
  }

  const revealed = new Set<string>();

  return Arr.map(chapters, (chapter) => {
    const before = new Set(revealed);

    for (const id of chapter.reveals) {
      revealed.add(id);
    }

    const newlyRevealed = Arr.flatMap(structures, ({ id }) =>
      revealed.has(id) && !before.has(id) ? [id] : []
    );

    return {
      id: chapter.id,
      title: chapter.title,
      lede: chapter.lede,
      story: chapter.story,
      revealed: new Set(revealed),
      newlyRevealed,
      plays: chapter.plays,
    };
  });
};
