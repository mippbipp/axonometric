import type { Zone } from "@axonometric/contracts";

import { toPoints } from "./iso.ts";
import { zoneOutline } from "./zone-outline.ts";

function ZonePlate({ zone }: { readonly zone: Zone }) {
  const { plate, titleEnd } = zoneOutline(zone);

  return (
    <g data-zone={zone.group.id}>
      <polygon
        points={toPoints(plate)}
        className="fill-ink/5 stroke-ink/45"
        strokeWidth={0.9}
      />
      <text
        data-zone-title=""
        x={titleEnd.sx}
        y={titleEnd.sy}
        textAnchor="end"
        className="fill-ink/70 text-2xs stroke-none font-mono tracking-widest uppercase"
      >
        {zone.group.title}
      </text>
    </g>
  );
}

/**
 * Each zone as a plate on the ground with its group's title. Drawn first, so
 * hops and structures paint over it.
 */
export function Zones({ zones }: { readonly zones: readonly Zone[] }) {
  return (
    <g data-zones="">
      {zones.map((zone) => (
        <ZonePlate key={zone.group.id} zone={zone} />
      ))}
    </g>
  );
}
