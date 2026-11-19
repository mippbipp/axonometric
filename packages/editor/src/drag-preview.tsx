import { applyLayoutChanges, shiftedRoutes } from "@axonometric/contracts";
import type {
  DraggedProblem,
  LayoutChange,
  MapState,
} from "@axonometric/contracts";
import { Array as Arr, Duration, Effect, Fiber, Result, Schema } from "effect";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import { CheckAnswer, dragChecker } from "./drag-check.ts";
import type { CheckMap, CheckStep } from "./drag-check.ts";
import DragCheckWorker from "./drag-check.worker.ts?worker&inline";
import {
  ChangePreviewContext,
  nothingReported,
  PreviewContext,
  ReportContext,
  useDragReport,
} from "./drag-preview-context.ts";
import type {
  ChangePreview,
  ChangePreviewInput,
  DragPreview,
  DragPreviewInput,
  DragReport,
} from "./drag-preview-context.ts";
import { useEditing } from "./editing-context.ts";
import { DropOutlinesContext } from "./outlines-context.ts";
import type { DropOutlines } from "./outlines-context.ts";
import { useWalkthrough } from "./walkthrough-context.ts";

/** How long a drag rests before its warnings are worked out. */
const settle = Duration.millis(120);

const none: readonly LayoutChange[] = [];

/** The layout a drag's changes would leave, with route overrides carried along. */
const draggedLayout = (
  { data, layout }: MapState,
  changes: readonly LayoutChange[]
) => {
  // A move carries a route override along when both its ends move
  // together, as saving the move does.
  const carried = Arr.flatMap(changes, (change) =>
    change.kind === "move"
      ? shiftedRoutes({
          layout,
          hops: data.hops,
          moves: change.moves,
          id: (hop) => `preview-${hop}`,
        })
      : []
  );

  return applyLayoutChanges(layout, [...changes, ...carried]);
};

/**
 * What the drag's check has found so far for one step: the problems, and
 * whether every chapter is in yet.
 */
interface Checked {
  readonly step: number;
  readonly problems: readonly DraggedProblem[];
  readonly complete: boolean;
}

const unchecked: Checked = { step: -1, problems: [], complete: true };

const decodeAnswer = Schema.decodeUnknownResult(CheckAnswer);

/**
 * A number for each map state the page holds, so the checker can tell a step
 * on the map it has from a step on one it hasn't heard of yet.
 */
const mapIds = { next: 0, of: new WeakMap<MapState, number>() };

const mapIdOf = (state: MapState) => {
  const known = mapIds.of.get(state);

  if (known !== undefined) {
    return known;
  }

  mapIds.next += 1;
  mapIds.of.set(state, mapIds.next);

  return mapIds.next;
};

/**
 * Runs the drag check in a worker, off the page's main thread. `map` sends
 * the map a drag is on, once per map; `step` asks about a step on it, and
 * `answer` hears what the chapters checked so far find. Where the browser
 * has no workers the check runs on the page instead, a chapter at a time.
 */
interface DragChecker {
  readonly map: (map: CheckMap) => void;
  readonly step: (step: CheckStep) => void;
  readonly close: () => void;
}

const startChecker = (answer: (found: CheckAnswer) => void): DragChecker => {
  if (!("Worker" in globalThis)) {
    return dragChecker(answer);
  }

  const worker = new DragCheckWorker({ name: "drag check" });

  worker.addEventListener("message", (event: MessageEvent<unknown>) => {
    const decoded = decodeAnswer(event.data);

    if (Result.isSuccess(decoded)) {
      answer(decoded.success);
    }
  });

  // A dedicated worker's postMessage takes no target origin.
  const send = (message: CheckMap | CheckStep) => {
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a Worker, not a window
    worker.postMessage(message);
  };

  return {
    map: send,
    step: send,
    close: () => {
      worker.terminate();
    },
  };
};

/**
 * Holds what the drag in progress would leave. A refused drop is reported at
 * once, with its reason. Otherwise the check is the one `check` runs
 * (`draggedProblems`), on the layout the page shows with the drag's changes
 * applied.
 *
 * The check routes and draws every chapter, which takes seconds on a big map,
 * so it runs in a worker and the drag keeps up with the pointer. It starts
 * once the pointer has rested for a moment, draws the chapter on screen
 * first, and the panel grows as each other chapter comes in. A new step of
 * the drag starts again from its chapter on screen, and the worker drops the
 * old one. Chapters a drag doesn't change are remembered, not drawn again.
 * Once every chapter is in, the list is every problem `check` would report,
 * with the ones the drag adds marked.
 */
export function DragPreviewProvider({
  state,
  children,
}: {
  readonly state: MapState;
  readonly children: ReactNode;
}) {
  const [drag, setDrag] = useState<DragPreviewInput | undefined>();
  const [checked, setChecked] = useState(unchecked);
  // The step the panel waits on, so an answer to an older one is dropped.
  const [waitingOn, setWaitingOn] = useState(0);
  const { stop } = useWalkthrough();
  const checker = useRef<DragChecker | undefined>(undefined);
  const steps = useRef(0);
  // Only a page that can edit drags, so only it starts the worker. The
  // read-only file loads nothing.
  const live = useEditing()?.canEdit === true;

  useEffect(() => {
    const started = live
      ? startChecker((found) => {
          if (found.step === steps.current) {
            setChecked(found);
          }
        })
      : undefined;

    checker.current = started;

    return () => {
      checker.current = undefined;
      started?.close();
    };
  }, [live]);

  // The checker gets the map whenever it changes, such as after a drop is
  // saved, and draws its chapters while nothing is dragged. A checker that
  // starts when Edit turns on hears it too.
  useEffect(() => {
    if (!live) {
      return;
    }

    checker.current?.map({
      kind: "map",
      id: mapIdOf(state),
      data: state.data,
      before: state.layout,
    });
  }, [state, live]);

  const changes = drag?.changes ?? none;
  const refused = drag?.refusal !== undefined;

  useEffect(() => {
    steps.current += 1;

    const step = steps.current;

    setWaitingOn(step);

    const send = Effect.sync(() => {
      checker.current?.step({
        kind: "step",
        step,
        map: mapIdOf(state),
        after: draggedLayout(state, changes),
        onScreen: stop.id,
      });
    });

    const fiber = Effect.runFork(
      changes.length === 0 || refused
        ? Effect.void
        : Effect.sleep(settle).pipe(Effect.andThen(send))
    );

    return () => {
      Effect.runFork(Fiber.interrupt(fiber));
    };
  }, [changes, refused, state, stop.id]);

  const [change, setChange] = useState<ChangePreviewInput | undefined>();

  // A drag in progress is what the panel shows; with none, the last change.
  const report = useMemo((): DragReport => {
    if (drag === undefined) {
      return change === undefined
        ? nothingReported
        : {
            refusal: change.refusal,
            problems: change.problems,
            source: "change",
          };
    }

    if (drag.refusal !== undefined) {
      return { refusal: drag.refusal, problems: [], source: "drag" };
    }

    // The last step's answer stays up while this step is checked.
    return {
      refusal: undefined,
      problems: checked.problems,
      source: "drag",
      complete: checked.complete && checked.step === waitingOn,
    };
  }, [drag, checked, change, waitingOn]);

  const changePreview = useMemo(
    (): ChangePreview => ({
      show: setChange,
      clear: () => {
        setChange(undefined);
      },
    }),
    []
  );

  const preview = useMemo(
    (): DragPreview => ({
      show: setDrag,
      clear: () => {
        setDrag(undefined);
        setChecked(unchecked);
      },
    }),
    []
  );

  const [outlines, setOutlines] = useState<DropOutlines | undefined>();

  const outlineState = useMemo(
    () => ({ outlines, set: setOutlines }),
    [outlines]
  );

  return (
    <PreviewContext value={preview}>
      <ChangePreviewContext value={changePreview}>
        <DropOutlinesContext value={outlineState}>
          <ReportContext value={report}>{children}</ReportContext>
        </DropOutlinesContext>
      </ChangePreviewContext>
    </PreviewContext>
  );
}

/**
 * What the drag in progress would leave, beside the map and never over it.
 *
 * - A drop that would be refused shows its reason, in words, with the fix.
 * - Otherwise it lists every warning `check` would report for the layout
 *   the drop makes, each as `check` words it: the message is the main text,
 *   and the file and field it's about sit small beneath it. The ones the
 *   drag adds are marked new.
 *
 * Nothing shows when there is nothing to say.
 */
export function DragWarnings({ className }: { readonly className?: string }) {
  const { refusal, problems, source, complete = true } = useDragReport();

  if (refusal === undefined && problems.length === 0) {
    return null;
  }

  const added = Arr.filter(problems, (item) => item.added).length;

  return (
    <section
      data-drag-warnings
      aria-label={`Warnings for this ${source}`}
      aria-live="polite"
      className={`border-refused bg-paper text-ink flex max-h-[45svh] shrink-0 flex-col border-2 text-xs ${className ?? ""}`}
    >
      {refusal === undefined ? (
        <>
          <h2
            data-drag-warnings-heading=""
            data-checking={complete ? undefined : ""}
            className="shrink-0 px-3 pt-2 pb-1 tracking-widest uppercase opacity-70"
          >
            {problems.length === 1
              ? "check would report 1 warning"
              : `check would report ${problems.length} warnings`}
            {added === 0 ? "" : `, ${added} new`}
            {complete ? "" : ", checking other chapters"}
          </h2>
          <ul
            data-drag-warnings-list=""
            className="flex min-h-0 flex-col gap-1.5 overflow-y-auto px-3 pb-2"
          >
            {Arr.map(problems, ({ problem, added: isNew }) => (
              <li
                key={`${problem.file} ${problem.path} ${problem.message}`}
                data-drag-warning=""
                data-warning-new={isNew}
                className="flex flex-col"
              >
                {isNew ? (
                  <b
                    data-warning-badge=""
                    className="text-2xs font-medium tracking-widest uppercase"
                  >
                    New from this {source}
                  </b>
                ) : null}
                <span data-warning-message="">{problem.message}</span>
                <span
                  data-warning-where=""
                  className="text-2xs font-mono opacity-60"
                >
                  {problem.path === ""
                    ? problem.file
                    : `${problem.file} ${problem.path}`}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <h2
            data-drag-warnings-heading=""
            className="shrink-0 px-3 pt-2 pb-1 tracking-widest uppercase opacity-70"
          >
            {source === "drag"
              ? "This drop would be refused"
              : "This change would be refused"}
          </h2>
          <p data-drag-refusal="" className="min-h-0 overflow-y-auto px-3 pb-2">
            {refusal}
          </p>
        </>
      )}
    </section>
  );
}
