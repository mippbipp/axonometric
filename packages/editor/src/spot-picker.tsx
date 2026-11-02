import {
  groundOutline,
  groundProjections,
  toPoints,
} from "@axonometric/contracts";
import type { GridPoint, View } from "@axonometric/contracts";
import { useEffect, useRef, useState } from "react";

import { groundAt } from "./ground-at.ts";
import { newStructureFootprint } from "./new-structure.ts";
import { usePlacing } from "./place-context.ts";

const snap = (value: number) => Math.round(value * 2) / 2;

/**
 * Picks the ground for a new structure while its form is open: a click on
 * empty ground sets the spot, snapped to half units, and a dashed footprint
 * follows the pointer. A pick is the whole click, so it doesn't pin or clear
 * anything under it.
 *
 * This is an editing layer: a file's drawing never includes it.
 */
export function SpotPicker({ view }: { readonly view: View }) {
  const placing = usePlacing();
  const root = useRef<SVGGElement>(null);
  const [over, setOver] = useState<GridPoint | null>(null);
  const picking = placing?.picking === true;

  useEffect(() => {
    const canvas = root.current?.ownerSVGElement;
    const element = root.current;

    const at = (event: MouseEvent): GridPoint | null => {
      const ground =
        element === null ? undefined : groundAt({ element, event, view });

      return ground === undefined
        ? null
        : {
            x: snap(ground.x - newStructureFootprint.w / 2),
            y: snap(ground.y - newStructureFootprint.d / 2),
          };
    };

    const onMove = (event: MouseEvent) => {
      setOver(at(event));
    };

    // On the way down, so a pick doesn't also pin the structure under it.
    const onClick = (event: MouseEvent) => {
      const spot = at(event);

      if (spot !== null) {
        event.stopPropagation();
        event.preventDefault();
        placing?.setSpot(spot);
        placing?.pick(false);
      }
    };

    if (picking) {
      canvas?.addEventListener("pointermove", onMove);
      canvas?.addEventListener("click", onClick, { capture: true });
    }

    return () => {
      canvas?.removeEventListener("pointermove", onMove);
      canvas?.removeEventListener("click", onClick, { capture: true });
      setOver(null);
    };
  }, [picking, view, placing]);

  const shown = picking ? over : (placing?.spot ?? null);

  return (
    <g ref={root} aria-hidden="true" className="pointer-events-none">
      {shown === null ? null : (
        <polygon
          data-spot-outline=""
          points={toPoints(
            groundOutline(
              { ...shown, ...newStructureFootprint },
              groundProjections[view]
            )
          )}
          className="stroke-pending fill-none"
          strokeWidth={2}
          strokeDasharray="5 3"
        />
      )}
    </g>
  );
}
