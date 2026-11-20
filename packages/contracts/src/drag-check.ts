import { Array as Arr } from "effect";

import {
  chapterViews,
  firstShown,
  layoutWideProblems,
  markedAdded,
  rememberedDrawings,
} from "./layout-checks.ts";
import type { ChapterView, DraggedProblem } from "./layout-checks.ts";
import type { Layout } from "./layout.ts";
import type { MapData } from "./map-data.ts";
import type { MapProblem } from "./problems.ts";

/**
 * What a drag step's check has found so far: every problem in the chapters
 * drawn yet, in `check`'s order, and whether every chapter is in. The last
 * answer of a step is complete, and lists what `check` would report for the
 * layout the drag leaves.
 *
 * `check` names a drawing warning by the first chapter it shows in, so until
 * every chapter before one is drawn, a warning may name that chapter where
 * `check` would name an earlier one.
 */
export interface DragAnswer {
  readonly complete: boolean;
  readonly problems: ReadonlyArray<DraggedProblem>;
}

/** One drag step to check: the layout it would leave, and the chapter on screen. */
export interface DragStep {
  readonly after: Layout;
  readonly onScreen: string;
}

/**
 * The check of drags on one map, which `dragCheckOf` makes from the map's
 * data and its layout before any drag.
 */
export interface DragCheck {
  /**
   * Answers a step a chapter at a time, the chapter on screen first and the
   * rest in chapter order. Each turn draws one chapter and gives what
   * has been found so far, so a caller that has moved on to a newer step stops
   * asking.
   */
  readonly step: (step: DragStep) => Iterable<DragAnswer>;
  /**
   * Draws the layout before the drag a chapter at a time. A step's answers
   * compare with that layout, and drawing it here spares the first step from
   * doing so. Each turn draws one chapter.
   */
  readonly warmUp: () => Iterable<void>;
}

/** The chapters as `check` draws them, the one on screen first. */
const inCheckOrder = (
  views: ReadonlyArray<ChapterView>,
  onScreen: string
): ReadonlyArray<ChapterView> => [
  ...Arr.filter(views, ({ id }) => id === onScreen),
  ...Arr.filter(views, ({ id }) => id !== onScreen),
];

/**
 * Takes the map once, then answers each drag step. It owns what the answers
 * share: the order the chapters are checked in, and a memory of every chapter
 * it has drawn, by what the chapter shows. A drag that moves one structure
 * leaves the chapters that don't reveal it alone, so they aren't drawn
 * again, and neither is the layout before the drag at each step.
 */
export const dragCheckOf = ({
  before,
  data,
}: {
  readonly before: Layout;
  readonly data: MapData;
}): DragCheck => {
  const views = chapterViews(data);
  const drawings = rememberedDrawings();
  const wideBefore = layoutWideProblems(data, before);

  const problemsOf = (
    layout: Layout,
    wide: ReadonlyArray<MapProblem>,
    done: ReadonlySet<ChapterView>
  ): ReadonlyArray<MapProblem> => [
    ...wide,
    ...firstShown(
      Arr.map(
        Arr.filter(views, (view) => done.has(view)),
        (view) => drawings({ data, layout }, view)
      )
    ),
  ];

  return {
    *step({ after, onScreen }) {
      const wideAfter = layoutWideProblems(data, after);
      const done = new Set<ChapterView>();

      for (const view of inCheckOrder(views, onScreen)) {
        done.add(view);

        yield {
          complete: done.size === views.length,
          problems: markedAdded(
            problemsOf(after, wideAfter, done),
            problemsOf(before, wideBefore, done)
          ),
        };
      }
    },
    *warmUp() {
      for (const view of views) {
        drawings({ data, layout: before }, view);
        yield;
      }
    },
  };
};
