import { groundProjections } from "@axonometric/contracts";
import type { Placement, View } from "@axonometric/contracts";
import { Array as Arr } from "effect";

import { groundOutline, toPoints } from "./projection.ts";
import { useSelection } from "./selection-context.ts";
import { outlineOf } from "./selection-outline.ts";

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
  const { multiSelection, selected } = useSelection();
  const placement = selected === null ? undefined : placements[selected];
  const ground = groundProjections[view];

  return (
    <>
      {selected === null || placement === undefined ? null : (
        <polygon
          className="fill-ink/15 stroke-ink pointer-events-none"
          data-selection-marker={selected}
          points={toPoints(groundOutline(outlineOf(placement), ground))}
          strokeWidth={2}
        />
      )}
      {Arr.flatMap([...multiSelection], (id) => {
        const at = placements[id];

        return at === undefined
          ? []
          : [
              <polygon
                className="fill-multi/15 stroke-multi pointer-events-none"
                data-multi-selection-marker={id}
                key={id}
                points={toPoints(groundOutline(outlineOf(at), ground))}
                strokeWidth={2.5}
              />,
            ];
      })}
    </>
  );
}
