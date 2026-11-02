import { chapterMark, marked } from "@axonometric/contracts";
import type { ChapterChange, ProposedMap } from "@axonometric/contracts";
import { createContext, use, useMemo } from "react";

import { useWalkthrough } from "./walkthrough-context.ts";

const nothing: ReadonlySet<string> = new Set();

/**
 * The proposed map's marks, for the chapter proposals the page draws in the
 * pending look. A chapter proposal looks pending in its own chapter and in no
 * other, so a reader asks for the marks of one chapter.
 */
export const ChapterMarksContext = createContext<Pick<
  ProposedMap,
  "marks"
> | null>(null);

/**
 * The ids a chapter's proposals mark for `action`: the structures a reveal or
 * a hide marks, the hops a play or an unplay marks, or the chapter itself for
 * an order.
 */
// oxlint-disable-next-line effecttsgo/missing-pipeable-signature -- a React hook, called as `useChapterMarks(chapter, action)`, never piped.
export const useChapterMarks = (
  chapter: string,
  action: ChapterChange["action"]
): ReadonlySet<string> => {
  const shown = use(ChapterMarksContext);

  return shown === null ? nothing : marked(shown, chapterMark(action, chapter));
};

/** The structures a proposal reveals or hides in the chapter the page shows. */
export const useChapterPendingStructures = (): ReadonlySet<string> => {
  const { stop } = useWalkthrough();
  const revealing = useChapterMarks(stop.id, "reveal");
  const hiding = useChapterMarks(stop.id, "hide");

  return useMemo(() => new Set([...revealing, ...hiding]), [revealing, hiding]);
};
