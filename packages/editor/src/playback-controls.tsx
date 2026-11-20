import { controlClass } from "./control-class.ts";
import { reducedMotionNote, usePlayback } from "./playback.ts";

/** Play or pause, and step one hop. */
export function PlaybackControls() {
  const { pause, play, playing, reducedMotion, runs, step } = usePlayback();
  const nothingToPlay = runs.length === 0;

  return (
    <div className="flex items-center gap-1.5" data-playback-controls>
      {playing ? (
        <button
          className={controlClass}
          data-control="pause"
          onClick={pause}
          type="button"
        >
          ‖ Pause
        </button>
      ) : (
        <button
          className={controlClass}
          data-control="play"
          disabled={nothingToPlay || reducedMotion}
          onClick={play}
          title={reducedMotion ? reducedMotionNote : undefined}
          type="button"
        >
          ▸ Play
        </button>
      )}
      <button
        className={controlClass}
        data-control="step"
        disabled={nothingToPlay}
        onClick={step}
        type="button"
      >
        Step
      </button>
    </div>
  );
}
