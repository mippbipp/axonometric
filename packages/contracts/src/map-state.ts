import { Schema } from "effect";

import { Layout } from "./layout.ts";
import { MapData } from "./map-data.ts";

/** Everything a view needs to draw a map. */
export const MapState = Schema.Struct({
  /** The name of the system the map describes. */
  system: Schema.String,
  data: MapData,
  layout: Layout,
});

export type MapState = typeof MapState.Type;

/**
 * The id of the `<script type="application/json">` element that carries the
 * map state in a read-only page.
 */
export const mapStateElementId = "axonometric-map-state";
