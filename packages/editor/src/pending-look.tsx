import { groundProjections } from "@axonometric/contracts";
import type { SceneStructure, View } from "@axonometric/contracts";
import { Array as Arr } from "effect";

import {
  pendingStructures,
  useEditingIgnoringEdit,
} from "./editing-context.ts";
import { groundOutline, toPoints } from "./projection.ts";

/**
 * A faint dashed outline on the ground where the accepted layout puts each
 * structure with a pending change, drawn under the structures.
 */
export function AcceptedOutlines({
  structures,
  view,
}: {
  readonly structures: ReadonlyArray<SceneStructure>;
  readonly view: View;
}) {
  const editing = useEditingIgnoringEdit();

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
                className="stroke-pending fill-none opacity-50"
                data-accepted-outline={structure.id}
                key={structure.id}
                points={toPoints(
                  groundOutline(accepted, groundProjections[view])
                )}
                strokeDasharray="3 3"
                strokeWidth={1.2}
              />,
            ];
      })}
    </g>
  );
}
