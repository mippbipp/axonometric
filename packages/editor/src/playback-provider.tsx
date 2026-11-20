import { useMemo, useState } from "react";
import type { ReactNode } from "react";

import { useFrameClock } from "./frame-clock.ts";
import { clockAtNextHop, packetAt, travelSeconds } from "./packet-schedule.ts";
import { ClockContext, PlaybackContext, useReducedMotion } from "./playback.ts";
import type { Playback } from "./playback.ts";
import { useWalkthrough } from "./walkthrough-context.ts";

interface Session {
  readonly clock: number;
  /** Which chapter and flow choice this session plays. */
  readonly key: string;
  readonly playing: boolean;
  readonly selected: number | null;
}

const freshSession = (key: string, reducedMotion: boolean): Session => ({
  key,
  // At rest, packets sit halfway along their first hop.
  clock: reducedMotion ? travelSeconds / 2 : 0,
  playing: !reducedMotion,
  selected: null,
});

/** Plays the current chapter's runs. Put it inside a `WalkthroughProvider`. */
export function PlaybackProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const { playKey: key, runs } = useWalkthrough();
  const reducedMotion = useReducedMotion();

  const [stored, setStored] = useState<Session>(() =>
    freshSession(key, reducedMotion)
  );

  const session =
    stored.key === key ? stored : freshSession(key, reducedMotion);

  const playing = session.playing && !reducedMotion;
  const selectedRun = session.selected;
  const run = selectedRun === null ? undefined : runs[selectedRun];

  // Only set while paused, so it doesn't change every frame.
  const selectedHop =
    run === undefined
      ? null
      : packetAt({ clock: session.clock, hops: run.hops.length }).hop;

  const actions = useMemo(() => {
    const update = (change: (current: Session) => Session) => {
      setStored((current) =>
        change(current.key === key ? current : freshSession(key, reducedMotion))
      );
    };

    return {
      closePacket: () => {
        update((current) =>
          current.selected === null ? current : { ...current, selected: null }
        );
      },
      pause: () => {
        update((current) => ({ ...current, playing: false }));
      },
      play: () => {
        update((current) => ({ ...current, playing: true, selected: null }));
      },
      selectPacket: (index: number) => {
        update((current) => ({
          ...current,
          playing: false,
          selected: index,
        }));
      },
      step: () => {
        update((current) => {
          const runIndex = current.selected ?? 0;
          const hops = runs[runIndex]?.hops.length ?? 0;

          if (hops === 0) {
            return current;
          }

          return {
            ...current,
            clock: clockAtNextHop({ clock: current.clock, hops }),
            playing: false,
            selected: runIndex,
          };
        });
      },
      update,
    };
  }, [key, reducedMotion, runs]);

  const { update } = actions;

  useFrameClock({
    advance: (seconds) => {
      update((current) => ({ ...current, clock: current.clock + seconds }));
    },
    playing,
  });

  const value = useMemo((): Playback => {
    const hop =
      run === undefined || selectedHop === null
        ? undefined
        : run.hops[selectedHop];

    return {
      closePacket: actions.closePacket,
      pause: actions.pause,
      play: actions.play,
      playing,
      reducedMotion,
      runs,
      selected:
        run === undefined || hop === undefined || selectedHop === null
          ? null
          : { hop, index: selectedHop, run },
      selectPacket: actions.selectPacket,
      step: actions.step,
    };
  }, [runs, playing, reducedMotion, run, selectedHop, actions]);

  return (
    <PlaybackContext value={value}>
      <ClockContext value={session.clock}>{children}</ClockContext>
    </PlaybackContext>
  );
}
