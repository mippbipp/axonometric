import { planZoneRadius } from "@axonometric/contracts";
import type { SceneZone, View } from "@axonometric/contracts";

import { boundsOf } from "./bounds.ts";
import { toPoints } from "./iso.ts";

const plateClass = "fill-ink/5 stroke-ink/45";

/** A zone's plate: a diamond on the ground, or a rounded outline from above. */
function Plate({
  plate,
  view,
}: {
  readonly plate: SceneZone["plate"];
  readonly view: View;
}) {
  const bounds = boundsOf(plate);

  return view === "plan" && bounds !== undefined ? (
    <rect
      data-zone-plate=""
      x={bounds.minX}
      y={bounds.minY}
      width={bounds.maxX - bounds.minX}
      height={bounds.maxY - bounds.minY}
      rx={planZoneRadius}
      className={plateClass}
      strokeWidth={0.9}
    />
  ) : (
    <polygon
      data-zone-plate=""
      points={toPoints(plate)}
      className={plateClass}
      strokeWidth={0.9}
    />
  );
}

function ZonePlate({
  drawing,
  view,
}: {
  readonly drawing: SceneZone;
  readonly view: View;
}) {
  const { zone, plate, titleTransform } = drawing;

  return (
    <g data-zone={zone.group.id}>
      <Plate plate={plate} view={view} />
      {titleTransform === undefined ? null : (
        <text
          data-zone-title=""
          transform={titleTransform}
          className="fill-ink/75 text-2xs stroke-none font-mono font-medium tracking-widest uppercase"
        >
          {zone.group.title}
        </text>
      )}
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
  view,
}: {
  readonly zones: readonly SceneZone[];
  readonly view: View;
}) {
  return (
    <g data-zones="">
      {zones.map((drawing) => (
        <ZonePlate key={drawing.zone.group.id} drawing={drawing} view={view} />
      ))}
    </g>
  );
}
