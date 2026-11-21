import {
  marked,
  proposedHopMark,
  removedHopMark,
} from "@axonometric/contracts";
import type { Hop } from "@axonometric/contracts";

import { useProposedHopsIgnoringEdit } from "./connections-context.ts";
import { useStructuresById } from "./structures.ts";
import { useWalkthrough } from "./walkthrough-context.ts";

const none: ReadonlySet<string> = new Set();

const endOf = ({
  end,
  hop,
  name,
  proposed,
  removed,
}: {
  readonly end: string;
  readonly hop: Hop;
  readonly name: (id: string) => string;
  readonly proposed: ReadonlySet<string>;
  readonly removed: ReadonlySet<string>;
}) => {
  const mark = removed.has(hop.id)
    ? ", proposed for deletion"
    : proposed.has(hop.id)
      ? ", proposed"
      : "";

  return `${name(end)}, "${hop.label}"${mark}`;
};

/**
 * What a screen reader hears about structure `id`'s hops: those to and from
 * it whose other end is revealed, as in `Hops to Server, "asks for a map";
 * Proposals, "looks at". Hops from Page, "pins a note".` `proposed` and
 * `removed` are the hops the open proposals draw and delete. `undefined`
 * when it has none.
 */
export const hopsDescriptionOf = ({
  hops,
  id,
  name,
  proposed,
  removed,
  revealed,
}: {
  readonly hops: ReadonlyArray<Hop>;
  readonly id: string;
  readonly name: (id: string) => string;
  readonly proposed: ReadonlySet<string>;
  readonly removed: ReadonlySet<string>;
  readonly revealed: ReadonlySet<string>;
}): string | undefined => {
  const ends = (side: "from" | "to") => {
    const other = side === "from" ? "to" : "from";

    return hops
      .filter(
        (hop) =>
          hop[side] === id && hop[other] !== id && revealed.has(hop[other])
      )
      .map((hop) => endOf({ end: hop[other], hop, name, proposed, removed }));
  };

  const to = ends("from");
  const from = ends("to");

  const sentences = [
    ...(to.length > 0 ? [`Hops to ${to.join("; ")}.`] : []),
    ...(from.length > 0 ? [`Hops from ${from.join("; ")}.`] : []),
  ];

  return sentences.length > 0 ? sentences.join(" ") : undefined;
};

/** `hopsDescriptionOf` structure `id` on the map as shown. */
export const useHopsDescription = (id: string): string | undefined => {
  const { revealed, state } = useWalkthrough();
  const byId = useStructuresById();
  const proposed = useProposedHopsIgnoringEdit();

  return hopsDescriptionOf({
    hops: state.data.hops,
    id,
    name: (other) => byId.get(other)?.name ?? other,
    proposed: proposed === undefined ? none : marked(proposed, proposedHopMark),
    removed: proposed === undefined ? none : marked(proposed, removedHopMark),
    revealed,
  });
};
