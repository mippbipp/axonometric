import {
  applyLayoutChanges,
  draggedProblems,
  shiftedRoutes,
} from "@axonometric/contracts";
import type {
  DraggedProblem,
  LayoutChange,
  MapState,
} from "@axonometric/contracts";
import { Array as Arr, Duration, Effect, Fiber } from "effect";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import {
  nothingReported,
  PreviewContext,
  ReportContext,
  useDragReport,
} from "./drag-preview-context.ts";
import type {
  DragPreview,
  DragPreviewInput,
  DragReport,
} from "./drag-preview-context.ts";
import { DropOutlinesContext } from "./outlines-context.ts";
import type { DropOutlines } from "./outlines-context.ts";

/** How long a drag rests before its warnings are worked out. */
const settle = Duration.millis(120);

const none: readonly LayoutChange[] = [];

const problemsOf = (
  { data, layout }: MapState,
  changes: readonly LayoutChange[]
): readonly DraggedProblem[] => {
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

  return draggedProblems(
    data,
    layout,
    applyLayoutChanges(layout, [...changes, ...carried])
  );
};

/**
 * Holds what the drag in progress would leave. A refused drop is reported at
 * once, with its reason. Otherwise the check is the one `check` runs
 * (`draggedProblems`), on the layout the page shows with the drag's changes
 * applied. It runs once the pointer has rested for a moment, so a big map
 * isn't checked on every step. It lists every problem `check` would report,
 * and marks the ones the drag adds.
 */
export function DragPreviewProvider({
  state,
  children,
}: {
  readonly state: MapState;
  readonly children: ReactNode;
}) {
  const [drag, setDrag] = useState<DragPreviewInput | undefined>();
  const [settled, setSettled] = useState(none);

  const changes = drag?.changes ?? none;

  // The check runs once the pointer has rested, so a drag over a big map
  // isn't checked on every step. The last answer stays up meanwhile.
  useEffect(() => {
    const settleOn = Effect.sync(() => {
      setSettled(changes);
    });

    const fiber = Effect.runFork(
      Effect.sleep(settle).pipe(Effect.andThen(settleOn))
    );

    return () => {
      Effect.runFork(Fiber.interrupt(fiber));
    };
  }, [changes]);

  const report = useMemo((): DragReport => {
    if (drag === undefined) {
      return nothingReported;
    }

    if (drag.refusal !== undefined) {
      return { refusal: drag.refusal, problems: [] };
    }

    return {
      refusal: undefined,
      problems: settled.length === 0 ? [] : problemsOf(state, settled),
    };
  }, [drag, settled, state]);

  const preview = useMemo(
    (): DragPreview => ({
      show: setDrag,
      clear: () => {
        setDrag(undefined);
        setSettled(none);
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
      <DropOutlinesContext value={outlineState}>
        <ReportContext value={report}>{children}</ReportContext>
      </DropOutlinesContext>
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
  const { refusal, problems } = useDragReport();

  if (refusal === undefined && problems.length === 0) {
    return null;
  }

  const added = Arr.filter(problems, (item) => item.added).length;

  return (
    <section
      data-drag-warnings
      aria-label="Warnings for this drag"
      aria-live="polite"
      className={`border-refused bg-paper text-ink flex max-h-[45svh] shrink-0 flex-col border-2 text-xs ${className ?? ""}`}
    >
      {refusal === undefined ? (
        <>
          <h2
            data-drag-warnings-heading=""
            className="shrink-0 px-3 pt-2 pb-1 tracking-widest uppercase opacity-70"
          >
            {problems.length === 1
              ? "check would report 1 warning"
              : `check would report ${problems.length} warnings`}
            {added === 0 ? "" : `, ${added} new`}
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
                    New from this drag
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
            This drop would be refused
          </h2>
          <p data-drag-refusal="" className="min-h-0 overflow-y-auto px-3 pb-2">
            {refusal}
          </p>
        </>
      )}
    </section>
  );
}
