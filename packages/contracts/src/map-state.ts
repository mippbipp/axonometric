import { Schema } from "effect";

import { Layout } from "./layout.ts";
import { MapData } from "./map-data.ts";
import { Proposals } from "./proposals.ts";

/** Everything a view needs to draw a map. */
export const MapState = Schema.Struct({
  /** The name of the system the map describes. */
  system: Schema.String,
  data: MapData,
  layout: Layout,
  /**
   * The web address of each structure's sources, keyed by `sourceKey`. A
   * source with no entry shows as a plain path.
   */
  sourceLinks: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  /**
   * What's pending, as `proposals.json` holds it. Only a page that `serve`
   * serves has it: the read-only file shows the accepted layout alone.
   */
  proposals: Schema.optionalKey(Proposals),
});

export type MapState = typeof MapState.Type;

/**
 * The id of the `<script type="application/json">` element that carries the
 * map state in a read-only page.
 */
export const mapStateElementId = "axonometric-map-state";
