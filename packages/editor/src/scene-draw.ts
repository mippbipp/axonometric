/* oxlint-disable perfectionist/sort-objects -- schema field order sets encoded JSON key order, so it stays as written */
import {
  cachedRoutesOf,
  cachedSceneOf,
  fittedViewOf,
  Layout,
  MapData,
  scenesDrawnBy,
} from "@axonometric/contracts";
import type { DrawnScene, HopRoute, ScenesDrawn } from "@axonometric/contracts";
import { Array as Arr, Effect, Fiber, Result, Schema } from "effect";

/**
 * Drawing a big map's scene and its zoom to fit takes about a second, so the
 * page asks a worker to draw a map it hasn't drawn yet. The worker routes it,
 * draws what the page will ask for, and sends back every route, scene and
 * name tag clash it made, for the page's scene cache to keep.
 */

const CanvasSize = Schema.Struct({
  width: Schema.Finite,
  height: Schema.Finite,
});

/** The structures a fit holds, on a canvas of `size`. */
const FitWant = Schema.Struct({
  fitTo: Schema.Array(Schema.String),
  size: CanvasSize,
});

/** One drawing the page will want of the map: a view, labelled as the page labels it. */
export const SceneWant = Schema.Struct({
  view: Schema.Literals(["iso", "plan"]),
  labelFirst: Schema.Array(Schema.String),
  /** The hops whose labels are placed, or none to place every one. */
  labelled: Schema.NullOr(Schema.Array(Schema.String)),
  zoom: Schema.Finite,
  /** The canvas to fit, when the page is about to fit the map. */
  fit: Schema.NullOr(FitWant),
});

export type SceneWant = typeof SceneWant.Type;

/**
 * The map to draw, and what to draw of it, first things first. `ask` names
 * it, so the page can drop answers to a map it has moved past.
 */
export const SceneAsk = Schema.Struct({
  kind: Schema.Literal("scene ask"),
  ask: Schema.Int,
  data: MapData,
  layout: Layout,
  revealed: Schema.Array(Schema.String),
  wants: Schema.Array(SceneWant),
});

export type SceneAsk = typeof SceneAsk.Type;

/**
 * What the worker drew for one want of an ask: the routes, and every scene
 * and tag clash set the drawing asked for. A scene goes as is: it is plain
 * data, and the page keeps it in its cache without checking it again.
 */
export interface SceneAnswer {
  readonly ask: number;
  /** Whether this is the ask's last answer. */
  readonly done: boolean;
  readonly drawn: ReadonlyArray<DrawnScene>;
  /** Whether the scenes the ask's fit tries are in, if it asked for one. */
  readonly fitted: boolean;
  readonly kind: "scene answer";
  readonly routes: Readonly<Record<string, HopRoute>>;
}

const SceneAnswerShape = Schema.Struct({
  kind: Schema.Literal("scene answer"),
  ask: Schema.Int,
  done: Schema.Boolean,
  fitted: Schema.Boolean,
  drawn: Schema.Array(Schema.Unknown),
  routes: Schema.Record(Schema.String, Schema.Unknown),
});

const decodeShape = Schema.decodeUnknownResult(SceneAnswerShape);

/**
 * Reads an answer from the worker. The worker is the page's own code, so
 * only the envelope is checked; the scenes in it are trusted as the page
 * would trust its own.
 */
export const readSceneAnswer = (message: unknown): SceneAnswer | undefined => {
  const decoded = decodeShape(message);

  return Result.isSuccess(decoded) ? (message as SceneAnswer) : undefined;
};

/** Draws one want, recording every scene it asks the cache for. */
const drawWant = (
  {
    data,
    layout,
    revealed,
  }: Pick<SceneAsk, "data" | "layout"> & {
    readonly revealed: ReadonlySet<string>;
  },
  want: SceneWant
): ScenesDrawn<number | undefined> => {
  const labelled = want.labelled === null ? undefined : new Set(want.labelled);

  return scenesDrawnBy((): number | undefined => {
    const fitted =
      want.fit === null
        ? undefined
        : fittedViewOf({
            chapter: { plays: want.labelFirst, revealed },
            fitTo: new Set(want.fit.fitTo),
            labelled,
            size: want.fit.size,
            state: { data, layout },
            view: want.view,
          });

    cachedSceneOf({
      data,
      labelFirst: want.labelFirst,
      labelled,
      layout,
      revealed,
      view: want.view,
      zoom: want.zoom,
    });

    return fitted?.textZoom;
  });
};

const drawAsk = Effect.fnUntraced(function* (
  ask: SceneAsk,
  answer: (found: SceneAnswer) => void
) {
  const map = { ...ask, revealed: new Set(ask.revealed) };
  const routes = cachedRoutesOf(map);
  const [first, ...rest] = ask.wants;
  const fits = Arr.filter(rest, ({ fit }) => fit !== null);
  const later = Arr.filter(rest, ({ fit }) => fit === null);
  // The zooms the page may draw at: the one it draws now, and the one each
  // fit settles on.
  const zooms = new Set(Arr.map(ask.wants, ({ zoom }) => zoom));

  const send = (
    drawn: ReadonlyArray<DrawnScene>,
    fitted: boolean,
    done: boolean
  ) => {
    answer({ kind: "scene answer", ask: ask.ask, done, fitted, drawn, routes });
  };

  if (first !== undefined) {
    send(drawWant(map, first).drawn, fits.length === 0, rest.length === 0);
    yield* Effect.yieldNow;
  }

  for (const want of fits) {
    const { drawn, value: settled } = drawWant(map, want);
    const atSettled =
      settled === undefined || zooms.has(settled)
        ? []
        : drawWant(map, { ...want, fit: null, zoom: settled }).drawn;

    if (settled !== undefined) {
      zooms.add(settled);
    }

    send([...drawn, ...atSettled], true, later.length === 0);
    yield* Effect.yieldNow;
  }

  const jobs = Arr.flatMap(later, (want) =>
    Arr.map([...zooms], (zoom) => ({ ...want, zoom }))
  );

  for (const [index, want] of jobs.entries()) {
    send(drawWant(map, want).drawn, true, index === jobs.length - 1);
    yield* Effect.yieldNow;
  }
});

/** The ask being drawn, if any. */
interface Drawing {
  drawing: Fiber.Fiber<void> | undefined;
}

/**
 * Draws one ask at a time: a newer ask stops the one being drawn, between
 * two wants. The worker runs it.
 */
export const sceneDrawer = (answer: (found: SceneAnswer) => void) => {
  const held: Drawing = { drawing: undefined };

  const stop = () => {
    if (held.drawing !== undefined) {
      Effect.runFork(Fiber.interrupt(held.drawing));
      held.drawing = undefined;
    }
  };

  return {
    ask: (ask: SceneAsk) => {
      stop();
      held.drawing = Effect.runFork(drawAsk(ask, answer));
    },
    close: stop,
  };
};
