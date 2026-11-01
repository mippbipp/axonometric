import type { MapState } from "@axonometric/contracts";
import { createContext, use, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { chapterStopsOf, defaultFlowChoice, tracksOf } from "./chapters.ts";
import type { ChapterStop, FlowChoice, Track } from "./chapters.ts";

/**
 * The walkthrough's state, shared by every view of the map. Views read
 * `revealed`, `fresh` and `fit` to decide what to draw, and `tracks` to know
 * what the packets play.
 */
export interface Walkthrough {
  readonly state: MapState;
  readonly stops: readonly ChapterStop[];
  /** The current chapter's position in `stops`. */
  readonly index: number;
  readonly stop: ChapterStop;
  readonly isLast: boolean;
  /** Every structure revealed by the current chapter or an earlier one. */
  readonly revealed: ReadonlySet<string>;
  /** The structures the current chapter reveals for the first time. */
  readonly fresh: ReadonlySet<string>;
  /**
   * The structures a view should zoom to fit. Today that's everything
   * revealed so far.
   */
  readonly fit: ReadonlySet<string>;
  readonly flowChoice: FlowChoice;
  /** The hop lists the packets play, one packet per track. */
  readonly tracks: readonly Track[];
  readonly goTo: (index: number) => void;
  readonly next: () => void;
  readonly back: () => void;
  readonly chooseFlow: (choice: FlowChoice) => void;
}

const WalkthroughContext = createContext<Walkthrough | null>(null);

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
  // chapterStopsOf always returns at least one chapter.
  const stop = stops[index] ?? (stops[0] as ChapterStop);
  const isLast = index === last;
  const flowChoice = position.choice ?? defaultFlowChoice(state, stop, isLast);

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
      tracks: tracksOf(state, stop, flowChoice),
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

/** The walkthrough state. Call it inside a `WalkthroughProvider`. */
export const useWalkthrough = (): Walkthrough => {
  const value = use(WalkthroughContext);

  if (value === null) {
    throw new Error("useWalkthrough needs a WalkthroughProvider above it.");
  }

  return value;
};
