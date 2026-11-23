import { Array as Arr, Order } from "effect";
import { dual } from "effect/Function";

import type { Layout } from "./layout.ts";
import type { MapData } from "./map-data.ts";
import type { View } from "./plan.ts";
import { routeRevealed } from "./routing.ts";
import type { HopRoute } from "./routing.ts";
import { sceneClashes, sceneOf, tagScene } from "./scene.ts";
import type { Scene, SceneClash, SceneSource } from "./scene.ts";

/** A map that forgets the entry used longest ago once it holds `size`. */
const remembered = <V>(size: number) => {
  const entries = new Map<string, V>();

  return {
    get: (key: string) => {
      const found = entries.get(key);

      if (found !== undefined) {
        entries.delete(key);
        entries.set(key, found);
      }

      return found;
    },
    set: (key: string, value: V) => {
      entries.delete(key);
      entries.set(key, value);

      if (entries.size > size) {
        const [oldest] = entries.keys();

        if (oldest !== undefined) {
          entries.delete(oldest);
        }
      }
    },
  };
};

/** What a scene is drawn from that the cache keys by content. */
type Drawn = Layout | MapData | Readonly<Record<string, HopRoute>>;

/** Each object's JSON, worked out once per object. */
const jsonOf = new WeakMap<Drawn, string>();

/** A short number for each JSON text seen lately, so keys stay small. */
const contentIds = remembered<number>(128);

const nextId = { value: 0 };

/**
 * A key that is the same for two objects with the same content. The page
 * builds a new map object for every update, often with nothing in it changed,
 * so the caches below go by what the objects hold.
 */
const contentKeyOf = (value: Drawn): string => {
  const known = jsonOf.get(value);
  // oxlint-disable-next-line effecttsgo/global-json -- a cache key, never decoded
  const json = known ?? JSON.stringify(value);

  if (known === undefined) {
    jsonOf.set(value, json);
  }

  const id = contentIds.get(json) ?? (nextId.value += 1);

  contentIds.set(json, id);

  return String(id);
};

/** The sorted ids of a set, encoded whole, since an id can hold any text. */
const setKeyOf = (ids: ReadonlySet<string>) =>
  // oxlint-disable-next-line effecttsgo/global-json -- a cache key, never decoded
  JSON.stringify(Arr.sort([...ids], Order.String));

/** Whether two maps, or two layouts, hold the same, in the same objects or not. */
export const sameContent: {
  <A extends Layout | MapData>(second: A): (first: A) => boolean;
  <A extends Layout | MapData>(first: A, second: A): boolean;
} = dual(
  2,
  <A extends Layout | MapData>(first: A, second: A): boolean =>
    first === second || contentKeyOf(first) === contentKeyOf(second)
);

const routeCache = remembered<Readonly<Record<string, HopRoute>>>(64);

const routeKeyOf = ({
  data,
  layout,
  revealed,
}: Pick<SceneSource, "data" | "layout" | "revealed">) =>
  `${contentKeyOf(data)} ${contentKeyOf(layout)} ${setKeyOf(revealed)}`;

/**
 * Every revealed hop's route on the ground, routed around the revealed
 * structures only. Routing the same data, layout and set again, in these
 * objects or in others that hold the same, returns the same object, so the
 * views and the packets share one routing pass.
 */
export const cachedRoutesOf = ({
  data,
  layout,
  revealed,
}: {
  readonly data: MapData;
  readonly layout: Layout;
  readonly revealed: ReadonlySet<string>;
}): Readonly<Record<string, HopRoute>> => {
  const key = routeKeyOf({ data, layout, revealed });
  const cached = routeCache.get(key);

  if (cached !== undefined) {
    return cached;
  }

  const routes = routeRevealed({ data, layout, revealed });

  routeCache.set(key, routes);

  return routes;
};

const sceneCache = remembered<Scene>(64);

const clashCache = remembered<ReadonlyArray<string>>(64);

/** The key `cachedSceneOf` keeps `source`'s scene under. */
const sceneKeyOf = (
  source: SceneSource & { readonly routes: Readonly<Record<string, HopRoute>> }
) =>
  // oxlint-disable-next-line effecttsgo/global-json -- a cache key, never decoded
  JSON.stringify([
    contentKeyOf(source.data),
    contentKeyOf(source.layout),
    contentKeyOf(source.routes),
    setKeyOf(source.revealed),
    source.view ?? "iso",
    source.zoom ?? 1,
    source.labelFirst ?? [],
    // No set labels every hop. An empty set labels none.
    source.labelled === undefined ? null : setKeyOf(source.labelled),
  ]);

/**
 * A scene or a scene's name tag clashes, with what it was drawn from besides
 * the map and its routes.
 */
export type DrawnScene = {
  readonly labelFirst: ReadonlyArray<string> | undefined;
  readonly labelled: ReadonlyArray<string> | undefined;
  readonly view: View | undefined;
  readonly zoom: number | undefined;
} & (
  | { readonly kind: "scene"; readonly scene: Scene }
  | { readonly clashes: ReadonlyArray<string>; readonly kind: "tag clashes" }
);

/** What a `scenesDrawnBy` call returns. */
export interface ScenesDrawn<A> {
  readonly drawn: ReadonlyArray<DrawnScene>;
  readonly value: A;
}

/** Every scene asked for while a `scenesDrawnBy` call runs. */
const recording: Array<Array<DrawnScene>> = [];

const recordDrawn = (
  source: SceneSource,
  drawn:
    | { readonly kind: "scene"; readonly scene: Scene }
    | { readonly clashes: ReadonlyArray<string>; readonly kind: "tag clashes" }
) => {
  for (const kept of recording) {
    kept.push({
      ...drawn,
      labelFirst: source.labelFirst,
      labelled:
        source.labelled === undefined ? undefined : [...source.labelled],
      view: source.view,
      zoom: source.zoom,
    });
  }
};

/**
 * What `draw` returns, with every scene it asked `cachedSceneOf` for, so a
 * worker can hand the page the scenes a fit tries.
 */
export const scenesDrawnBy = <A>(draw: () => A): ScenesDrawn<A> => {
  const drawn: Array<DrawnScene> = [];

  recording.push(drawn);

  try {
    return { drawn, value: draw() };
  } finally {
    recording.pop();
  }
};

/**
 * Keeps routes and scenes drawn elsewhere, such as in a worker, for the map
 * they were drawn from, so `cachedSceneOf` returns them as if it had drawn
 * them.
 */
export const rememberScenes = ({
  data,
  drawn,
  layout,
  revealed,
  routes,
}: Pick<SceneSource, "data" | "layout" | "revealed"> & {
  readonly drawn: ReadonlyArray<DrawnScene>;
  readonly routes: Readonly<Record<string, HopRoute>>;
}) => {
  routeCache.set(routeKeyOf({ data, layout, revealed }), routes);

  for (const item of drawn) {
    const key = sceneKeyOf({
      data,
      labelFirst: item.labelFirst,
      labelled:
        item.labelled === undefined ? undefined : new Set(item.labelled),
      layout,
      revealed,
      routes,
      view: item.view,
      zoom: item.zoom,
    });

    if (item.kind === "scene") {
      sceneCache.set(key, item.scene);
    } else {
      clashCache.set(key, item.clashes);
    }
  }
};

/**
 * The scene `cachedSceneOf(source)` would return, when it has it already, or
 * `undefined`. It never routes or draws.
 */
export const knownSceneOf = (given: SceneSource): Scene | undefined => {
  const routes = given.routes ?? routeCache.get(routeKeyOf(given));

  return routes === undefined
    ? undefined
    : sceneCache.get(sceneKeyOf({ ...given, routes }));
};

/**
 * `sceneOf(source)`, cached by what its inputs hold: the map data, layout,
 * revealed set and routes, then the view, zoom, label order and labelled
 * hops.
 */
export const cachedSceneOf = (given: SceneSource): Scene => {
  const routes = given.routes ?? cachedRoutesOf(given);
  const source = { ...given, routes };
  const key = sceneKeyOf(source);
  const cached = sceneCache.get(key);

  const made = cached ?? sceneOf(source);

  sceneCache.set(key, made);

  recordDrawn(source, { kind: "scene", scene: made });

  return made;
};

/** Whether a clash puts a name tag over another tag or over a box. */
const tagClash = ({ parts: [first, second] }: SceneClash) =>
  (first.kind === "tag" && (second.kind === "tag" || second.kind === "box")) ||
  (first.kind === "box" && second.kind === "tag");

/** The name tag clashes in a bare scene (see `tagScene`), as `between` keys. */
const tagClashesOf = (source: SceneSource): ReadonlyArray<string> => {
  const clashes = Arr.filter(sceneClashes(tagScene(source)), tagClash);

  return Arr.map(clashes, ({ between }) => Arr.join(between, " × "));
};

/**
 * The name tag clashes of `source`'s bare scene, as `between` keys, cached as
 * `cachedSceneOf` caches scenes. Zoom to fit asks for them at each zoom it
 * tries.
 */
export const cachedTagClashesOf = (
  given: SceneSource
): ReadonlyArray<string> => {
  const routes = given.routes ?? cachedRoutesOf(given);
  const source = { ...given, routes };
  const key = sceneKeyOf(source);
  const made = clashCache.get(key) ?? tagClashesOf(source);

  clashCache.set(key, made);
  recordDrawn(source, { clashes: made, kind: "tag clashes" });

  return made;
};
