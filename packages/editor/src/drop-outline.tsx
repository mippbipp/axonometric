import { groundProjections } from "@axonometric/contracts";
import type { Placement, View } from "@axonometric/contracts";

import { groundOutline, toPoints } from "./projection.ts";

/**
 * Where a drop would put one footprint, dashed in the pending colour, or
 * filled red with the reason in its title while the drop is refused.
 */
export function DropOutline({
  id,
  at,
  view,
  refusal,
}: {
  readonly id: string;
  readonly at: Placement;
  readonly view: View;
  /** Why the drop would be refused, or `undefined` when it wouldn't. */
  readonly refusal: string | undefined;
}) {
  const refused = refusal !== undefined;

  return (
    <polygon
      data-drag-outline={id}
      data-refused={refused}
      points={toPoints(groundOutline(at, groundProjections[view]))}
      className={
        refused
          ? "fill-refused/15 stroke-refused pointer-events-none"
          : "stroke-pending pointer-events-none fill-none"
      }
      strokeWidth={refused ? 2.5 : 1.5}
      strokeDasharray={refused ? undefined : "5 3"}
    >
      {refused ? <title>{refusal}</title> : null}
    </polygon>
  );
}

/** A dashed outline where a structure was before a drag, as a reminder. */
export function DragOrigin({
  id,
  at,
  view,
}: {
  readonly id: string;
  readonly at: Placement;
  readonly view: View;
}) {
  return (
    <polygon
      data-drag-origin={id}
      aria-hidden="true"
      points={toPoints(groundOutline(at, groundProjections[view]))}
      className="stroke-ink pointer-events-none fill-none opacity-40"
      strokeWidth={1.2}
      strokeDasharray="3 3"
    />
  );
}
