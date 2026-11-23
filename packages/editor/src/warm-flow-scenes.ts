import { cachedSceneOf, playSpotlightOf } from "@axonometric/contracts";
import type { MapState, Spotlight, View } from "@axonometric/contracts";
import type { HopState } from "@axonometric/drawing";
import { Array as Arr } from "effect";
import { use, useEffect, useMemo } from "react";

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
 * The labelled sets of every other flow choice, while the last chapter's
 * flow picker is showing, so they can be placed before a pick. Empty
 * otherwise.
 */
export const useOtherFlowLabels = ({
  data,
  hopStates,
}: {
  readonly data: MapState["data"];
  readonly hopStates: ReadonlyMap<string, HopState>;
}): ReadonlyArray<ReadonlySet<string> | undefined> => {
  const walkthrough = use(WalkthroughContext);
  const picking = walkthrough?.isLast === true;
  const flowChoice = walkthrough?.flowChoice;
  const stop = walkthrough?.stop;

  return useMemo(() => {
    if (!picking || flowChoice === undefined || stop === undefined) {
      return [];
    }

    const own = flowChoiceKey(flowChoice);

    return Arr.flatMap(
      flowOptionsOf({ flows: data.flows, stop }),
      ({ choice, key }) =>
        key === own
          ? []
          : [labelledHopsOf(playSpotlightOf({ choice, data, stop }), hopStates)]
    );
  }, [picking, flowChoice, stop, data, hopStates]);
};

/**
 * Places the scene of each labelled set in `others` in idle time, one scene
 * per callback, so a flow pick finds its labels already placed. It waits
 * while `ready` is false, and stops when the inputs change or the page
 * closes.
 */
export const useWarmFlowScenes = ({
  labelFirst,
  others,
  ready,
  revealed,
  state,
  textZoom,
  view,
}: {
  readonly labelFirst: ReadonlyArray<string> | undefined;
  readonly others: ReadonlyArray<ReadonlySet<string> | undefined>;
  readonly ready: boolean;
  readonly revealed: ReadonlySet<string>;
  readonly state: MapState;
  readonly textZoom: number;
  readonly view: View;
}) => {
  const { data, layout } = state;

  useEffect(() => {
    if (!ready) {
      return noop;
    }

    const pending = Arr.map(others, (labelled) => () => {
      cachedSceneOf({
        data,
        labelFirst,
        labelled,
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
  }, [ready, others, data, layout, labelFirst, revealed, view, textZoom]);
};
