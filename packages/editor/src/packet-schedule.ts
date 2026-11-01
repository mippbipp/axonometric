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

/** A playback time, and how many hops the packet's track has. */
export interface TrackClock {
  /** Seconds of playback so far. */
  readonly clock: number;
  readonly hops: number;
}

const slotSeconds = (hop: number, hops: number) =>
  travelSeconds + (hop === hops - 1 ? loopPauseSeconds : hopPauseSeconds);

const cycleSeconds = (hops: number) =>
  hops * travelSeconds + (hops - 1) * hopPauseSeconds + loopPauseSeconds;

/**
 * Where a packet is after `clock` seconds of playback. Every track starts its
 * first hop at 0 and loops on its own cycle. Timing doesn't depend on the
 * drawing, so every view agrees.
 */
export const packetAt = ({ clock, hops }: TrackClock): PacketAt => {
  if (hops <= 0) {
    return { hop: 0, t: 0 };
  }

  const cycle = cycleSeconds(hops);
  let left = ((clock % cycle) + cycle) % cycle;

  for (let hop = 0; hop < hops; hop++) {
    const slot = slotSeconds(hop, hops);

    if (left < slot) {
      return { hop, t: Math.min(1, left / travelSeconds) };
    }

    left -= slot;
  }

  return { hop: hops - 1, t: 1 };
};

/**
 * The first clock reading after `clock` at which the packet is halfway along
 * hop `hop`. Stepping sets the clock to this.
 */
export const clockAtHop = ({
  clock,
  hops,
  hop,
}: TrackClock & { readonly hop: number }) => {
  const cycle = cycleSeconds(hops);
  const cycleStart = Math.floor(clock / cycle) * cycle;

  let offset = travelSeconds / 2;

  for (let index = 0; index < hop; index++) {
    offset += slotSeconds(index, hops);
  }

  const inThisCycle = cycleStart + offset;

  return inThisCycle > clock ? inThisCycle : inThisCycle + cycle;
};
