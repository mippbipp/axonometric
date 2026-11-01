import { groundProjections } from "@axonometric/contracts";
import type { Placement, View } from "@axonometric/contracts";
import { Array as Arr } from "effect";

import { groundOutline, toPoints } from "./projection.ts";
import { useSelection } from "./selection-context.ts";

/** How far the outline reaches past the footprint, in grid units. */
const pad = 0.35;

const outlineOf = (placement: Placement) => ({
  x: placement.x - pad,
  y: placement.y - pad,
  w: placement.w + pad * 2,
  d: placement.d + pad * 2,
});

/**
 * A solid outline on the ground around the selected structure's footprint,
 * and a solid one in the multi-selection colour around each structure in the
 * multi-selection, drawn under the structures.
 */
export function SelectionMarker({
  placements,
  view,
}: {
  readonly placements: Readonly<Partial<Record<string, Placement>>>;
  readonly view: View;
}) {
  const { selected, multiSelection } = useSelection();
  const placement = selected === null ? undefined : placements[selected];
  const ground = groundProjections[view];

  return (
    <>
      {selected === null || placement === undefined ? null : (
        <polygon
          data-selection-marker={selected}
          points={toPoints(groundOutline(outlineOf(placement), ground))}
          className="fill-ink/15 stroke-ink pointer-events-none"
          strokeWidth={2}
        />
      )}
      {Arr.flatMap([...multiSelection], (id) => {
        const at = placements[id];

        return at === undefined
          ? []
          : [
              <polygon
                key={id}
                data-multi-selection-marker={id}
                points={toPoints(groundOutline(outlineOf(at), ground))}
                className="fill-multi/15 stroke-multi pointer-events-none"
                strokeWidth={2.5}
              />,
            ];
      })}
    </>
  );
}
