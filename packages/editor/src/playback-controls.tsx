import { WithTooltip } from "@axonometric/ui/components/tooltip";

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
        <WithTooltip
          control={
            <button
              aria-disabled={nothingToPlay || reducedMotion}
              className={controlClass}
              data-control="play"
              onClick={() => {
                if (!nothingToPlay && !reducedMotion) {
                  play();
                }
              }}
              type="button"
            >
              ▸ Play
            </button>
          }
          disabled={!reducedMotion}
        >
          {reducedMotionNote}
        </WithTooltip>
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
