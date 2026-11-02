import { planZoneRadius, toPoints } from "@axonometric/contracts";
import type { SceneZone } from "@axonometric/contracts";
import { String as Str } from "effect";
import type { ComponentType } from "react";

import { partId, useDrawing } from "./drawing-context.ts";

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
      // The page keeps the title as written and sets it in capitals with CSS;
      // a file has no stylesheet, so it holds the capitals.
      style={live ? { textTransform: "uppercase" } : undefined}
    >
      {live ? title : Str.toUpperCase(title)}
    </text>
  );
}

/** A zone in the Iso view: a plate on the ground, with its title. */
export function IsoPlate({ drawing }: { readonly drawing: SceneZone }) {
  const environment = useDrawing();
  const { paint } = environment;

  return (
    <g
      data-zone={drawing.zone.group.id}
      id={partId(environment, "zone", drawing.zone.group.id)}
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
  const environment = useDrawing();
  const { paint } = environment;
  const { bounds } = drawing;

  return (
    <g
      data-zone={drawing.zone.group.id}
      id={partId(environment, "zone", drawing.zone.group.id)}
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
      {zones.map((drawing) => (
        <Plate key={drawing.zone.group.id} drawing={drawing} />
      ))}
    </g>
  );
}
