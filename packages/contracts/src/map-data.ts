import { Array as Arr, Schema } from "effect";

import {
  fileVersionFields,
  objectMessages,
  requiredList,
  requiredText,
} from "./fields.ts";

export const Structure = Schema.Struct({
  id: requiredText("Give every structure an id."),
  name: requiredText("Give every structure a name."),
}).annotate(
  objectMessages(
    "A structure has only id and name. Positions and sizes go in layout.json."
  )
);

export type Structure = typeof Structure.Type;

export const Hop = Schema.Struct({
  id: requiredText("Give every hop an id."),
  from: requiredText("Set from to the id of the structure the hop starts at."),
  to: requiredText("Set to to the id of the structure the hop ends at."),
  label: requiredText("Give every hop a short label."),
  /** An example of what the hop carries. Any JSON value. */
  payload: Schema.optionalKey(Schema.Json),
}).annotate(objectMessages("A hop has only id, from, to, label and payload."));

export type Hop = typeof Hop.Type;

/** The indexes of items whose id an earlier item already uses. */
const repeatedIds = (items: readonly { readonly id: string }[]) => {
  const seen = new Set<string>();

  return Arr.flatMap(items, (item, index) => {
    const repeated = seen.has(item.id);

    seen.add(item.id);

    return repeated ? [index] : [];
  });
};

/**
 * The default export of `data.mjs`: the map's meaning. It holds no positions
 * or sizes; those live in `layout.json`.
 */
export const MapData = Schema.Struct({
  ...fileVersionFields,
  structures: Schema.Array(Structure).pipe(
    requiredList("List the map's structures in an array.")
  ),
  hops: Schema.Array(Hop).pipe(
    requiredList("List the map's hops in an array.")
  ),
})
  .annotate(
    objectMessages(
      "A map has only format, revision, structures and hops. Positions and sizes go in layout.json."
    )
  )
  .check(
    Schema.makeFilter((data) => {
      const ids = new Set(
        Arr.map(data.structures, (structure) => structure.id)
      );

      const repeatedStructures = Arr.map(
        repeatedIds(data.structures),
        (index) => ({
          path: ["structures", index, "id"],
          issue: `another structure already uses "${data.structures[index]?.id}". Give each structure its own id.`,
        })
      );

      const repeatedHops = Arr.map(repeatedIds(data.hops), (index) => ({
        path: ["hops", index, "id"],
        issue: `another hop already uses "${data.hops[index]?.id}". Give each hop its own id.`,
      }));

      const unknownEnds = Arr.flatMap(data.hops, (hop, index) =>
        Arr.flatMap(["from", "to"] as const, (end) =>
          ids.has(hop[end])
            ? []
            : [
                {
                  path: ["hops", index, end],
                  issue: `no structure has the id "${hop[end]}". Use the id of one of the structures.`,
                },
              ]
        )
      );

      return [...repeatedStructures, ...repeatedHops, ...unknownEnds];
    })
  );

export type MapData = typeof MapData.Type;
