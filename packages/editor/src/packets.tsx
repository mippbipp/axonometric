import type { Hop } from "@axonometric/contracts";
import { Array as Arr } from "effect";
import {
  createContext,
  use,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import type { KeyboardEvent, ReactNode } from "react";

import type { Track } from "./chapters.ts";
import { pointAlong, screenRouteOf } from "./iso.ts";
import { clockAtHop, packetAt, travelSeconds } from "./packet-schedule.ts";
import { useWalkthrough } from "./walkthrough.tsx";

const reducedMotionQuery = "(prefers-reduced-motion: reduce)";

const subscribeToReducedMotion = (onChange: () => void) => {
  const query = globalThis.matchMedia(reducedMotionQuery);

  query.addEventListener("change", onChange);

  return () => {
    query.removeEventListener("change", onChange);
  };
};

const prefersReducedMotion = () =>
  globalThis.matchMedia(reducedMotionQuery).matches;

/** Whether the user prefers reduced motion, kept up to date. */
export const useReducedMotion = () =>
  useSyncExternalStore(
    subscribeToReducedMotion,
    prefersReducedMotion,
    () => false
  );

/** The packet someone clicked or stepped to: which track it's on. */
export interface SelectedPacket {
  readonly track: Track;
  readonly hop: Hop;
  /** The hop's position in the track, from 0. */
  readonly index: number;
}

/**
 * Packet playback, shared by every view of the map. It restarts whenever the
 * chapter or the flow picker's choice changes.
 */
export interface Playback {
  readonly tracks: readonly Track[];
  readonly playing: boolean;
  /** When true, packets rest and only `step` moves them. */
  readonly reducedMotion: boolean;
  readonly selected: SelectedPacket | null;
  /** Plays from where the packets are and closes the packet panel. */
  readonly play: () => void;
  readonly pause: () => void;
  /**
   * Pauses and moves the selected packet, or the first track's packet, on to
   * its next hop, then selects it.
   */
  readonly step: () => void;
  /** Pauses and selects the packet on `track`, the index into `tracks`. */
  readonly selectPacket: (track: number) => void;
}

interface Session {
  /** Which chapter and flow choice this session plays. */
  readonly key: string;
  readonly clock: number;
  readonly playing: boolean;
  readonly selected: number | null;
}

const PlaybackContext = createContext<Playback | null>(null);

/** Seconds of playback so far. It changes every frame while playing. */
const ClockContext = createContext(0);

const freshSession = (key: string, reducedMotion: boolean): Session => ({
  key,
  // At rest, packets sit halfway along their first hop.
  clock: reducedMotion ? travelSeconds / 2 : 0,
  playing: !reducedMotion,
  selected: null,
});

const flowKey = (choice: ReturnType<typeof useWalkthrough>["flowChoice"]) =>
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
    track === undefined ? null : packetAt(session.clock, track.hops.length).hop;

  const actions = useMemo(() => {
    const update = (change: (current: Session) => Session) => {
      setStored((current) =>
        change(
          current.key === key ? current : freshSession(key, reducedMotion)
        )
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

          const next = (packetAt(current.clock, hops).hop + 1) % hops;

          return {
            ...current,
            clock: clockAtHop(current.clock, hops, next),
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
    if (!playing) {
      return;
    }

    let last = performance.now();
    let frame = 0;

    const tick = (now: number) => {
      const seconds = Math.min(0.05, (now - last) / 1000);

      last = now;
      update((current) => ({ ...current, clock: current.clock + seconds }));
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);

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

/** Packet playback. Call it inside a `PlaybackProvider`. */
export const usePlayback = (): Playback => {
  const value = use(PlaybackContext);

  if (value === null) {
    throw new Error("usePlayback needs a PlaybackProvider above it.");
  }

  return value;
};

/** Seconds of playback so far, for drawing packets. */
export const usePlaybackClock = () => use(ClockContext);

function Packet({
  track,
  trackIndex,
  showLabel,
}: {
  readonly track: Track;
  readonly trackIndex: number;
  readonly showLabel: boolean;
}) {
  const { state } = useWalkthrough();
  const { selected, selectPacket } = usePlayback();
  const clock = usePlaybackClock();
  const at = packetAt(clock, track.hops.length);
  const hop = track.hops[at.hop];
  const route = hop === undefined ? undefined : screenRouteOf(state.layout, hop);

  if (hop === undefined || route === undefined) {
    return null;
  }

  const { sx, sy } = pointAlong(route, at.t);
  const isSelected = selected?.track.id === track.id;
  const labelWidth = hop.label.length * 6.6 + 8;

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectPacket(trackIndex);
    }
  };

  return (
    <g>
      <g
        data-packet={hop.id}
        data-track={track.id}
        data-selected={isSelected}
        role="button"
        tabIndex={0}
        aria-label={`Packet: ${hop.label}`}
        className="cursor-pointer outline-none"
        onClick={() => {
          selectPacket(trackIndex);
        }}
        onKeyDown={onKeyDown}
      >
        {/* A wider, invisible target so the dot is easy to hit. */}
        <circle cx={sx} cy={sy} r={12} className="fill-transparent" />
        {isSelected ? (
          <circle
            cx={sx}
            cy={sy}
            r={11}
            fill="none"
            className="stroke-ink"
            strokeWidth={1.2}
            strokeDasharray="2 2"
          />
        ) : null}
        <circle
          cx={sx}
          cy={sy}
          r={5.5}
          className="fill-ink stroke-paper"
          strokeWidth={1.6}
        />
      </g>
      {showLabel || isSelected ? (
        <g className="pointer-events-none" aria-hidden="true">
          <rect
            x={sx + 8}
            y={sy - 21}
            width={labelWidth}
            height={15}
            className="fill-paper stroke-ink"
            strokeWidth={0.8}
          />
          <text
            x={sx + 12}
            y={sy - 10}
            className="fill-ink stroke-none font-mono text-[10px]"
          >
            {hop.label}
          </text>
        </g>
      ) : null}
    </g>
  );
}

/**
 * The packets for the current chapter, one per track, drawn in screen
 * coordinates. Put it inside the view's SVG.
 */
export function PacketLayer() {
  const { isLast } = useWalkthrough();
  const { tracks, playing } = usePlayback();

  return (
    <g data-packets data-playing={playing}>
      {Arr.map(tracks, (track, index) => (
        <Packet
          key={track.id}
          track={track}
          trackIndex={index}
          // The last chapter can play every flow at once, so labels there
          // only show for the selected packet.
          showLabel={!isLast}
        />
      ))}
    </g>
  );
}
