import { Array as Arr, Option } from "effect";

import { drawnRoutes } from "./fans.ts";
import { rectPolygon, segmentsOf } from "./geometry.ts";
import type { Segment } from "./geometry.ts";
import type { ScreenPoint } from "./iso.ts";
import type { GridPoint, Layout } from "./layout.ts";
import type { MapData } from "./map-data.ts";
import { gapAt } from "./note-markers.ts";
import { groundProjections } from "./plan.ts";
import type { View } from "./plan.ts";
import { routeRevealed } from "./routing.ts";
import { sceneFactsOf } from "./scene-facts.ts";
import type { Scene } from "./scene.ts";
import { grown, outsideHoles } from "./strike.ts";

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

/**
 * The pieces of the hop preview `line` that lie clear of text in `scene`: the
 * line is cut where it meets a name tag, code chip or hop label, and keeps
 * `gapAt(zoom)` from each. The scene placed no text around a hop that does
 * not exist yet, so the cut is made here.
 */
export const previewPieces = ({
  line,
  scene,
}: {
  readonly line: ReadonlyArray<ScreenPoint>;
  readonly scene: Scene;
}): ReadonlyArray<Segment> => {
  const { texts, zoom } = sceneFactsOf(scene);
  const gap = gapAt(zoom);
  const holes = Arr.map(texts, (rect) => rectPolygon(grown(rect, gap)));

  return Arr.flatMap(segmentsOf(line), (segment) =>
    outsideHoles(segment, holes, 1)
  );
};
