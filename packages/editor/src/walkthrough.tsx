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
  /** `null` until someone uses the flow picker in this chapter. */
  readonly choice: FlowChoice | null;
  readonly index: number;
}

/** Holds the current chapter and the flow picker's choice. */
export function WalkthroughProvider({
  children,
  state,
}: {
  readonly children: ReactNode;
  readonly state: MapState;
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
    choice: null,
    index: 0,
  });

  const last = stops.length - 1;
  const index = Math.min(position.index, last);
  const stop = stops[index] ?? stops[0];
  const isLast = index === last;

  const flowChoice =
    position.choice ?? defaultFlowChoice({ data: state.data, isLast, stop });

  const value = useMemo((): Walkthrough => {
    const goTo = (target: number) => {
      setPosition((current) => {
        const clamped = Math.max(0, Math.min(last, target));

        return clamped === current.index
          ? current
          : { choice: null, index: clamped };
      });
    };

    const play = chapterPlayOf({ choice: flowChoice, state, stop });

    return {
      back: () => {
        setPosition((current) =>
          current.index <= 0
            ? current
            : { choice: null, index: current.index - 1 }
        );
      },
      chooseFlow: (choice) => {
        setPosition((current) => ({ ...current, choice }));
      },
      fit: stop.revealed,
      flowChoice,
      goTo,
      index,
      isLast,
      newlyRevealed: new Set(stop.newlyRevealed),
      next: () => {
        setPosition((current) =>
          current.index >= last
            ? current
            : { choice: null, index: current.index + 1 }
        );
      },
      playKey: play.key,
      revealed: stop.revealed,
      runs: play.runs,
      state,
      stop,
      stops,
    };
  }, [state, stops, index, stop, isLast, last, flowChoice]);

  return <WalkthroughContext value={value}>{children}</WalkthroughContext>;
}
