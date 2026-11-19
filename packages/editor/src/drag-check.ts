import {
  chapterViews,
  draggedProblemsIn,
  Layout,
  MapData,
  MapProblem,
} from "@axonometric/contracts";
import { Array as Arr, Effect, Fiber, Schema } from "effect";

/**
 * The map a drag is checked against: its data and the layout before the
 * drag. The page sends it once per map, not with every step, so the worker
 * keeps the same objects and remembers the chapters it has drawn.
 */
export const CheckMap = Schema.Struct({
  kind: Schema.Literal("map"),
  id: Schema.Int,
  data: MapData,
  before: Layout,
});

/**
 * One drag step to check: the layout it would leave, and the chapter on
 * screen. `step` names it, so the page can drop answers to a step it has
 * moved past, and `map` names the map it is a step on.
 */
export const CheckStep = Schema.Struct({
  kind: Schema.Literal("step"),
  step: Schema.Int,
  map: Schema.Int,
  after: Layout,
  onScreen: Schema.String,
});

export const CheckRequest = Schema.Union([CheckMap, CheckStep]);

export type CheckMap = typeof CheckMap.Type;

export type CheckStep = typeof CheckStep.Type;

export type CheckRequest = typeof CheckRequest.Type;

/** A problem the drag's layout has, and whether the layout before didn't. */
export const CheckedProblem = Schema.Struct({
  problem: MapProblem,
  added: Schema.Boolean,
});

/**
 * What the check has found for a step so far: every problem in the chapters
 * checked yet, in `check`'s order, and whether every chapter is in.
 */
export const CheckAnswer = Schema.Struct({
  step: Schema.Int,
  problems: Schema.Array(CheckedProblem),
  complete: Schema.Boolean,
});

export type CheckAnswer = typeof CheckAnswer.Type;

/** The chapters as `check` draws them, the one on screen first. */
const checkOrder = (
  data: MapData,
  onScreen: string
): readonly (string | undefined)[] => {
  const ids = Arr.map(chapterViews(data), ({ id }) => id);

  return [
    ...Arr.filter(ids, (id) => id === onScreen),
    ...Arr.filter(ids, (id) => id !== onScreen),
  ];
};

/**
 * Checks a drag step a chapter at a time, the chapter on screen first, and
 * hands `answer` what it has found after each. It yields between chapters,
 * so a newer step can interrupt it. The last answer is every problem `check`
 * would report for the layout, as `draggedProblems` lists them.
 */
export const checkDrag = Effect.fnUntraced(function* ({
  map: { data, before },
  step: { step, after, onScreen },
  answer,
}: {
  readonly map: CheckMap;
  readonly step: CheckStep;
  readonly answer: (found: CheckAnswer) => void;
}) {
  const order = checkOrder(data, onScreen);
  const done = new Set<string | undefined>();

  for (const [index, chapter] of order.entries()) {
    done.add(chapter);

    const complete = index === order.length - 1;

    answer({
      step,
      problems: draggedProblemsIn({ data, before, after, chapters: done }),
      complete,
    });

    if (!complete) {
      yield* Effect.yieldNow;
    }
  }
});

/**
 * Checks the layout before any drag a chapter at a time, yielding between
 * chapters. A drag's answers compare with it, and remembering its chapters
 * here spares the first drag step from drawing them.
 */
const warmUp = Effect.fnUntraced(function* ({ data, before }: CheckMap) {
  const seen = new Set<string | undefined>();

  for (const { id } of chapterViews(data)) {
    seen.add(id);
    draggedProblemsIn({ data, before, after: before, chapters: seen });
    yield* Effect.yieldNow;
  }
});

/** What a checker holds between messages: the map, and the step it checks. */
interface Held {
  map: CheckMap | undefined;
  checking: Fiber.Fiber<void> | undefined;
}

/**
 * Checks drag steps a chapter at a time, one at once: a new map or step stops
 * the step being checked. `answer` hears what each step's chapters find. The
 * worker runs one, and so does the page where there are no workers.
 */
export const dragChecker = (answer: (found: CheckAnswer) => void) => {
  const held: Held = { map: undefined, checking: undefined };

  const stop = () => {
    if (held.checking !== undefined) {
      Effect.runFork(Fiber.interrupt(held.checking));
      held.checking = undefined;
    }
  };

  return {
    map: (map: CheckMap) => {
      stop();
      held.map = map;
      // Draw the layout before the drag now, while nothing is dragged, so a
      // drag's first answer waits on its own layout alone.
      held.checking = Effect.runFork(warmUp(map));
    },
    step: (step: CheckStep) => {
      stop();

      if (held.map?.id === step.map) {
        held.checking = Effect.runFork(
          checkDrag({ map: held.map, step, answer })
        );
      }
    },
    close: stop,
  };
};
