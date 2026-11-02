import { planZoneRadius, toPoints } from "@axonometric/contracts";
import type { SceneZone } from "@axonometric/contracts";
import { Array as Arr, String as Str } from "effect";
import type { ComponentType } from "react";

import { useDrawing } from "./drawing-context.ts";

/** How strong a zone's fill and outline are, as shares of ink. */
const plateFill = 0.05;

const plateStroke = 0.45;

const titleOpacity = 0.75;

function ZoneTitle({ drawing }: { readonly drawing: SceneZone }) {
  const { paint, live } = useDrawing();
  const { title } = drawing.zone.group;

  return drawing.titleTransform === undefined ? null : (
    <text
      data-zone-title=""
      transform={drawing.titleTransform}
      fill={paint.ink}
      fillOpacity={titleOpacity}
      stroke="none"
      fontSize={10}
      fontWeight={500}
      letterSpacing={1}
    >
      {/* The page sets titles in capitals with CSS, keeping them as written
          for assistive technology; a file has no stylesheet. */}
      {live ? title : Str.toUpperCase(title)}
    </text>
  );
}

/** A zone in the Iso view: a plate on the ground, with its title. */
export function IsoPlate({ drawing }: { readonly drawing: SceneZone }) {
  const { paint, idOf } = useDrawing();

  return (
    <g
      data-zone={drawing.zone.group.id}
      id={idOf("zone", drawing.zone.group.id) ?? undefined}
    >
      <polygon
        data-zone-plate=""
        points={toPoints(drawing.plate)}
        fill={paint.ink}
        fillOpacity={plateFill}
        stroke={paint.ink}
        strokeOpacity={plateStroke}
        strokeWidth={0.9}
      />
      <ZoneTitle drawing={drawing} />
    </g>
  );
}

/** A zone in Plan view: a rounded outline from above, with its title. */
export function PlanPlate({ drawing }: { readonly drawing: SceneZone }) {
  const { paint, idOf } = useDrawing();
  const { bounds } = drawing;

  return (
    <g
      data-zone={drawing.zone.group.id}
      id={idOf("zone", drawing.zone.group.id) ?? undefined}
    >
      <rect
        data-zone-plate=""
        x={bounds.left}
        y={bounds.top}
        width={bounds.right - bounds.left}
        height={bounds.bottom - bounds.top}
        rx={planZoneRadius}
        fill={paint.ink}
        fillOpacity={plateFill}
        stroke={paint.ink}
        strokeOpacity={plateStroke}
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
      {Arr.map(zones, (drawing) => (
        <Plate key={drawing.zone.group.id} drawing={drawing} />
      ))}
    </g>
  );
}
