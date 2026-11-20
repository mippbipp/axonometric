/* oxlint-disable perfectionist/sort-objects -- schema and table field order sets encoded JSON key order, message order and listing order, so it stays as written */
import {
  dragCheckOf,
  Layout,
  MapData,
  MapProblem,
} from "@axonometric/contracts";
import type { DragCheck } from "@axonometric/contracts";
import { Effect, Fiber, Schema } from "effect";

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

/**
 * Passes a drag step to the map's check and hands `answer` what it finds
 * after each chapter. It yields between chapters, so a newer step can
 * interrupt it.
 */
const checkDrag = Effect.fnUntraced(function* ({
  answer,
  check,
  step: { after, onScreen, step },
}: {
  readonly answer: (found: CheckAnswer) => void;
  readonly check: DragCheck;
  readonly step: CheckStep;
}) {
  for (const { complete, problems } of check.step({ after, onScreen })) {
    answer({ complete, problems, step });

    if (!complete) {
      yield* Effect.yieldNow;
    }
  }
});

const warmUp = Effect.fnUntraced(function* (check: DragCheck) {
  for (const _ of check.warmUp()) {
    yield* Effect.yieldNow;
  }
});

/** What a checker holds between messages: the map's check, and the step it checks. */
interface Held {
  check: { readonly check: DragCheck; readonly map: number } | undefined;
  checking: Fiber.Fiber<void> | undefined;
}

/**
 * Checks drag steps a chapter at a time, one at once: a new map or step stops
 * the step being checked. `answer` hears what each step's chapters find. The
 * worker runs one, and so does the page where there are no workers.
 */
export const dragChecker = (answer: (found: CheckAnswer) => void) => {
  const held: Held = { check: undefined, checking: undefined };

  const stop = () => {
    if (held.checking !== undefined) {
      Effect.runFork(Fiber.interrupt(held.checking));
      held.checking = undefined;
    }
  };

  return {
    map: (map: CheckMap) => {
      stop();
      held.check = { check: dragCheckOf(map), map: map.id };
      // Draw the layout before the drag now, while nothing is dragged, so a
      // drag's first answer waits on its own layout alone.
      held.checking = Effect.runFork(warmUp(held.check.check));
    },
    step: (step: CheckStep) => {
      stop();

      if (held.check?.map === step.map) {
        held.checking = Effect.runFork(
          checkDrag({ answer, check: held.check.check, step })
        );
      }
    },
    close: stop,
  };
};
