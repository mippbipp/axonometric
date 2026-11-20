import {
  drawnRoutes,
  groundProjections,
  routeRevealed,
} from "@axonometric/contracts";
import type {
  GridPoint,
  Layout,
  MapData,
  ScreenPoint,
  View,
} from "@axonometric/contracts";
import { Array as Arr, Option } from "effect";

/** The id the preview's probe hop is routed under; no real hop has it. */
const probeId = "__hop-preview__";

/**
 * The line a hop from `from` to `to` would be drawn along, in `view`, if it
 * were proposed now: routed with the router every hop goes through, around
 * the revealed structures and in its own lane beside the hops the map has.
 * Nothing when either end isn't placed or revealed, or the router finds no
 * route.
 */
export const previewRoute = ({
  data,
  from,
  layout,
  revealed,
  to,
  view,
}: {
  readonly data: MapData;
  readonly from: string;
  readonly layout: Layout;
  readonly revealed: ReadonlySet<string>;
  readonly to: string;
  readonly view: View;
}): Option.Option<ReadonlyArray<ScreenPoint>> => {
  const probe = { from, id: probeId, label: probeId, to };
  const withProbe: MapData = { ...data, hops: [...data.hops, probe] };
  const routes = routeRevealed({ data: withProbe, layout, revealed });
  const route = routes[probeId];

  if (route === undefined) {
    return Option.none();
  }

  const shown = Arr.filter(
    withProbe.hops,
    (hop) => routes[hop.id] !== undefined
  );

  const lines = drawnRoutes({
    hops: shown,
    placements: layout.structures,
    routes,
    view,
  });

  return Option.map(Option.fromNullishOr(lines[probeId]), (line) =>
    Arr.map(line, groundProjections[view].toScreen)
  );
};

/** A straight line from `start` to `end`, for a pointer over empty space. */
export const straightLine = ({
  end,
  start,
  view,
}: {
  readonly end: GridPoint;
  readonly start: ScreenPoint;
  readonly view: View;
}): ReadonlyArray<ScreenPoint> => [
  start,
  groundProjections[view].toScreen(end),
];
