import { placeStructures } from "@axonometric/contracts";
import type { MapData } from "@axonometric/contracts";
import { Array as Arr, Effect, Path, Schema } from "effect";
import { CliError } from "effect/cli";

import { loadMap } from "./map-files.ts";

/** A `verdict` or `commit` the batch can't take. Nothing was written. */
export class ReviewRefused extends Schema.TaggedError<
  ReviewRefused,
  { readonly brand: unique symbol }
>()("ReviewRefused", { command: Schema.String, reason: Schema.String }) {
  public override get [CliError.userMessage]() {
    return `${this.reason} ${this.command} wrote nothing.`;
  }
}

/** The names of the map's structures, by id. */
export const structureNames = (data: MapData): ReadonlyMap<string, string> =>
  new Map(Arr.map(data.structures, ({ id, name }) => [id, name]));

/**
 * Loads the map in `home` the way every review command and write needs it:
 * structures placed, `proposals.json` checked strictly. Fails with
 * `MapInvalid` naming `command` when the map has an error. The caller holds
 * the lock.
 */
export const loadReviewMap = Effect.fnUntraced(function* (
  home: string,
  command: string
) {
  const path = yield* Path.Path;

  return yield* loadMap({
    home,
    output: path.dirname(home),
    command,
    arrange: (data, saved) => placeStructures(data, saved).layout,
    strictProposals: true,
  });
});
