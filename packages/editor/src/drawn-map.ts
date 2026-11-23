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

/** How far the worker has drawn the map asked for last. */
interface Progress {
  readonly done: boolean;
  readonly fitted: boolean;
  readonly map: Drawable;
}

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

/** The worker, the map asked for last and its number, and what is drawn of it. */
interface WorkerState {
  asked: Drawable | undefined;
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
      data: asked.state.data,
      drawn: answer.drawn,
      layout: asked.state.layout,
      revealed: asked.revealed,
      routes: answer.routes,
    });
    publish({
      failed: false,
      progress: { done: answer.done, fitted: answer.fitted, map: asked },
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
    // A worker that fails would leave the view on the old map, so the page
    // draws every map itself from then on.
    worker.addEventListener("error", () => {
      publish({ failed: true, progress: null });
    });

    return worker;
  };

  return {
    ask: (map: Drawable, wants: ReadonlyArray<SceneWant>) => {
      if (held.asked !== undefined && sameMap(held.asked, map)) {
        // The same map again, in new objects: its drawings fit it too.
        held.asked = map;

        return;
      }

      held.asked = map;
      held.number += 1;
      held.worker ??= start();

      const message: SceneAsk = {
        ask: held.number,
        data: map.state.data,
        kind: "scene ask",
        layout: map.state.layout,
        revealed: [...map.revealed],
        wants,
      };

      // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a Worker, not a window
      held.worker.postMessage(message);
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
  fitTo,
  next,
  size,
}: {
  readonly as: DrawnAs;
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

  const live = workers && !failed;
  // Once the worker has answered for this map, the view takes it, even if
  // the text zoom has moved on since and its scene there is drawn here.
  const forNext = progress !== null && sameMap(progress.map, next);

  const drawNow =
    !live || known || forNext || sameContent(shown.state.data, next.state.data);

  const fitHeld = live && forNext && !progress.fitted;

  const target: Shown = drawNow
    ? fitHeld
      ? { ...next, fitKey: shown.fitKey }
      : next
    : shown;

  if (
    target.state !== shown.state ||
    target.revealed !== shown.revealed ||
    target.fitKey !== shown.fitKey
  ) {
    setShown(target);
  }

  const ask = useEffectEvent((map: Drawable) => {
    const canvas = size();

    drawer.ask(map, [
      wantOf(as, as.labelled, null),
      ...(canvas === undefined
        ? []
        : [wantOf(as, as.labelled, { fitTo: [...fitTo], size: canvas })]),
      ...Arr.map(as.later, (labelled) => wantOf(as, labelled, null)),
    ]);
  });

  useEffect(() => {
    if (!drawNow) {
      ask(next);
    }
  }, [drawNow, next]);

  useEffect(
    () => () => {
      drawer.close();
    },
    [drawer]
  );

  return { ...target, warm: !live || !forNext || progress.done };
};
