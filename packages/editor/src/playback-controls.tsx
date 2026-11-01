import { controlClass } from "./control-class.ts";
import { reducedMotionNote, usePlayback } from "./playback.ts";

/** Play or pause, and step one hop. */
export function PlaybackControls() {
  const { runs, playing, reducedMotion, play, pause, step } = usePlayback();
  const nothingToPlay = runs.length === 0;

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
          title={reducedMotion ? reducedMotionNote : undefined}
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
