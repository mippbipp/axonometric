import type { Placement } from "@axonometric/contracts";

import { project, toPoints } from "./iso.ts";
import { useSelection } from "./selection-context.ts";

/** How far the outline reaches past the footprint, in grid units. */
const pad = 0.35;

/**
 * A solid outline on the ground around the selected structure's footprint,
 * drawn under the structures.
 */
export function SelectionMarker({
  placements,
}: {
  readonly placements: Readonly<Partial<Record<string, Placement>>>;
}) {
  const { selected } = useSelection();
  const placement = selected === null ? undefined : placements[selected];

  if (selected === null || placement === undefined) {
    return null;
  }

  const x = placement.x - pad;
  const y = placement.y - pad;
  const w = placement.w + pad * 2;
  const d = placement.d + pad * 2;

  return (
    <polygon
      data-selection-marker={selected}
      points={toPoints([
        project({ x, y }),
        project({ x: x + w, y }),
        project({ x: x + w, y: y + d }),
        project({ x, y: y + d }),
      ])}
      className="fill-ink/15 stroke-ink pointer-events-none"
      strokeWidth={2}
    />
  );
}
