import { groundProjections } from "@axonometric/contracts";
import type { Placement, View } from "@axonometric/contracts";
import { Array as Arr } from "effect";

import { useDropOutlines } from "./outlines-context.ts";
import { groundOutline, toPoints } from "./projection.ts";

/**
 * Where a drop would put one footprint, dashed in the pending colour, or
 * filled red with the reason in its title while the drop is refused.
 */
export function DropOutline({
  at,
  id,
  refusal,
  view,
}: {
  readonly at: Placement;
  readonly id: string;
  /** Why the drop would be refused, or `undefined` when it wouldn't. */
  readonly refusal: string | undefined;
  readonly view: View;
}) {
  const refused = refusal !== undefined;

  return (
    <polygon
      className={
        refused
          ? "fill-refused/15 stroke-refused pointer-events-none"
          : "stroke-pending pointer-events-none fill-none"
      }
      data-drag-outline={id}
      data-refused={refused}
      points={toPoints(groundOutline(at, groundProjections[view]))}
      strokeDasharray={refused ? undefined : "5 3"}
      strokeWidth={refused ? 2.5 : 1.5}
    >
      {refused ? <title>{refusal}</title> : null}
    </polygon>
  );
}

/** A dashed outline where a structure was before a drag, as a reminder. */
export function DragOrigin({
  at,
  id,
  view,
}: {
  readonly at: Placement;
  readonly id: string;
  readonly view: View;
}) {
  return (
    <polygon
      aria-hidden="true"
      className="stroke-ink pointer-events-none fill-none opacity-40"
      data-drag-origin={id}
      points={toPoints(groundOutline(at, groundProjections[view]))}
      strokeDasharray="3 3"
      strokeWidth={1.2}
    />
  );
}

/**
 * The outlines of a drag in progress: a dashed one where each moving
 * structure was, and one where it would land, red while the drop is refused.
 * It sits in the drawing's ground layer, under the zones, so it never lies
 * over a zone title, a name tag or a label.
 */
export function DragOutlines({ view }: { readonly view: View }) {
  const outlines = useDropOutlines()?.outlines;

  if (outlines === undefined) {
    return null;
  }

  return (
    <g className="pointer-events-none" data-drag-outlines="">
      {Arr.map(outlines.moving, ({ from, id, to }) => (
        <g key={id}>
          <DragOrigin at={from} id={id} view={view} />
          <DropOutline at={to} id={id} refusal={outlines.refusal} view={view} />
        </g>
      ))}
    </g>
  );
}
