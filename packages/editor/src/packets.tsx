import type { Hop } from "@axonometric/contracts";
import { CanvasItem } from "@axonometric/ui/components/canvas-items";
import { Array as Arr } from "effect";
import { useMemo } from "react";

import type { PacketRun } from "./chapters.ts";
import { useDropOutlines } from "./outlines-context.ts";
import { packetAt } from "./packet-schedule.ts";
import { usePlayback, usePlaybackClock } from "./playback.ts";
import { pointAlong } from "./projection.ts";
import type { ScreenPoint } from "./projection.ts";

/**
 * A view's drawn route for a hop, in its own screen coordinates, or
 * `undefined` when the view doesn't draw the hop. Keep it stable between
 * renders, for example with `useCallback`, so routes aren't recomputed.
 */
export type RouteOf = (hop: Hop) => ReadonlyArray<ScreenPoint> | undefined;

function Packet({
  routeOf,
  run,
  runIndex,
}: {
  readonly routeOf: RouteOf;
  readonly run: PacketRun;
  readonly runIndex: number;
}) {
  const { selected, selectPacket } = usePlayback();
  const moving = useDropOutlines()?.outlines?.moving;
  const clock = usePlaybackClock();
  const routes = useMemo(() => Arr.map(run.hops, routeOf), [run, routeOf]);
  const at = packetAt({ clock, hops: run.hops.length });
  const hop = run.hops[at.hop];
  const route = routes[at.hop];

  if (hop === undefined || route === undefined) {
    return null;
  }

  const { sx, sy } = pointAlong({ points: route, t: at.t });

  // A packet walks its hop's old route while a structure at either end is
  // dragged, so it would hang in the air. It comes back with the hop. This is
  // worked out as the packet draws, because it moves from hop to hop for as
  // long as its run lasts. It has its own attribute: `shiftDrawing` clears
  // `data-drag-hidden` from the elements it hid, and React owns this one.
  const hidden = Arr.some(
    moving ?? [],
    ({ id }) => id === hop.from || id === hop.to
  );

  const isSelected = selected?.run.id === run.id;

  return (
    <CanvasItem
      aria-label={`Packet: ${hop.label}`}
      className="cursor-pointer outline-none"
      data-packet={hop.id}
      data-packet-hidden={hidden ? "" : undefined}
      data-run={run.id}
      data-selected={isSelected}
      onPress={() => {
        selectPacket(runIndex);
      }}
      value={`packet:${run.id}`}
    >
      {/* A wider, invisible target so the packet is easy to hit. */}
      <circle className="fill-transparent" cx={sx} cy={sy} r={12} />
      {isSelected ? (
        <circle
          className="stroke-ink"
          cx={sx}
          cy={sy}
          fill="none"
          r={11}
          strokeDasharray="2 2"
          strokeWidth={1.2}
        />
      ) : null}
      <circle
        className="fill-ink stroke-paper"
        cx={sx}
        cy={sy}
        r={5.5}
        strokeWidth={1.6}
      />
    </CanvasItem>
  );
}

/**
 * The packets for the current chapter, one per run, drawn inside a view's
 * SVG. `routeOf` gives each hop's route in the view's coordinates, so the
 * Iso view and Plan view share the timing and differ only in the routes.
 *
 * Packets carry no label. The hop's own label, drawn once by the view at the
 * hop, names what the packet carries, and the side panel shows it when the
 * packet is selected.
 */
export function PacketLayer({ routeOf }: { readonly routeOf: RouteOf }) {
  const { playing, runs } = usePlayback();

  return (
    <g data-packets data-playing={playing}>
      {Arr.map(runs, (run, index) => (
        <Packet key={run.id} routeOf={routeOf} run={run} runIndex={index} />
      ))}
    </g>
  );
}
