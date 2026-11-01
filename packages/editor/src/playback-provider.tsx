import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import type { FlowChoice } from "./chapters.ts";
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

const flowKey = (choice: FlowChoice) =>
  choice.kind === "flow" ? `flow:${choice.id}` : choice.kind;

/** Plays the current chapter's tracks. Put it inside a `WalkthroughProvider`. */
export function PlaybackProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const { stop, flowChoice, tracks } = useWalkthrough();
  const reducedMotion = useReducedMotion();
  const key = `${stop.id}|${flowKey(flowChoice)}`;

  const [stored, setStored] = useState<Session>(() =>
    freshSession(key, reducedMotion)
  );

  const session =
    stored.key === key ? stored : freshSession(key, reducedMotion);

  const playing = session.playing && !reducedMotion;
  const selectedTrack = session.selected;
  const track = selectedTrack === null ? undefined : tracks[selectedTrack];

  // Only set while paused, so it doesn't change every frame.
  const selectedHop =
    track === undefined
      ? null
      : packetAt({ clock: session.clock, hops: track.hops.length }).hop;

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
          const trackIndex = current.selected ?? 0;
          const hops = tracks[trackIndex]?.hops.length ?? 0;

          if (hops === 0) {
            return current;
          }

          const next =
            (packetAt({ clock: current.clock, hops }).hop + 1) % hops;

          return {
            ...current,
            clock: clockAtHop({ clock: current.clock, hops, hop: next }),
            playing: false,
            selected: trackIndex,
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
  }, [key, reducedMotion, tracks]);

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
      track === undefined || selectedHop === null
        ? undefined
        : track.hops[selectedHop];

    return {
      tracks,
      playing,
      reducedMotion,
      selected:
        track === undefined || hop === undefined || selectedHop === null
          ? null
          : { track, hop, index: selectedHop },
      play: actions.play,
      pause: actions.pause,
      step: actions.step,
      selectPacket: actions.selectPacket,
    };
  }, [tracks, playing, reducedMotion, track, selectedHop, actions]);

  return (
    <PlaybackContext value={value}>
      <ClockContext value={session.clock}>{children}</ClockContext>
    </PlaybackContext>
  );
}
