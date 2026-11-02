import { groundProjections } from "@axonometric/contracts";
import type { SceneStructure, View } from "@axonometric/contracts";
import { Array as Arr } from "effect";

import { pendingStructures, useEditing } from "./editing-context.ts";
import { groundOutline, toPoints } from "./projection.ts";

/**
 * A faint dashed outline on the ground where the accepted layout puts each
 * structure with a pending change, drawn under the structures.
 */
export function AcceptedOutlines({
  structures,
  view,
}: {
  readonly structures: readonly SceneStructure[];
  readonly view: View;
}) {
  const editing = useEditing();

  if (editing === null) {
    return null;
  }

  const changed = pendingStructures(editing);

  return (
    <g aria-hidden="true" className="pointer-events-none">
      {Arr.flatMap(structures, ({ structure }) => {
        const accepted = editing.accepted.structures[structure.id];

        return accepted === undefined || !changed.has(structure.id)
          ? []
          : [
              <polygon
                key={structure.id}
                data-accepted-outline={structure.id}
                points={toPoints(
                  groundOutline(accepted, groundProjections[view])
                )}
                className="stroke-pending fill-none opacity-50"
                strokeWidth={1.2}
                strokeDasharray="3 3"
              />,
            ];
      })}
    </g>
  );
}
