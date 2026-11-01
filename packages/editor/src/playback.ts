import type { Hop } from "@axonometric/contracts";
import { createContext, use, useSyncExternalStore } from "react";

import type { PacketRun } from "./chapters.ts";

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

/** The packet someone clicked or stepped to: which run it's on. */
export interface SelectedPacket {
  readonly run: PacketRun;
  readonly hop: Hop;
  /** The hop's position in the run, from 0. */
  readonly index: number;
}

/**
 * Packet playback, shared by every view of the map. It restarts whenever the
 * chapter or the flow picker's choice changes.
 */
export interface Playback {
  readonly runs: readonly PacketRun[];
  readonly playing: boolean;
  /** When true, packets rest and only `step` moves them. */
  readonly reducedMotion: boolean;
  readonly selected: SelectedPacket | null;
  /** Plays from where the packets are and closes the packet panel. */
  readonly play: () => void;
  readonly pause: () => void;
  /**
   * Pauses and moves the selected packet, or the first run's packet, on to
   * its next hop, then selects it.
   */
  readonly step: () => void;
  /** Pauses and selects the packet on `run`, the index into `runs`. */
  readonly selectPacket: (run: number) => void;
  /** Closes the packet panel and stays paused. */
  readonly closePacket: () => void;
}

export const PlaybackContext = createContext<Playback | null>(null);

/** Seconds of playback so far. It changes every frame while playing. */
export const ClockContext = createContext(0);

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
