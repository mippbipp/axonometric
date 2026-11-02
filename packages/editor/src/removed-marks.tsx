import {
  groundOutline,
  groundProjections,
  toPoints,
} from "@axonometric/contracts";
import type { SceneStructure, View } from "@axonometric/contracts";
import { Array as Arr } from "effect";

import { useProposed } from "./proposed-context.ts";

/**
 * A structure proposed for deletion, crossed out until the agent has reviewed
 * it: the footprint's outline in the refused colour, and a line along each of
 * its diagonals. It draws no text, so it can't clash with a name tag or a
 * label, and sits under the structures so the box stays readable through it.
 *
 * This is an editing layer: a file's drawing never includes it.
 */
export function RemovedMarks({
  structures,
  view,
}: {
  readonly structures: readonly SceneStructure[];
  readonly view: View;
}) {
  const removes = useProposed()?.proposed.removes;

  if (removes === undefined || removes.size === 0) {
    return null;
  }

  const ground = groundProjections[view];

  return (
    <g aria-hidden="true" className="pointer-events-none">
      {Arr.flatMap(structures, ({ structure, placement }) => {
        if (!removes.has(structure.id)) {
          return [];
        }

        const outline = groundOutline(placement, ground);
        const [a, b, c, e] = outline;

        if (
          a === undefined ||
          b === undefined ||
          c === undefined ||
          e === undefined
        ) {
          return [];
        }

        return [
          <g
            key={structure.id}
            data-removed-mark={structure.id}
            className="stroke-refused fill-none"
            strokeWidth={2.2}
            strokeLinecap="round"
          >
            <polygon points={toPoints(outline)} fill="none" />
            <line data-strike="" x1={a.sx} y1={a.sy} x2={c.sx} y2={c.sy} />
            <line data-strike="" x1={b.sx} y1={b.sy} x2={e.sx} y2={e.sy} />
          </g>,
        ];
      })}
    </g>
  );
}
