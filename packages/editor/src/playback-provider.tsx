import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { clockAtHop, packetAt, travelSeconds } from "./packet-schedule.ts";
import { ClockContext, PlaybackContext, useReducedMotion } from "./playback.ts";
import type { Playback } from "./playback.ts";
import { useWalkthrough } from "./walkthrough-context.ts";

interface Session {
  /** Which chapter and flow choice this session plays. */
  readonly key: string;
  readonly clock: number;
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
      update,
      play: () => {
        update((current) => ({ ...current, playing: true, selected: null }));
      },
      pause: () => {
        update((current) => ({ ...current, playing: false }));
      },
      step: () => {
        update((current) => {
          const runIndex = current.selected ?? 0;
          const hops = runs[runIndex]?.hops.length ?? 0;

          if (hops === 0) {
            return current;
          }

          const next =
            (packetAt({ clock: current.clock, hops }).hop + 1) % hops;

          return {
            ...current,
            clock: clockAtHop({ clock: current.clock, hops, hop: next }),
            playing: false,
            selected: runIndex,
          };
        });
      },
      selectPacket: (index: number) => {
        update((current) => ({
          ...current,
          playing: false,
          selected: index,
        }));
      },
    };
  }, [key, reducedMotion, runs]);

  const { update } = actions;

  useEffect(() => {
    let last = performance.now();
    let frame = 0;

    const tick = (now: number) => {
      const seconds = Math.min(0.05, (now - last) / 1000);

      last = now;
      update((current) => ({ ...current, clock: current.clock + seconds }));
      frame = requestAnimationFrame(tick);
    };

    if (playing) {
      frame = requestAnimationFrame(tick);
    }

    return () => {
      cancelAnimationFrame(frame);
    };
  }, [playing, update]);

  const value = useMemo((): Playback => {
    const hop =
      run === undefined || selectedHop === null
        ? undefined
        : run.hops[selectedHop];

    return {
      runs,
      playing,
      reducedMotion,
      selected:
        run === undefined || hop === undefined || selectedHop === null
          ? null
          : { run, hop, index: selectedHop },
      play: actions.play,
      pause: actions.pause,
      step: actions.step,
      selectPacket: actions.selectPacket,
    };
  }, [runs, playing, reducedMotion, run, selectedHop, actions]);

  return (
    <PlaybackContext value={value}>
      <ClockContext value={session.clock}>{children}</ClockContext>
    </PlaybackContext>
  );
}
