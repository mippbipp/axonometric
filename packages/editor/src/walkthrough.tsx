import type { MapState } from "@axonometric/contracts";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";

import { chapterStopsOf, defaultFlowChoice, tracksOf } from "./chapters.ts";
import type { FlowChoice } from "./chapters.ts";
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
  const stops = useMemo(() => chapterStopsOf(state), [state]);

  const [position, setPosition] = useState<Position>({
    index: 0,
    choice: null,
  });

  const last = stops.length - 1;
  const index = Math.min(position.index, last);
  const stop = stops[index] ?? stops[0];
  const isLast = index === last;

  const flowChoice =
    position.choice ?? defaultFlowChoice({ state, stop, isLast });

  const value = useMemo((): Walkthrough => {
    const goTo = (target: number) => {
      setPosition((current) => {
        const clamped = Math.max(0, Math.min(last, target));

        return clamped === current.index
          ? current
          : { index: clamped, choice: null };
      });
    };

    return {
      state,
      stops,
      index,
      stop,
      isLast,
      revealed: stop.revealed,
      fresh: new Set(stop.fresh),
      fit: stop.revealed,
      flowChoice,
      tracks: tracksOf({ state, stop, choice: flowChoice }),
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
