import { planZoneRadius } from "@axonometric/contracts";
import type { SceneZone } from "@axonometric/contracts";
import type { ComponentType } from "react";

import { useEditing } from "./editing-context.ts";
import { toPoints } from "./projection.ts";

const plateClass = "fill-ink/5 stroke-ink/45";

/**
 * A zone's title. While the page can edit, an invisible area over the title
 * is what you press to move the whole group (see `GroupEditor`).
 */
function ZoneTitle({ drawing }: { readonly drawing: SceneZone }) {
  const editing = useEditing();

  if (drawing.titleTransform === undefined) {
    return null;
  }

  return (
    <>
      <text
        data-zone-title=""
        transform={drawing.titleTransform}
        className="fill-ink/75 text-2xs stroke-none font-mono font-medium tracking-widest uppercase"
      >
        {drawing.zone.group.title}
      </text>
      {editing?.canEdit === true && drawing.title !== undefined ? (
        <polygon
          data-zone-title-hit={drawing.zone.group.id}
          points={toPoints(drawing.title)}
          fill="transparent"
          stroke="none"
          className="cursor-move"
        >
          <title>
            Drag to move every structure in {drawing.zone.group.title}
          </title>
        </polygon>
      ) : null}
    </>
  );
}

/** A zone in the Iso view: a plate on the ground, with its title. */
export function IsoPlate({ drawing }: { readonly drawing: SceneZone }) {
  return (
    <g data-zone={drawing.zone.group.id}>
      <polygon
        data-zone-plate=""
        points={toPoints(drawing.plate)}
        className={plateClass}
        strokeWidth={0.9}
      />
      <ZoneTitle drawing={drawing} />
    </g>
  );
}

/** A zone in Plan view: a rounded outline from above, with its title. */
export function PlanPlate({ drawing }: { readonly drawing: SceneZone }) {
  const { bounds } = drawing;

  return (
    <g data-zone={drawing.zone.group.id}>
      <rect
        data-zone-plate=""
        x={bounds.left}
        y={bounds.top}
        width={bounds.right - bounds.left}
        height={bounds.bottom - bounds.top}
        rx={planZoneRadius}
        className={plateClass}
        strokeWidth={0.9}
      />
      <ZoneTitle drawing={drawing} />
    </g>
  );
}

/**
 * Each zone as a plate on the ground, with its group's title lying along
 * one of the plate's edges where the scene found room. Drawn first, so hops
 * and structures paint over it.
 */
export function Zones({
  zones,
  Plate,
}: {
  readonly zones: readonly SceneZone[];
  /** How the view draws one zone. */
  readonly Plate: ComponentType<{ readonly drawing: SceneZone }>;
}) {
  return (
    <g data-zones="">
      {zones.map((drawing) => (
        <Plate key={drawing.zone.group.id} drawing={drawing} />
      ))}
    </g>
  );
}
