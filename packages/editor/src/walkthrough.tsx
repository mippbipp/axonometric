import { chapterStopsOf, defaultFlowChoice } from "@axonometric/contracts";
import type { ChapterStop, FlowChoice, MapState } from "@axonometric/contracts";
import { Array as Arr } from "effect";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";

import { chapterPlayOf } from "./chapters.ts";
import { useProposedAdds } from "./proposed-adds-context.ts";
import { WalkthroughContext } from "./walkthrough-context.ts";
import type { Walkthrough } from "./walkthrough-context.ts";

interface Position {
  readonly index: number;
  /** `null` until someone uses the flow picker in this chapter. */
  readonly choice: FlowChoice | null;
}

/** Holds the current chapter and the flow picker's choice. */
export function WalkthroughProvider({
  state,
  children,
}: {
  readonly state: MapState;
  readonly children: ReactNode;
}) {
  const always = useProposedAdds();

  // A structure the engineer proposed shows in every chapter, and is not "new"
  // in any of them. Chapter data is left alone: the agent decides where it is
  // revealed when it accepts the structure.
  const stops = useMemo(
    () =>
      Arr.map(chapterStopsOf(state), (stop): ChapterStop => ({
        ...stop,
        revealed: new Set([...stop.revealed, ...always]),
      })),
    [state, always]
  );

  const [position, setPosition] = useState<Position>({
    index: 0,
    choice: null,
  });

  const last = stops.length - 1;
  const index = Math.min(position.index, last);
  const stop = stops[index] ?? stops[0];
  const isLast = index === last;

  const flowChoice =
    position.choice ?? defaultFlowChoice({ data: state.data, stop, isLast });

  const value = useMemo((): Walkthrough => {
    const goTo = (target: number) => {
      setPosition((current) => {
        const clamped = Math.max(0, Math.min(last, target));

        return clamped === current.index
          ? current
          : { index: clamped, choice: null };
      });
    };

    const play = chapterPlayOf({ state, stop, choice: flowChoice });

    return {
      state,
      stops,
      index,
      stop,
      isLast,
      revealed: stop.revealed,
      newlyRevealed: new Set(stop.newlyRevealed),
      fit: stop.revealed,
      flowChoice,
      runs: play.runs,
      playKey: play.key,
      goTo,
      next: () => {
        setPosition((current) =>
          current.index >= last
            ? current
            : { index: current.index + 1, choice: null }
        );
      },
      back: () => {
        setPosition((current) =>
          current.index <= 0
            ? current
            : { index: current.index - 1, choice: null }
        );
      },
      chooseFlow: (choice) => {
        setPosition((current) => ({ ...current, choice }));
      },
    };
  }, [state, stops, index, stop, isLast, last, flowChoice]);

  return <WalkthroughContext value={value}>{children}</WalkthroughContext>;
}
