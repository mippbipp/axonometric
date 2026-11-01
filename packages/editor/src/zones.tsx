import { toPoints } from "./iso.ts";
import type { ZoneDrawing } from "./zone-outline.ts";

function ZonePlate({ drawing }: { readonly drawing: ZoneDrawing }) {
  const { zone, plate, titleTransform } = drawing;

  return (
    <g data-zone={zone.group.id}>
      <polygon
        data-zone-plate=""
        points={toPoints(plate)}
        className="fill-ink/5 stroke-ink/45"
        strokeWidth={0.9}
      />
      <text
        data-zone-title=""
        transform={titleTransform}
        className="fill-ink/75 text-2xs stroke-none font-mono font-medium tracking-widest uppercase"
      >
        {zone.group.title}
      </text>
    </g>
  );
}

/**
 * Each zone as a plate on the ground, with its group's title lying on the
 * plate along its front-left edge. Drawn first, so hops and structures
 * paint over it.
 */
export function Zones({ zones }: { readonly zones: readonly ZoneDrawing[] }) {
  return (
    <g data-zones="">
      {zones.map((drawing) => (
        <ZonePlate key={drawing.zone.group.id} drawing={drawing} />
      ))}
    </g>
  );
}
