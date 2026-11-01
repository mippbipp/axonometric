import { Array as Arr } from "effect";

/** Seconds a packet takes to travel one hop. */
export const travelSeconds = 1.4;

/** Seconds a packet waits at the end of a hop before the next one. */
export const hopPauseSeconds = 0.35;

/** Seconds a packet waits at the end of its last hop before looping. */
export const loopPauseSeconds = 1.2;

/** Where a packet is: which hop of its track, and how far along it. */
export interface PacketAt {
  readonly hop: number;
  /** 0 at the hop's start, 1 at its end. */
  readonly t: number;
}

const slotSeconds = (hop: number, hops: number) =>
  travelSeconds + (hop === hops - 1 ? loopPauseSeconds : hopPauseSeconds);

const cycleSeconds = (hops: number) =>
  hops * travelSeconds + (hops - 1) * hopPauseSeconds + loopPauseSeconds;

/**
 * Where a packet on a track of `hops` hops is after `clock` seconds of
 * playback. Every track starts its first hop at 0 and loops on its own
 * cycle. Timing doesn't depend on the drawing, so every view agrees.
 */
export const packetAt = (clock: number, hops: number): PacketAt => {
  if (hops <= 0) {
    return { hop: 0, t: 0 };
  }

  const cycle = cycleSeconds(hops);
  let left = ((clock % cycle) + cycle) % cycle;

  for (const hop of Arr.range(0, hops - 1)) {
    if (left < slotSeconds(hop, hops)) {
      return { hop, t: Math.min(1, left / travelSeconds) };
    }

    left -= slotSeconds(hop, hops);
  }

  return { hop: hops - 1, t: 1 };
};

/**
 * The clock reading at which a packet on a track of `hops` hops is halfway
 * along hop `hop`, in the same cycle as `clock` or the next one. Stepping
 * sets the clock to this.
 */
export const clockAtHop = (clock: number, hops: number, hop: number) => {
  const cycle = cycleSeconds(hops);
  const cycleStart = Math.floor(clock / cycle) * cycle;

  const offset =
    Arr.reduce(Arr.range(0, hop - 1), 0, (sum, index) =>
      index < hop ? sum + slotSeconds(index, hops) : sum
    ) +
    travelSeconds / 2;

  const inThisCycle = cycleStart + offset;

  return inThisCycle > clock ? inThisCycle : inThisCycle + cycle;
};
