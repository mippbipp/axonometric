import { chapterMarkName, marked } from "@axonometric/contracts";
import type { ChapterChange } from "@axonometric/contracts";
import { useMemo } from "react";

import { useProposalOps } from "./proposal-ops-context.ts";
import { useWalkthrough } from "./walkthrough-context.ts";

const nothing: ReadonlySet<string> = new Set();

const noPlays: readonly string[] = [];

/**
 * The ids a chapter's proposals mark for `action`: the structures a reveal or
 * a hide marks, the hops a play or an unplay marks, or the chapter itself for
 * an order. A proposal looks pending in its own chapter and in no other, so a
 * reader asks for the marks of one chapter.
 */
// oxlint-disable-next-line effecttsgo/missing-pipeable-signature -- a React hook, called as `useChapterMarks(chapter, action)`, never piped.
export const useChapterMarks = (
  chapter: string,
  action: ChapterChange["action"]
): ReadonlySet<string> => {
  const shown = useProposalOps()?.proposed;

  return shown === undefined
    ? nothing
    : marked(shown, { name: chapterMarkName, scope: chapter, kind: action });
};

/**
 * The hops the chapter plays in the accepted map, in order, before any
 * proposal reorders or changes them. The proposed map's chapter has the
 * proposals applied, so the order a proposal changes is told by comparing the
 * two.
 */
export const useAcceptedPlays = (chapter: string): readonly string[] =>
  useProposalOps()?.acceptedChapters.find(({ id }) => id === chapter)?.plays ??
  noPlays;

/** The structures a proposal reveals or hides in the chapter the page shows. */
export const useChapterPendingStructures = (): ReadonlySet<string> => {
  const { stop } = useWalkthrough();
  const revealing = useChapterMarks(stop.id, "reveal");
  const hiding = useChapterMarks(stop.id, "hide");

  return useMemo(() => new Set([...revealing, ...hiding]), [revealing, hiding]);
};
