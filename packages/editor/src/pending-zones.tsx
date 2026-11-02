import { marked, groupMark, toPoints } from "@axonometric/contracts";
import type { SceneZone } from "@axonometric/contracts";
import { Array as Arr } from "effect";

import { useProposed } from "./proposed-context.ts";

/**
 * A zone of a group the engineer has proposed or renamed, in the pending look:
 * the plate's outline in the pending colour, dashed, with a faint tint. It
 * follows the plate, so it is right in both views, and it draws no text: the
 * zone's title is the one the scene already placed.
 *
 * This is an editing layer: a file's drawing never includes it.
 */
export function PendingZones({
  zones,
}: {
  readonly zones: readonly SceneZone[];
}) {
  const proposed = useProposed()?.proposed;

  const pending =
    proposed === undefined ? undefined : marked(proposed, groupMark);

  if (pending === undefined || pending.size === 0) {
    return null;
  }

  return (
    <g aria-hidden="true" className="pointer-events-none">
      {Arr.flatMap(zones, ({ zone, plate }) =>
        pending.has(zone.group.id)
          ? [
              <polygon
                key={zone.group.id}
                data-pending-zone={zone.group.id}
                points={toPoints(plate)}
                className="stroke-pending fill-pending/10"
                strokeWidth={1.6}
                strokeDasharray="6 4"
              />,
            ]
          : []
      )}
    </g>
  );
}
