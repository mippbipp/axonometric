import { useEffect, useEffectEvent } from "react";

/** The longest frame a clock counts, so a stalled tab doesn't jump ahead. */
const maxFrameSeconds = 0.05;

/**
 * Calls `advance` with the seconds since the last frame, once per animation
 * frame, while `playing` is true. Packet playback and the inside view share it.
 */
export const useFrameClock = ({
  playing,
  advance,
}: {
  readonly playing: boolean;
  readonly advance: (seconds: number) => void;
}) => {
  const onFrame = useEffectEvent(advance);

  useEffect(() => {
    let last = performance.now();
    let frame = 0;

    const tick = (now: number) => {
      const seconds = Math.min(maxFrameSeconds, (now - last) / 1000);

      last = now;
      onFrame(seconds);
      frame = requestAnimationFrame(tick);
    };

    if (playing) {
      frame = requestAnimationFrame(tick);
    }

    return () => {
      cancelAnimationFrame(frame);
    };
  }, [playing]);
};
