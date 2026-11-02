import { groupMark, marked, textBoxesOf } from "@axonometric/contracts";
import type { Scene } from "@axonometric/contracts";
import { Array as Arr } from "effect";
import { useMemo } from "react";

import { OutlineLines } from "./outline-paths.tsx";
import { useProposed } from "./proposed-context.ts";

/**
 * A zone of a group the engineer has proposed or renamed, in the pending look:
 * the plate's outline in the pending colour, dashed, as separate lines that
 * stop short of the scene's text. It follows the plate, so it is right in both
 * views, and it draws no text: the zone's title is the one the scene already
 * placed, and the outline has a gap round it and round every tag, chip and
 * label.
 *
 * This is an editing layer: a file's drawing never includes it.
 */
export function PendingZones({ scene }: { readonly scene: Scene }) {
  const proposed = useProposed()?.proposed;
  const text = useMemo(() => textBoxesOf(scene), [scene]);

  const pending =
    proposed === undefined ? undefined : marked(proposed, { name: groupMark });

  if (pending === undefined || pending.size === 0) {
    return null;
  }

  return (
    <g aria-hidden="true" className="pointer-events-none">
      {Arr.flatMap(scene.zones, ({ zone, plate }) =>
        pending.has(zone.group.id)
          ? [
              <OutlineLines
                key={zone.group.id}
                id={zone.group.id}
                points={plate}
                text={text}
                closed
                className="stroke-pending"
                width={1.6}
                dash="6 4"
                mark={{ "data-pending-zone": zone.group.id }}
              />,
            ]
          : []
      )}
    </g>
  );
}
