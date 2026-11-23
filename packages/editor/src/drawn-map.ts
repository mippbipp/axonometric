import {
  knownSceneOf,
  rememberScenes,
  sameContent,
} from "@axonometric/contracts";
import type { CanvasSize, MapState, View } from "@axonometric/contracts";
import { Array as Arr } from "effect";
import {
  useEffect,
  useEffectEvent,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";

import CheckWorker from "./check.worker.ts?worker&inline";
import type { FitExtras } from "./fit-extras.ts";
import { readSceneAnswer } from "./scene-draw.ts";
import type { SceneAnswer, SceneAsk, SceneWant } from "./scene-draw.ts";

/** A map a view draws: the map state and the structures it reveals. */
export interface Drawable {
  readonly revealed: ReadonlySet<string>;
  readonly state: MapState;
}

/** How a map view draws its map, besides the map itself. */
export interface DrawnAs {
  readonly labelFirst: ReadonlyArray<string> | undefined;
  readonly labelled: ReadonlySet<string> | undefined;
  /** The other labelled sets the page may soon draw, such as other flows'. */
  readonly later: ReadonlyArray<ReadonlySet<string> | undefined>;
  readonly view: View;
  readonly zoom: number;
}

/** What the view draws now. */
export interface DrawnMap extends Drawable {
  /** The fit key the view fits by now. */
  readonly fitKey: string;
  /** Whether the page may draw other labelled sets itself now. */
  readonly warm: boolean;
}

interface Shown extends Drawable {
  readonly fitKey: string;
}

/** How far the worker has drawn the map asked for last, for the choices in `wants`. */
interface Progress {
  readonly done: boolean;
  readonly fitted: boolean;
  readonly map: Drawable;
  /** The key of the wants it was asked for (see `wantsKeyOf`). */
  readonly wants: string;
}

/** A key that is the same for two lists of wants that draw the same. */
const wantsKeyOf = (wants: ReadonlyArray<SceneWant>) =>
  // oxlint-disable-next-line effecttsgo/global-json -- a comparison key, never decoded
  JSON.stringify(wants);

const sameSet = (first: ReadonlySet<string>, second: ReadonlySet<string>) =>
  first.size === second.size && Arr.every([...first], (id) => second.has(id));

/** Whether two maps hold the same data, layout and revealed set. */
const sameMap = (first: Drawable, second: Drawable) =>
  sameContent(first.state.data, second.state.data) &&
  sameContent(first.state.layout, second.state.layout) &&
  sameSet(first.revealed, second.revealed);

/** How far the worker has drawn, and whether it failed and the page draws instead. */
interface Drawing {
  readonly failed: boolean;
  readonly progress: Progress | null;
}

/** The worker, the map and wants asked for last and their number, and what is drawn of them. */
interface WorkerState {
  asked: { readonly map: Drawable; readonly wants: string } | undefined;
  drawing: Drawing;
  number: number;
  worker: Worker | undefined;
}

/**
 * The worker that draws maps for one view, started on its first ask, and how
 * far it has drawn the map asked for last, for `useSyncExternalStore`.
 */
const sceneWorker = () => {
  const listeners = new Set<() => void>();
  const held: WorkerState = {
    asked: undefined,
    drawing: { failed: false, progress: null },
    number: 0,
    worker: undefined,
  };

  const publish = (drawing: Drawing) => {
    held.drawing = drawing;

    for (const listener of listeners) {
      listener();
    }
  };

  const hear = (answer: SceneAnswer) => {
    const { asked } = held;

    if (answer.ask !== held.number || asked === undefined) {
      return;
    }

    rememberScenes({
      data: asked.map.state.data,
      drawn: answer.drawn,
      layout: asked.map.state.layout,
      revealed: asked.map.revealed,
      routes: answer.routes,
    });
    publish({
      failed: false,
      progress: {
        done: answer.done,
        fitted: answer.fitted,
        map: asked.map,
        wants: asked.wants,
      },
    });
  };

  const start = () => {
    const worker = new CheckWorker({ name: "scene drawing" });

    worker.addEventListener("message", (event: MessageEvent<unknown>) => {
      const read = readSceneAnswer(event.data);

      if (read !== undefined) {
        hear(read);
      }
    });
    worker.addEventListener("error", fail);

    return worker;
  };

  // A worker that fails, or that the browser won't start or send a map to,
  // would leave the view on the old map, so the page draws every map itself
  // from then on.
  const fail = () => {
    held.worker?.terminate();
    held.worker = undefined;
    publish({ failed: true, progress: null });
  };

  const send = (message: SceneAsk) => {
    try {
      held.worker ??= start();
      // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a Worker, not a window
      held.worker.postMessage(message);
    } catch {
      fail();
    }
  };

  return {
    ask: (map: Drawable, wants: ReadonlyArray<SceneWant>) => {
      const key = wantsKeyOf(wants);

      if (
        held.asked !== undefined &&
        held.asked.wants === key &&
        sameMap(held.asked.map, map)
      ) {
        // The same map and choices again, in new objects: its drawings fit
        // them too.
        held.asked = { map, wants: key };

        return;
      }

      // A new map, or the same map drawn another way, such as in another
      // view: the worker stops what it draws and draws this.
      held.asked = { map, wants: key };
      held.number += 1;
      send({
        ask: held.number,
        data: map.state.data,
        kind: "scene ask",
        layout: map.state.layout,
        revealed: [...map.revealed],
        wants,
      });
    },
    close: () => {
      held.worker?.terminate();
      held.worker = undefined;
      held.asked = undefined;
    },
    drawing: () => held.drawing,
    subscribe: (listener: () => void) => {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
  };
};

const wantOf = (
  as: Pick<DrawnAs, "labelFirst" | "view" | "zoom">,
  labelled: ReadonlySet<string> | undefined,
  fit: SceneWant["fit"]
): SceneWant => ({
  fit,
  labelFirst: as.labelFirst ?? [],
  labelled: labelled === undefined ? null : [...labelled],
  view: as.view,
  zoom: as.zoom,
});

/**
 * What a view will draw of its map, first things first: the scene, the scenes
 * its fit tries as it fits them, and the other labelled sets.
 */
const wantsOf = ({
  as,
  canvas,
  extras,
  fitTo,
}: {
  readonly as: DrawnAs;
  readonly canvas: CanvasSize | undefined;
  readonly extras: FitExtras;
  readonly fitTo: ReadonlySet<string>;
}): ReadonlyArray<SceneWant> => [
  wantOf(as, as.labelled, null),
  ...(canvas === undefined
    ? []
    : [wantOf(as, as.labelled, { extras, fitTo: [...fitTo], size: canvas })]),
  ...Arr.map(as.later, (labelled) => wantOf(as, labelled, null)),
];

/**
 * What the view draws now, whether the worker must be asked for `next`, and
 * whether the page may warm other scenes itself.
 */
const drawingNow = ({
  as,
  live,
  next,
  progress,
  shown,
  wantsKey,
}: {
  readonly as: DrawnAs;
  readonly live: boolean;
  readonly next: Shown;
  readonly progress: Progress | null;
  readonly shown: Shown;
  readonly wantsKey: string;
}) => {
  const known =
    knownSceneOf({
      data: next.state.data,
      labelFirst: as.labelFirst,
      labelled: as.labelled,
      layout: next.state.layout,
      revealed: next.revealed,
      view: as.view,
      zoom: as.zoom,
    }) !== undefined;

  // The view takes the map once the worker has answered for it drawn as the
  // view draws it now. A view, a label or a fit that has changed since asks
  // again, rather than drawing here what the worker didn't.
  const answered =
    progress !== null &&
    progress.wants === wantsKey &&
    sameMap(progress.map, next);

  const drawNow =
    !live ||
    known ||
    answered ||
    sameContent(shown.state.data, next.state.data);

  if (!drawNow) {
    return { ask: true, target: shown, warm: false };
  }

  const fitHeld = live && answered && !progress.fitted;

  // While the worker draws this map, it draws the other labelled sets too,
  // so the page leaves them to it. A map the page drew itself, such as one
  // a drag made, the page warms.
  const drawing =
    live && progress !== null && !progress.done && sameMap(progress.map, next);

  return {
    ask: false,
    target: fitHeld ? { ...next, fitKey: shown.fitKey } : next,
    warm: !drawing,
  };
};

/**
 * The map a view draws now, and the fit key it fits by.
 *
 * Routing and drawing a big map takes about a second, so a map whose data is
 * new, such as one with a proposed structure, is drawn in a worker while the
 * view keeps drawing the map before. The worker draws the scene first, then
 * the scenes Zoom to fit tries for `fitTo` on a canvas of `size()`, then the
 * labelled sets in `later`, so a flow pick finds them drawn. The view takes
 * the new map once its scene is in, and a new fit key once its fit is in.
 *
 * A map with the same data, such as one with a structure dragged, is drawn
 * at once, as it follows the engineer's hand. So is every map where the
 * browser has no workers, or once the worker has failed.
 */
export const useDrawnMap = ({
  as,
  extras,
  fitTo,
  next,
  size,
}: {
  readonly as: DrawnAs;
  /** What the view's fit counts besides the map. */
  readonly extras: FitExtras;
  readonly fitTo: ReadonlySet<string>;
  readonly next: Drawable & { readonly fitKey: string };
  /** The canvas the view last fitted, if it has fitted yet. */
  readonly size: () => CanvasSize | undefined;
}): DrawnMap => {
  const workers = "Worker" in globalThis;
  const [shown, setShown] = useState<Shown>(next);
  const drawer = useMemo(() => sceneWorker(), []);
  const { failed, progress } = useSyncExternalStore(
    drawer.subscribe,
    drawer.drawing
  );

  const wants = wantsOf({ as, canvas: size(), extras, fitTo });
  const wantsKey = wantsKeyOf(wants);
  const { ask, target, warm } = drawingNow({
    as,
    live: workers && !failed,
    next,
    progress,
    shown,
    wantsKey,
  });

  if (
    target.state !== shown.state ||
    target.revealed !== shown.revealed ||
    target.fitKey !== shown.fitKey
  ) {
    setShown(target);
  }

  // The worker hears of a new map, or of the same map wanted another way.
  // `wantsKey` names the wants by content, so a new list that draws the same
  // doesn't ask again.
  const asking = useEffectEvent((map: Drawable, key: string) => {
    if (key === wantsKey) {
      drawer.ask(map, wants);
    }
  });

  useEffect(() => {
    if (ask) {
      asking(next, wantsKey);
    }
  }, [ask, next, wantsKey]);

  useEffect(
    () => () => {
      drawer.close();
    },
    [drawer]
  );

  return { ...target, warm };
};
