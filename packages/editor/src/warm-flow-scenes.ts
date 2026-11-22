import { cachedSceneOf, playSpotlightOf } from "@axonometric/contracts";
import type { MapState, Spotlight, View } from "@axonometric/contracts";
import type { HopState } from "@axonometric/drawing";
import { Array as Arr } from "effect";
import { use, useEffect } from "react";

import { flowChoiceKey, flowOptionsOf } from "./chapters.ts";
import { WalkthroughContext } from "./walkthrough-context.ts";

/**
 * The hops the map labels: the play spotlight's, and any a proposal draws or
 * deletes, so no label sits on them. Everything that places a scene for the
 * page builds its labelled set here, because the scene cache is keyed by it.
 */
// oxlint-disable-next-line effecttsgo/missing-pipeable-signature -- called with both arguments in hand, never piped.
export const labelledHopsOf = (
  play: Pick<Spotlight, "hops"> | null,
  hopStates: ReadonlyMap<string, HopState>
): ReadonlySet<string> | undefined =>
  play === null ? undefined : new Set([...play.hops, ...hopStates.keys()]);

const noop = () => {};

type Idle = (work: () => void) => () => void;

// Safari has no requestIdleCallback.
const whenIdle: Idle = (work) => {
  if (typeof requestIdleCallback === "function") {
    const handle = requestIdleCallback(work);

    return () => {
      cancelIdleCallback(handle);
    };
  }

  // oxlint-disable-next-line effecttsgo/global-timers -- plain DOM scheduling, outside any Effect runtime
  const handle = setTimeout(work, 50);

  return () => {
    clearTimeout(handle);
  };
};

/**
 * While the last chapter's flow picker is showing, places the scene of every
 * other flow choice in idle time, one scene per callback, so a pick finds its
 * labels already placed. It stops when the inputs change or the page closes.
 */
export const useWarmFlowScenes = ({
  hopStates,
  labelFirst,
  revealed,
  state,
  textZoom,
  view,
}: {
  readonly hopStates: ReadonlyMap<string, HopState>;
  readonly labelFirst: ReadonlyArray<string> | undefined;
  readonly revealed: ReadonlySet<string>;
  readonly state: MapState;
  readonly textZoom: number;
  readonly view: View;
}) => {
  const walkthrough = use(WalkthroughContext);
  const picking = walkthrough?.isLast === true;
  const flowChoice = walkthrough?.flowChoice;
  const stop = walkthrough?.stop;
  const { data, layout } = state;

  useEffect(() => {
    if (!picking || flowChoice === undefined || stop === undefined) {
      return noop;
    }

    const own = flowChoiceKey(flowChoice);

    const others = Arr.filter(
      flowOptionsOf({ flows: data.flows, stop }),
      ({ key }) => key !== own
    );

    const pending = Arr.map(others, ({ choice }) => () => {
      const play = playSpotlightOf({ choice, data, stop });

      cachedSceneOf({
        data,
        labelFirst,
        labelled: labelledHopsOf(play, hopStates),
        layout,
        revealed,
        view,
        zoom: textZoom,
      });
    });

    let cancel = noop;

    const step = () => {
      const place = pending.shift();

      if (place !== undefined) {
        cancel = whenIdle(() => {
          place();
          step();
        });
      }
    };

    step();

    return () => {
      cancel();
    };
  }, [
    picking,
    flowChoice,
    stop,
    data,
    layout,
    hopStates,
    labelFirst,
    revealed,
    view,
    textZoom,
  ]);
};
