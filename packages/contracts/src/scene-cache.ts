import { Array as Arr, Order } from "effect";

import type { Layout } from "./layout.ts";
import type { MapData } from "./map-data.ts";
import { routeRevealed } from "./routing.ts";
import type { HopRoute } from "./routing.ts";
import { sceneOf } from "./scene.ts";
import type { Scene, SceneSource } from "./scene.ts";

const routeCache = new WeakMap<
  MapData,
  WeakMap<Layout, Map<string, Readonly<Record<string, HopRoute>>>>
>();

const keyOf = (revealed: ReadonlySet<string>) =>
  Arr.join(Arr.sort([...revealed], Order.String), "\n");

/**
 * Every revealed hop's route on the ground, routed around the revealed
 * structures only. Routing the same data, layout and set again returns the
 * same object, so the views and the packets share one routing pass.
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
  const byLayout =
    routeCache.get(data) ??
    new WeakMap<Layout, Map<string, Readonly<Record<string, HopRoute>>>>();

  const bySet =
    byLayout.get(layout) ??
    new Map<string, Readonly<Record<string, HopRoute>>>();

  const key = keyOf(revealed);
  const cached = bySet.get(key);

  if (cached !== undefined) {
    return cached;
  }

  const routes = routeRevealed({ data, layout, revealed });

  bySet.set(key, routes);
  byLayout.set(layout, bySet);
  routeCache.set(data, byLayout);

  return routes;
};

type Scenes = Map<string, Scene>;

/**
 * Scenes by what they're drawn from: the map data, layout, revealed set and
 * routes, then the view, zoom, label order and labelled hops. The page keeps the same
 * objects until they change, so they key a cache the garbage collector
 * clears.
 */
const sceneCache = new WeakMap<
  object,
  WeakMap<object, WeakMap<object, WeakMap<object, Scenes>>>
>();

/** `sceneOf(source)`, cached by its inputs. */
export const cachedSceneOf = (given: SceneSource): Scene => {
  const routes = given.routes ?? cachedRoutesOf(given);
  const source: SceneSource = { ...given, routes };

  const byLayout = sceneCache.get(source.data) ?? new WeakMap();
  const byRevealed = byLayout.get(source.layout) ?? new WeakMap();
  const byRoutes = byRevealed.get(source.revealed) ?? new WeakMap();
  const scenes: Scenes = byRoutes.get(routes) ?? new Map();

  sceneCache.set(source.data, byLayout);
  byLayout.set(source.layout, byRevealed);
  byRevealed.set(source.revealed, byRoutes);
  byRoutes.set(routes, scenes);

  // Hop ids are any text, so the lists are encoded whole rather than joined.
  // oxlint-disable-next-line effecttsgo/global-json -- a cache key, never decoded
  const key = JSON.stringify([
    source.view ?? "iso",
    source.zoom ?? 1,
    source.labelFirst ?? [],
    // No set labels every hop. An empty set labels none.
    source.labelled === undefined
      ? null
      : Arr.sort([...source.labelled], Order.String),
  ]);

  const cached = scenes.get(key);

  if (cached !== undefined) {
    return cached;
  }

  const made = sceneOf(source);

  scenes.set(key, made);

  return made;
};
