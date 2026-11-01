import { project, routeHops } from "@axonometric/contracts";
import type {
  HopRoute,
  Layout,
  MapData,
  ScreenPoint,
} from "@axonometric/contracts";
import { Array as Arr } from "effect";

export {
  corners,
  project,
  tileHeight,
  tileWidth,
} from "@axonometric/contracts";

export type { Corners, ScreenPoint } from "@axonometric/contracts";

/** Formats screen points for an SVG `points` attribute. */
export const toPoints = (points: readonly ScreenPoint[]) =>
  Arr.join(
    Arr.map(points, (point) => `${point.sx},${point.sy}`),
    " "
  );

const routeCache = new WeakMap<
  MapData,
  WeakMap<Layout, Readonly<Record<string, HopRoute>>>
>();

/**
 * Every hop's route on the ground, from the contracts router. Routing the
 * same data and layout again returns the same object, so the iso view and
 * the packets share one routing pass.
 */
export const routesOf = ({
  data,
  layout,
}: {
  readonly data: MapData;
  readonly layout: Layout;
}): Readonly<Record<string, HopRoute>> => {
  const byLayout =
    routeCache.get(data) ??
    new WeakMap<Layout, Readonly<Record<string, HopRoute>>>();

  const cached = byLayout.get(layout);

  if (cached !== undefined) {
    return cached;
  }

  const routes = routeHops(data, layout);

  byLayout.set(layout, routes);
  routeCache.set(data, byLayout);

  return routes;
};

/**
 * A hop's route on screen, or `undefined` when it has none, such as when
 * either end has no placement. Packets walk along these points.
 */
export const screenRouteOf = ({
  data,
  layout,
  hop,
}: {
  readonly data: MapData;
  readonly layout: Layout;
  readonly hop: { readonly id: string };
}): readonly ScreenPoint[] | undefined => {
  const route = routesOf({ data, layout })[hop.id];

  return route === undefined ? undefined : Arr.map(route.points, project);
};

/**
 * The point a share `t` of the way along a polyline, by length. `t` runs from
 * 0 at the first point to 1 at the last.
 */
export const pointAlong = ({
  points,
  t,
}: {
  readonly points: readonly ScreenPoint[];
  readonly t: number;
}): ScreenPoint => {
  const legs = Arr.flatMap(points, (point, index) => {
    const next = points[index + 1];

    return next === undefined
      ? []
      : [
          {
            start: point,
            end: next,
            length: Math.hypot(next.sx - point.sx, next.sy - point.sy),
          },
        ];
  });

  const total = Arr.reduce(legs, 0, (sum, leg) => sum + leg.length);
  let left = Math.max(0, Math.min(1, t)) * total;

  for (const leg of legs) {
    if (left <= leg.length && leg.length > 0) {
      const share = left / leg.length;

      return {
        sx: leg.start.sx + (leg.end.sx - leg.start.sx) * share,
        sy: leg.start.sy + (leg.end.sy - leg.start.sy) * share,
      };
    }

    left -= leg.length;
  }

  return points.at(-1) ?? { sx: 0, sy: 0 };
};
