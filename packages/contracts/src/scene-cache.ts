import { Array as Arr, Order } from "effect";

import type { Layout } from "./layout.ts";
import type { MapData } from "./map-data.ts";
import { routeRevealed } from "./routing.ts";
import type { HopRoute } from "./routing.ts";
import { sceneOf } from "./scene.ts";
import type { Scene, SceneSource } from "./scene.ts";

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

const routeCache = remembered<Readonly<Record<string, HopRoute>>>(64);

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
  const key = `${contentKeyOf(data)} ${contentKeyOf(layout)} ${setKeyOf(revealed)}`;
  const cached = routeCache.get(key);

  if (cached !== undefined) {
    return cached;
  }

  const routes = routeRevealed({ data, layout, revealed });

  routeCache.set(key, routes);

  return routes;
};

const sceneCache = remembered<Scene>(64);

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
 * `sceneOf(source)`, cached by what its inputs hold: the map data, layout,
 * revealed set and routes, then the view, zoom, label order and labelled
 * hops.
 */
export const cachedSceneOf = (given: SceneSource): Scene => {
  const routes = given.routes ?? cachedRoutesOf(given);
  const source = { ...given, routes };
  const key = sceneKeyOf(source);
  const cached = sceneCache.get(key);

  if (cached !== undefined) {
    return cached;
  }

  const made = sceneOf(source);

  sceneCache.set(key, made);

  return made;
};
