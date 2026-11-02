import {
  applyLayoutChanges,
  problemsAdded,
  shiftedRoutes,
} from "@axonometric/contracts";
import type {
  LayoutChange,
  MapProblem,
  MapState,
} from "@axonometric/contracts";
import { Array as Arr, Duration, Effect, Fiber } from "effect";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import {
  PreviewContext,
  WarningsContext,
  useDragWarnings,
} from "./drag-preview-context.ts";
import type { DragPreview } from "./drag-preview-context.ts";

/** How long a drag rests before its warnings are worked out. */
const settle = Duration.millis(120);

const none: readonly LayoutChange[] = [];

const noProblems: readonly MapProblem[] = [];

const warningsOf = (
  { data, layout }: MapState,
  changes: readonly LayoutChange[]
): readonly MapProblem[] => {
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

  return problemsAdded(
    data,
    layout,
    applyLayoutChanges(layout, [...changes, ...carried])
  );
};

/**
 * Holds the warnings of the drag in progress. The check is the one `check`
 * runs (`problemsAdded`), on the layout the page shows with the drag's
 * changes applied. It runs once the pointer has rested for a moment, so a
 * big map isn't checked on every step. Only warnings the drag adds show;
 * the ones the layout already had are left to `check`.
 */
export function DragPreviewProvider({
  state,
  children,
}: {
  readonly state: MapState;
  readonly children: ReactNode;
}) {
  const [changes, setChanges] = useState(none);
  const [settled, setSettled] = useState(none);

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

  const problems = useMemo(
    () =>
      changes.length === 0 || settled.length === 0
        ? noProblems
        : warningsOf(state, settled),
    [changes, settled, state]
  );

  const preview = useMemo(
    (): DragPreview => ({
      show: (next) => {
        setChanges(next ?? none);

        if (next === undefined) {
          setSettled(none);
        }
      },
    }),
    []
  );

  return (
    <PreviewContext value={preview}>
      <WarningsContext value={problems}>{children}</WarningsContext>
    </PreviewContext>
  );
}

/**
 * The warnings the drag in progress would add. They are the problems
 * `check` finds, so each reads as `check` words it: the message is the main
 * text, and the file and field it's about sit small beneath it. Nothing
 * shows when there are none.
 */
export function DragWarnings({ className }: { readonly className?: string }) {
  const problems = useDragWarnings();

  if (problems.length === 0) {
    return null;
  }

  return (
    <section
      data-drag-warnings
      aria-label="Warnings for this drag"
      aria-live="polite"
      className={`border-refused bg-paper text-ink max-h-40 max-w-xl overflow-auto border-2 px-3 py-2 text-xs ${className ?? ""}`}
    >
      <h2 className="mb-1 tracking-widest uppercase opacity-70">
        This would leave {problems.length === 1 ? "a warning" : "warnings"}
      </h2>
      <ul className="flex flex-col gap-1.5">
        {Arr.map(problems, (problem) => (
          <li
            key={`${problem.file} ${problem.path} ${problem.message}`}
            data-drag-warning=""
            className="flex flex-col"
          >
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
    </section>
  );
}
