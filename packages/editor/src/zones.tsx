import type { SceneZone } from "@axonometric/contracts";

import { toPoints } from "./iso.ts";

function ZonePlate({ drawing }: { readonly drawing: SceneZone }) {
  const { zone, plate, titleTransform } = drawing;

  return (
    <g data-zone={zone.group.id}>
      <polygon
        data-zone-plate=""
        points={toPoints(plate)}
        className="fill-ink/5 stroke-ink/45"
        strokeWidth={0.9}
      />
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
export function Zones({ zones }: { readonly zones: readonly SceneZone[] }) {
  return (
    <g data-zones="">
      {zones.map((drawing) => (
        <ZonePlate key={drawing.zone.group.id} drawing={drawing} />
      ))}
    </g>
  );
}
