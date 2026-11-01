import { groundProjections } from "@axonometric/contracts";
import type { Placement, View } from "@axonometric/contracts";

import { groundOutline, toPoints } from "./iso.ts";
import { useSelection } from "./selection-context.ts";

/** How far the outline reaches past the footprint, in grid units. */
const pad = 0.35;

/**
 * A solid outline on the ground around the selected structure's footprint,
 * drawn under the structures.
 */
export function SelectionMarker({
  placements,
  view,
}: {
  readonly placements: Readonly<Partial<Record<string, Placement>>>;
  readonly view: View;
}) {
  const { selected } = useSelection();
  const placement = selected === null ? undefined : placements[selected];

  if (selected === null || placement === undefined) {
    return null;
  }

  const grown = {
    x: placement.x - pad,
    y: placement.y - pad,
    w: placement.w + pad * 2,
    d: placement.d + pad * 2,
  };

  return (
    <polygon
      data-selection-marker={selected}
      points={toPoints(groundOutline(grown, groundProjections[view]))}
      className="fill-ink/15 stroke-ink pointer-events-none"
      strokeWidth={2}
    />
  );
}
