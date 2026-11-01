import { groundProjections } from "@axonometric/contracts";
import type { SceneStructure, View } from "@axonometric/contracts";
import { Array as Arr } from "effect";

import { useEditing } from "./editing-context.ts";
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

  const changed = new Set(
    Arr.map(editing.pending, (change) => change.structureId)
  );

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

const badgeText = "pending";

/** How wide the badge is: its text in the tag font, and padding. */
const badgeWidth = badgeText.length * 6.2 + 10;

const badgeHeight = 14;

/**
 * A "pending" badge above each structure with a pending change, centred
 * over the top of its drawing.
 */
export function PendingBadges({
  structures,
}: {
  readonly structures: readonly SceneStructure[];
}) {
  const editing = useEditing();

  if (editing === null) {
    return null;
  }

  const changed = new Set(
    Arr.map(editing.pending, (change) => change.structureId)
  );

  return (
    <g className="pointer-events-none">
      {Arr.flatMap(structures, ({ structure, bounds }) => {
        if (!changed.has(structure.id)) {
          return [];
        }

        const middle = (bounds.left + bounds.right) / 2;
        const top = bounds.top - badgeHeight - 4;

        return [
          <g key={structure.id} data-pending-badge={structure.id}>
            <rect
              x={middle - badgeWidth / 2}
              y={top}
              width={badgeWidth}
              height={badgeHeight}
              rx={2}
              className="fill-pending"
            />
            <text
              x={middle}
              y={top + badgeHeight - 4}
              textAnchor="middle"
              className="fill-paper text-2xs font-mono font-semibold"
            >
              {badgeText}
            </text>
          </g>,
        ];
      })}
    </g>
  );
}
