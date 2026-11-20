import {
  groundOutline,
  groundProjections,
  marked,
  removedMark,
  strikeSegments,
  toPoints,
} from "@axonometric/contracts";
import type { SceneStructure, View } from "@axonometric/contracts";
import { Array as Arr } from "effect";

import { useProposedMapIgnoringEdit } from "./proposed-context.ts";

/**
 * A structure proposed for deletion, crossed out until the agent has reviewed
 * it: the footprint's outline in the refused colour, and a line along each of
 * its diagonals. The diagonals stop short of the structure's code chip and
 * name tag, so the cross never runs over text. It draws no text of its own.
 * It sits over the structure, in the overlay, so the box's faces don't hide
 * it, and under the text in painting order only by leaving the text's room
 * free.
 *
 * This is an editing layer: a file's drawing never includes it.
 */
export function RemovedMarks({
  structures,
  view,
}: {
  readonly structures: ReadonlyArray<SceneStructure>;
  readonly view: View;
}) {
  const proposed = useProposedMapIgnoringEdit();

  const removes =
    proposed === undefined ? undefined : marked(proposed, removedMark);

  if (removes === undefined || removes.size === 0) {
    return null;
  }

  const ground = groundProjections[view];

  return (
    <g aria-hidden="true" className="pointer-events-none">
      {Arr.flatMap(structures, ({ chip, placement, structure, tag }) => {
        if (!removes.has(structure.id)) {
          return [];
        }

        const strikes = strikeSegments({
          ground,
          placement,
          text: [chip, tag],
        });

        return [
          <g
            className="stroke-refused fill-none"
            data-removed-mark={structure.id}
            key={structure.id}
            strokeLinecap="butt"
            strokeWidth={2.2}
          >
            <polygon
              fill="none"
              points={toPoints(groundOutline(placement, ground))}
            />
            {Arr.map(strikes, ({ end, start }) => (
              <line
                data-strike=""
                key={`${start.sx},${start.sy},${end.sx},${end.sy}`}
                x1={start.sx}
                x2={end.sx}
                y1={start.sy}
                y2={end.sy}
              />
            ))}
          </g>,
        ];
      })}
    </g>
  );
}
