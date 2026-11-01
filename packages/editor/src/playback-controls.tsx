import { usePlayback } from "./packets.tsx";

/** The look of the walkthrough's small bordered buttons. */
export const controlClass =
  "border-ink focus-visible:outline-ink cursor-pointer border-[1.5px] bg-paper px-2 py-0.5 text-[11px] focus-visible:outline-2 focus-visible:outline-offset-1 disabled:cursor-default disabled:opacity-40";

/** Play or pause, and step one hop. */
export function PlaybackControls() {
  const { tracks, playing, reducedMotion, play, pause, step } = usePlayback();
  const nothingToPlay = tracks.length === 0;

  return (
    <div data-playback-controls className="flex items-center gap-1.5">
      {playing ? (
        <button
          type="button"
          data-control="pause"
          className={controlClass}
          onClick={pause}
        >
          ‖ Pause
        </button>
      ) : (
        <button
          type="button"
          data-control="play"
          className={controlClass}
          disabled={nothingToPlay || reducedMotion}
          title={
            reducedMotion
              ? "Packets stay still because you prefer reduced motion. Use Step."
              : undefined
          }
          onClick={play}
        >
          ▸ Play
        </button>
      )}
      <button
        type="button"
        data-control="step"
        className={controlClass}
        disabled={nothingToPlay}
        onClick={step}
      >
        Step
      </button>
    </div>
  );
}

