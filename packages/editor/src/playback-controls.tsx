import { Button } from "@axonometric/ui/components/button";
import { WithTooltip } from "@axonometric/ui/components/tooltip";

import { uiControlClass } from "./control-class.ts";
import { reducedMotionNote, usePlayback } from "./playback.ts";

/** Play or pause, and step one hop. */
export function PlaybackControls() {
  const { pause, play, playing, reducedMotion, runs, step } = usePlayback();
  const nothingToPlay = runs.length === 0;

  return (
    <div className="flex items-center gap-1.5" data-playback-controls>
      {playing ? (
        <Button className={uiControlClass} data-control="pause" onClick={pause}>
          ‖ Pause
        </Button>
      ) : (
        <WithTooltip
          control={
            <Button
              className={uiControlClass}
              data-control="play"
              disabled={nothingToPlay || reducedMotion}
              focusableWhenDisabled
              onClick={play}
            >
              ▸ Play
            </Button>
          }
          disabled={!reducedMotion}
        >
          {reducedMotionNote}
        </WithTooltip>
      )}
      <Button
        className={uiControlClass}
        data-control="step"
        disabled={nothingToPlay}
        onClick={step}
      >
        Step
      </Button>
    </div>
  );
}
