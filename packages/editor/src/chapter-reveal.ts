import type { ChapterChange } from "@axonometric/contracts";

import { useChapterMarks } from "./chapter-marks-context.ts";
import { useWalkthrough } from "./walkthrough-context.ts";

/** What the reveal toggle does for one structure in the current chapter. */
export interface RevealToggle {
  /** The words on the control: "Show in this chapter" or "Hide from this chapter". */
  readonly label: string;
  /** The proposal the control sends. */
  readonly change: ChapterChange;
  /** Whether the structure is already proposed to change in this chapter. */
  readonly pending: boolean;
  /** Why the control is off, or nothing. */
  readonly unavailable: string | undefined;
}

/**
 * The toggle on a structure's panel and context menu. In a chapter that has
 * not revealed the structure it offers "Show in this chapter"; in one that has
 * it offers "Hide from this chapter". A chapter shows what it and the earlier
 * chapters reveal, so a structure an earlier chapter revealed can only be
 * hidden by changing that chapter, which the toggle says.
 */
export const useRevealToggle = (
  structure: string
): RevealToggle | undefined => {
  const { state, stop, revealed } = useWalkthrough();
  const revealing = useChapterMarks(stop.id, "reveal");
  const hiding = useChapterMarks(stop.id, "hide");

  const own = state.data.chapters.find(({ id }) => id === stop.id);

  if (own === undefined) {
    return undefined;
  }

  const showing = revealed.has(structure) || revealing.has(structure);
  const revealsHere = own.reveals.includes(structure);

  if (!showing) {
    return {
      label: "Show in this chapter",
      change: { action: "reveal", chapter: stop.id, structure },
      pending: false,
      unavailable: undefined,
    };
  }

  return {
    label: "Hide from this chapter",
    change: { action: "hide", chapter: stop.id, structure },
    pending: hiding.has(structure),
    unavailable: revealsHere
      ? undefined
      : "An earlier chapter reveals it. Hide it there instead.",
  };
};
