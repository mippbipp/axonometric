import { sceneOf } from "@axonometric/contracts";
import type { Scene, SceneSource } from "@axonometric/contracts";
import { Array as Arr } from "effect";

/** Stands in for routes a caller leaves to `sceneOf`. */
const defaultRoutes = {};

type Scenes = Map<string, Scene>;

/**
 * Scenes by what they're drawn from: the map data, layout, revealed set and
 * routes, then the view, zoom and label order. The page keeps the same
 * objects until they change, so they key a cache the garbage collector
 * clears.
 */
const sceneCache = new WeakMap<
  object,
  WeakMap<object, WeakMap<object, WeakMap<object, Scenes>>>
>();

/** `sceneOf(source)`, cached by its inputs. */
export const cachedSceneOf = (source: SceneSource): Scene => {
  const byLayout = sceneCache.get(source.data) ?? new WeakMap();
  const byRevealed = byLayout.get(source.layout) ?? new WeakMap();
  const byRoutes = byRevealed.get(source.revealed) ?? new WeakMap();
  const routes = source.routes ?? defaultRoutes;
  const scenes: Scenes = byRoutes.get(routes) ?? new Map();

  sceneCache.set(source.data, byLayout);
  byLayout.set(source.layout, byRevealed);
  byRevealed.set(source.revealed, byRoutes);
  byRoutes.set(routes, scenes);

  const key = Arr.join(
    [
      source.view ?? "iso",
      String(source.zoom ?? 1),
      Arr.join(source.labelFirst ?? [], ","),
    ],
    "|"
  );

  const cached = scenes.get(key);

  if (cached !== undefined) {
    return cached;
  }

  const made = sceneOf(source);

  scenes.set(key, made);

  return made;
};
